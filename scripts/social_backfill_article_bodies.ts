// scripts/social_backfill_article_bodies.ts — Fetch full article bodies
// for existing article_queue rows whose RSS-supplied body is too short for
// the editorial pipeline to work with.
//
// Reads rows where length(body) < MIN_BODY_CHARS and ingest_status is not
// 'rejected' (no point paying to re-extract articles Jev already dropped).
// For each row: fetches source_url, runs Readability, and UPDATEs `body`
// only if the extracted text is genuinely longer than what's already there.
//
// Zero API cost — just HTTP + HTML parsing.
//
// Run:
//   npm run helios-social:backfill-bodies              # default 20 rows
//   npm run helios-social:backfill-bodies -- --n 50    # 50 rows
//   npm run helios-social:backfill-bodies -- --n all   # everything eligible

import fs from 'node:fs';
import path from 'node:path';

// Load .env.local BEFORE importing anything that reads process.env.
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\r$/, '');
  }
}

type ArgSpec = {
  count: number | 'all';
  minBody: number;
};

function parseArgs(argv: string[]): ArgSpec {
  let count: number | 'all' = 20;
  let minBody = 500;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if ((arg === '--n' || arg === '-n') && argv[i + 1]) {
      const next = argv[i + 1]!;
      if (next === 'all') count = 'all';
      else {
        const parsed = Number(next);
        if (Number.isFinite(parsed) && parsed > 0) count = Math.floor(parsed);
      }
      i += 1;
    } else if (arg === '--min-body' && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) minBody = Math.floor(parsed);
      i += 1;
    }
  }
  return { count, minBody };
}

type Row = { id: string; source: string; source_url: string; headline: string; body_len: number };

async function main() {
  const { dbQuery } = await import('../lib/db');
  const { extractArticleBody } = await import('../lib/social/ingest/extract-article-body');

  const args = parseArgs(process.argv.slice(2));

  console.log('[backfill-bodies] Article-body backfill via Readability');
  console.log(`[backfill-bodies] eligibility: length(body) < ${args.minBody} AND ingest_status != 'rejected'`);
  console.log(`[backfill-bodies] limit: ${args.count}`);
  console.log('');

  // Google News wrapper URLs now resolve via the google-news-decoder
  // integration in extract-article-body.ts — no filter needed here.
  const limitSql = args.count === 'all' ? '' : `LIMIT ${args.count}`;
  const { rows } = await dbQuery<Row>(
    `SELECT id, source, source_url, headline, length(body) AS body_len
       FROM helios_social.article_queue
      WHERE length(body) < $1
        AND ingest_status != 'rejected'
      ORDER BY published_at DESC NULLS LAST, added_at DESC
      ${limitSql}`,
    [args.minBody],
  );

  if (rows.length === 0) {
    console.log('[backfill-bodies] Nothing eligible. Done.');
    return;
  }

  console.log(`[backfill-bodies] Processing ${rows.length} row(s)…\n`);

  let ok = 0;
  let skipTooShort = 0;
  let skipNotLonger = 0;
  let failFetch = 0;
  let failParse = 0;
  const startedAt = Date.now();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const label = `${i + 1}/${rows.length}`;
    process.stdout.write(`── ${label} ${row.source} · ${row.headline.slice(0, 72)}\n`);
    process.stdout.write(`   from ${row.body_len} chars, url=${row.source_url.slice(0, 90)}\n`);

    let extracted: Awaited<ReturnType<typeof extractArticleBody>> = null;
    try {
      extracted = await extractArticleBody(row.source_url, { minTextLength: args.minBody });
    } catch (err) {
      failParse += 1;
      process.stdout.write(`   FAIL parse: ${err instanceof Error ? err.message : String(err)}\n\n`);
      continue;
    }

    if (!extracted) {
      // extract-article-body returns null both on fetch failure and when text
      // was under minTextLength. Peek at row.body_len decision here for the
      // logs: an already-shortish body being replaced by null usually means
      // fetch failed.
      failFetch += 1;
      process.stdout.write(`   FAIL fetch or extraction returned nothing usable\n\n`);
      continue;
    }

    if (extracted.length < args.minBody) {
      skipTooShort += 1;
      process.stdout.write(`   SKIP: extracted ${extracted.length} chars (< ${args.minBody})\n\n`);
      continue;
    }

    if (extracted.length <= row.body_len) {
      skipNotLonger += 1;
      process.stdout.write(`   SKIP: extracted ${extracted.length} chars is not longer than existing ${row.body_len}\n\n`);
      continue;
    }

    await dbQuery(
      `UPDATE helios_social.article_queue
          SET body = $1
        WHERE id = $2`,
      [extracted.text, row.id],
    );
    ok += 1;
    const gnrTag = extracted.googleNewsResolved ? ' [google-news-resolved]' : '';
    process.stdout.write(`   OK: ${row.body_len} → ${extracted.length} chars (via ${extracted.method})${gnrTag}\n\n`);

    // Gentle rate-limit: 200ms between fetches so we don't hammer any one
    // outlet in a burst. Total: ~50s for 250 rows, well under 5 minutes.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('== SUMMARY ==');
  console.log(`  updated:            ${ok}`);
  console.log(`  skipped (too thin): ${skipTooShort}`);
  console.log(`  skipped (not longer): ${skipNotLonger}`);
  console.log(`  fetch/extraction failed: ${failFetch}`);
  console.log(`  parse errors: ${failParse}`);
  console.log(`  total: ${rows.length}  time: ${durationSec}s`);
}

main().catch((err) => {
  console.error('[backfill-bodies] Unhandled:', err);
  process.exit(1);
});
