// scripts/social_render_dry_run.ts — Phase 4 integration test.
//
// Reads articles that cleared editorial QA (qa_pass=TRUE), loads the full
// editorial output + fact sheet + story plan + article meta from the DB,
// runs the layout picker, and emits:
//   1. A per-slide text summary of layout + variant + copy preview
//   2. The full render Post JSON to exports/social/generated/{slug}.json
//      so the existing Playwright export can render it as PNGs.
//
// Zero API cost — algorithmic layout selection only, no LLM calls.
//
// Usage:
//   npm run helios-social:render-dry-run              # default N=3
//   npm run helios-social:render-dry-run -- --n 5     # 5 articles
//   npm run helios-social:render-dry-run -- <id> <id> # specific IDs

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\r$/, '');
  }
}

type ArgSpec = { ids: string[]; count: number };

function parseArgs(argv: string[]): ArgSpec {
  const ids: string[] = [];
  let count: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if ((arg === '--n' || arg === '-n') && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) count = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg)) {
      ids.push(arg);
    }
  }
  return { ids, count: count ?? 0 };
}

type Row = {
  id: string;
  source: string;
  source_url: string;
  published_at: Date | string | null;
  headline: string;
  fact_sheet: unknown;
  story_plan: unknown;
  copy_json: unknown;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function main() {
  const { dbQuery } = await import('../lib/db');
  const { pickLayouts } = await import('../lib/social/render/layout-picker');
  const { assignPhotos } = await import('../lib/social/render/photo-assigner');

  const args = parseArgs(process.argv.slice(2));
  const defaultN = 3;
  const requested = args.count > 0 ? args.count : (args.ids.length > 0 ? args.ids.length : defaultN);
  const cap = Math.min(requested, 20);

  console.log('[render-dry-run] Layout picker + render Post emission');
  console.log('');

  let rows: Row[];
  if (args.ids.length > 0) {
    const clamped = args.ids.slice(0, cap);
    const { rows: r } = await dbQuery<Row>(
      `SELECT id, source, source_url, published_at, headline,
              fact_sheet, story_plan, copy_json
         FROM helios_social.article_queue
        WHERE id = ANY($1::uuid[])
          AND qa_passed_at IS NOT NULL`,
      [clamped],
    );
    rows = r;
  } else {
    const { rows: r } = await dbQuery<Row>(
      `SELECT id, source, source_url, published_at, headline,
              fact_sheet, story_plan, copy_json
         FROM helios_social.article_queue
        WHERE qa_passed_at IS NOT NULL
        ORDER BY qa_passed_at DESC
        LIMIT $1`,
      [cap],
    );
    rows = r;
  }

  if (rows.length === 0) {
    console.error('[render-dry-run] No articles with qa_pass=TRUE. Nothing to do.');
    process.exit(0);
  }

  const outDir = path.join(root, 'exports', 'social', 'generated');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`[render-dry-run] Processing ${rows.length} article(s) → ${outDir}\n`);

  const generatedSlugs: string[] = [];
  let issue = Math.floor(Date.now() / 86_400_000) - 20_000; // stable issue #, day-based
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const publishedIso = row.published_at instanceof Date
      ? row.published_at.toISOString()
      : (typeof row.published_at === 'string' ? row.published_at : new Date().toISOString());
    const bareLayout = pickLayouts({
      editorialPost: row.copy_json as never,
      factSheet: row.fact_sheet as never,
      storyPlan: row.story_plan as never,
      article: {
        source: row.source,
        sourceUrl: row.source_url,
        publishedAt: publishedIso,
        issueNumber: issue + i,
      },
    });

    // Photo assignment — subject portrait for HOOK/QUOTE, atmosphere for
    // interior beats, no duplicates within the carousel.
    const photoStart = Date.now();
    const enriched = await assignPhotos({
      post: bareLayout,
      factSheet: row.fact_sheet as never,
      articleUrl: row.source_url,
    });
    const photoMs = Date.now() - photoStart;
    const post = enriched.post;

    const slug = `${slugify(row.source)}-${slugify(row.headline).slice(0, 40)}-${row.id.slice(0, 8)}`;
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(post, null, 2), 'utf8');
    generatedSlugs.push(slug);

    console.log(`── ${i + 1}/${rows.length} ${row.source}: ${row.headline.slice(0, 88)}`);
    console.log(`   id=${row.id}  slides=${post.slides.length}  storyType=${post.storyType}`);

    // Rhythm summary — flag consecutive same variants (rule 1 violation).
    let consecutiveViolations = 0;
    for (let s = 1; s < post.slides.length; s += 1) {
      if (post.slides[s]!.variant === post.slides[s - 1]!.variant) {
        consecutiveViolations += 1;
      }
    }
    const uniqVariants = new Set(post.slides.map((s) => s.variant));
    console.log(`   ${uniqVariants.size} distinct variants, ${consecutiveViolations} consecutive-same violations`);
    console.log(`   photos: ${enriched.assigned} assigned, ${enriched.skipped} skipped (${photoMs}ms)`);

    // Per-slide preview.
    for (const slide of post.slides) {
      const previewText = [slide.title, slide.headline, slide.body]
        .filter((r): r is NonNullable<typeof r> => r != null)
        .flatMap((r) => r.map((s) => s.text))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const abbrev = previewText.length > 90 ? `${previewText.slice(0, 87)}...` : previewText;
      console.log(`     ${String(slide.position).padStart(2)}. ${slide.layoutVariant.padEnd(11)} ${(slide.variant ?? '--').padEnd(3)} [${slide.beat ?? '???'}] ${abbrev}`);
    }
    console.log(`   → wrote ${outPath}\n`);
  }

  console.log('== NEXT ==');
  console.log('These posts are wired to the preview route + export script. To see PNGs:');
  console.log('  1. Start dev server (in another terminal):');
  console.log('       npx next dev -p 3001');
  console.log('  2. Preview any post in the browser:');
  for (const slug of generatedSlugs) {
    console.log(`       http://localhost:3001/social/render/preview?generated=${slug}&all=1`);
  }
  console.log('  3. Export a post to PNGs via headless Chromium:');
  for (const slug of generatedSlugs) {
    console.log(`       npx tsx scripts/social_export_slides.ts --generated ${slug}`);
  }
  console.log('     PNGs land in exports/social/gen-<slug>/');
}

main().catch((err) => {
  console.error('[render-dry-run] Unhandled:', err);
  process.exit(1);
});
