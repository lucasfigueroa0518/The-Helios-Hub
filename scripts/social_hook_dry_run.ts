// scripts/social_hook_dry_run.ts — Editorial pipeline stages 1-2 dry run.
//
// From `~/.claude/skills/helios-social-editorial/SKILL.md`:
//   Stage 1: Fact sheet (Sonnet)
//   Stage 2: Hook mining and scoring (Sonnet), with the gate at 18/25 total
//            and >=4 on "could you scroll past it"
//
// This CLI runs both stages against N articles that already passed the
// upstream Jev/Haiku relevance gate (ingest_status='approved_for_draft').
// No slides are rendered. Outputs are persisted to article_queue so the
// results are inspectable in the UI later.
//
// Run:
//   npm run helios-social:hook-dry-run             # default 5 articles
//   npm run helios-social:hook-dry-run -- --n 3    # 3 articles
//   npm run helios-social:hook-dry-run -- <id> <id>
//
// Spend guards:
//   - DRY_RUN_MAX_COUNT (default 10) caps N.
//   - DRY_RUN_MAX_USD (default $1.00) halts the loop when the running total
//     would exceed the cap.

import fs from 'node:fs';
import path from 'node:path';

// Load .env.local BEFORE any module that reads process.env (Anthropic client,
// pg pool) — same pattern the other scripts use.
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\r$/, '');
  }
}

type ArgSpec = {
  ids: string[];
  count: number;
};

function parseArgs(argv: string[]): ArgSpec {
  const ids: string[] = [];
  let count: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--n' || arg === '-n') {
      const next = argv[i + 1];
      if (next) {
        const parsed = Number(next);
        if (Number.isFinite(parsed) && parsed > 0) count = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg)) {
      ids.push(arg);
    }
  }
  return { ids, count: count ?? 0 };
}

type ArticleRow = {
  id: string;
  source: string;
  headline: string;
  byline: string | null;
  body: string;
  people: string[] | null;
  companies: string[] | null;
  products: string[] | null;
  topics: string[] | null;
  notable_number: string | null;
  bullets: string[] | null;
  relevance_reason: string | null;
};

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
}

async function main() {
  const { dbQuery } = await import('../lib/db');
  const { buildFactSheet } = await import('../lib/social/editorial/fact-sheet');
  const { mineHooks } = await import('../lib/social/editorial/hook-mine');
  const config = await import('../lib/social/editorial/config');

  const args = parseArgs(process.argv.slice(2));
  const requested = args.count > 0 ? args.count : (args.ids.length > 0 ? args.ids.length : config.DRY_RUN_DEFAULT_COUNT);
  const cappedCount = Math.min(requested, config.DRY_RUN_MAX_COUNT);
  if (cappedCount < requested) {
    console.error(`[hook-dry-run] Requested ${requested} but DRY_RUN_MAX_COUNT is ${config.DRY_RUN_MAX_COUNT} — capping.`);
  }

  console.log('[hook-dry-run] Editorial stages 1-2 dry run');
  console.log(`[hook-dry-run] model=${config.EDITORIAL_MODEL} gate=${config.HOOK_GATE_MIN_TOTAL}/25 total, ≥${config.HOOK_GATE_MIN_Q2}/5 on Q2`);
  console.log(`[hook-dry-run] spend cap: $${config.DRY_RUN_MAX_USD.toFixed(2)} USD`);
  console.log('');

  let rows: ArticleRow[];
  if (args.ids.length > 0) {
    const clamped = args.ids.slice(0, cappedCount);
    const { rows: r } = await dbQuery<ArticleRow>(
      `SELECT id, source, headline, byline, body,
              people, companies, products, topics,
              notable_number, bullets, relevance_reason
         FROM helios_social.article_queue
        WHERE id = ANY($1::uuid[])`,
      [clamped],
    );
    rows = r;
  } else {
    const { rows: r } = await dbQuery<ArticleRow>(
      `SELECT id, source, headline, byline, body,
              people, companies, products, topics,
              notable_number, bullets, relevance_reason
         FROM helios_social.article_queue
        WHERE ingest_status = 'approved_for_draft'
          AND hook_scored_at IS NULL
        ORDER BY relevance_score DESC NULLS LAST,
                 published_at DESC NULLS LAST
        LIMIT $1`,
      [cappedCount],
    );
    rows = r;
  }

  if (rows.length === 0) {
    console.error('[hook-dry-run] No articles matched. Nothing to do.');
    process.exit(0);
  }

  console.log(`[hook-dry-run] Running ${rows.length} article(s)…\n`);

  let cumulativeCost = 0;
  const results: Array<{
    id: string;
    headline: string;
    source: string;
    gate: 'pass' | 'fail';
    total: number | null;
    q2: number | null;
    chosenText: string | null;
    reason: string;
    spent: number;
  }> = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;

    // Spend guard: if the next call would push us past DRY_RUN_MAX_USD, halt.
    const projected = cumulativeCost + 0.20; // rough per-article budget
    if (projected > config.DRY_RUN_MAX_USD) {
      console.error(`[hook-dry-run] HALT — cumulative $${cumulativeCost.toFixed(4)} + est next $0.20 would exceed cap $${config.DRY_RUN_MAX_USD.toFixed(2)}. Stopping after ${i}/${rows.length}.`);
      break;
    }

    const label = `${i + 1}/${rows.length}`;
    console.log(`── ${label} ${row.source}: ${row.headline.slice(0, 88)}`);
    console.log(`   id=${row.id}`);

    // Pre-check: articles with tiny bodies are RSS-summary artifacts. Sonnet
    // will (correctly) refuse to fabricate facts and return prose instead
    // of JSON — a wasted call. Skip cleanly and mark the row gate-failed.
    const bodyLen = row.body?.length ?? 0;
    if (bodyLen < config.MIN_BODY_CHARS) {
      const reason = `Article body is ${bodyLen} chars (need ≥ ${config.MIN_BODY_CHARS}). RSS summary only — full article body not captured upstream.`;
      console.log(`   SKIP: ${reason}`);
      await dbQuery(
        `UPDATE helios_social.article_queue
            SET fact_sheet       = NULL,
                hooks            = NULL,
                chosen_hook      = NULL,
                hook_gate_pass   = FALSE,
                hook_gate_reason = $1,
                hook_scored_at   = now()
          WHERE id = $2`,
        [reason, row.id],
      );
      results.push({
        id: row.id,
        headline: row.headline,
        source: row.source,
        gate: 'fail',
        total: null,
        q2: null,
        chosenText: null,
        reason,
        spent: 0,
      });
      console.log(`   cumulative: $${cumulativeCost.toFixed(4)}\n`);
      continue;
    }

    const scaffold = {
      reason: row.relevance_reason ?? '',
      people: asStringArray(row.people),
      companies: asStringArray(row.companies),
      products: asStringArray(row.products),
      topics: asStringArray(row.topics),
      notable_number: row.notable_number,
      bullets: asStringArray(row.bullets),
    };

    try {
      const factSheetStart = Date.now();
      const fs = await buildFactSheet({
        headline: row.headline,
        source: row.source,
        byline: row.byline,
        body: row.body,
        scaffold,
      });
      const factSheetMs = Date.now() - factSheetStart;
      cumulativeCost += fs.usage.approxCostUsd;

      console.log(`   fact sheet: ${fs.factSheet.key_facts.length} facts, ${fs.factSheet.numbers.length} numbers, ${fs.factSheet.quotes.length} quotes, strength=${fs.factSheet.source_strength}, story_type=${fs.factSheet.story_type} — $${fs.usage.approxCostUsd.toFixed(4)} in ${factSheetMs}ms`);

      const hookStart = Date.now();
      const hm = await mineHooks(fs.factSheet);
      const hookMs = Date.now() - hookStart;
      cumulativeCost += hm.usage.approxCostUsd;

      console.log(`   hooks: ${hm.hooks.length} candidates — $${hm.usage.approxCostUsd.toFixed(4)} in ${hookMs}ms`);
      for (let h = 0; h < hm.hooks.length; h += 1) {
        const hook = hm.hooks[h]!;
        const mark = hm.chosen?.index === h ? '★' : ' ';
        const q = hook.scores;
        console.log(`     ${mark} [${hook.total}/25] Q1:${q.opens_loop} Q2:${q.could_scroll_past} Q3:${q.payoff_implied} Q4:${q.specific} Q5:${q.backed_by_facts} ${hook.cover_rule_pass ? '✓cover' : '✗cover'} [${hook.category}]`);
        console.log(`       "${hook.text}"`);
        if (hook.notes) console.log(`       ${hook.notes}`);
      }
      console.log(`   GATE: ${hm.gate.post ? 'PASS' : 'FAIL'} — ${hm.gate.reason}`);

      // Persist.
      await dbQuery(
        `UPDATE helios_social.article_queue
            SET fact_sheet       = $1::jsonb,
                hooks            = $2::jsonb,
                chosen_hook      = $3::jsonb,
                hook_gate_pass   = $4,
                hook_gate_reason = $5,
                hook_scored_at   = now()
          WHERE id = $6`,
        [
          JSON.stringify(fs.factSheet),
          JSON.stringify(hm.hooks),
          hm.chosen ? JSON.stringify(hm.chosen) : null,
          hm.gate.post,
          hm.gate.reason,
          row.id,
        ],
      );

      results.push({
        id: row.id,
        headline: row.headline,
        source: row.source,
        gate: hm.gate.post ? 'pass' : 'fail',
        total: hm.chosen?.total ?? (hm.hooks[0]?.total ?? null),
        q2: hm.chosen?.scores.could_scroll_past ?? (hm.hooks[0]?.scores.could_scroll_past ?? null),
        chosenText: hm.chosen?.text ?? null,
        reason: hm.gate.reason,
        spent: fs.usage.approxCostUsd + hm.usage.approxCostUsd,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ERROR: ${msg}`);
      results.push({
        id: row.id,
        headline: row.headline,
        source: row.source,
        gate: 'fail',
        total: null,
        q2: null,
        chosenText: null,
        reason: `error: ${msg}`,
        spent: 0,
      });
    }

    console.log(`   cumulative: $${cumulativeCost.toFixed(4)}\n`);
  }

  // Summary table.
  console.log('== SUMMARY ==');
  console.log('gate | tot | Q2 | source · headline (chosen hook)');
  for (const r of results) {
    const tot = r.total !== null ? String(r.total).padStart(2) : '--';
    const q2 = r.q2 !== null ? String(r.q2) : '-';
    console.log(`${r.gate.padEnd(4)} | ${tot}  |  ${q2} | ${r.source} · ${r.headline.slice(0, 72)}`);
    if (r.chosenText) console.log(`                      → "${r.chosenText}"`);
    else if (r.reason) console.log(`                      → ${r.reason}`);
  }
  console.log('');
  console.log(`total spend: $${cumulativeCost.toFixed(4)} USD  (cap $${config.DRY_RUN_MAX_USD.toFixed(2)})`);
  console.log(`passes: ${results.filter((r) => r.gate === 'pass').length}/${results.length}`);
}

main().catch((err) => {
  console.error('[hook-dry-run] Unhandled:', err);
  process.exit(1);
});
