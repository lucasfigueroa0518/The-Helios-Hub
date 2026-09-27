// scripts/social_plan_dry_run.ts — Editorial pipeline stages 3-4 dry run.
//
// From `~/.claude/skills/helios-social-editorial/SKILL.md`:
//   Stage 3: Strategy and bucket (Sonnet)
//   Stage 4: Story plan (Sonnet), 8-11 beats
//
// Reads articles that passed the hook gate (hook_gate_pass=TRUE) and haven't
// been planned yet (plan_generated_at IS NULL), runs stages 3+4, persists
// results to article_queue, prints a per-article summary.
//
// Run:
//   npm run helios-social:plan-dry-run                # default 3 articles
//   npm run helios-social:plan-dry-run -- --n 5       # 5 articles
//   npm run helios-social:plan-dry-run -- <id> <id>   # specific IDs

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
  headline: string;
  fact_sheet: unknown;
  chosen_hook: unknown;
};

async function main() {
  const { dbQuery } = await import('../lib/db');
  const config = await import('../lib/social/editorial/config');
  const { chooseStrategy } = await import('../lib/social/editorial/strategy');
  const { buildStoryPlan, validateStoryPlan } = await import('../lib/social/editorial/story-plan');

  const args = parseArgs(process.argv.slice(2));
  const defaultN = 3;
  const requested = args.count > 0 ? args.count : (args.ids.length > 0 ? args.ids.length : defaultN);
  const cappedCount = Math.min(requested, config.DRY_RUN_MAX_COUNT);
  if (cappedCount < requested) {
    console.error(`[plan-dry-run] Requested ${requested} but DRY_RUN_MAX_COUNT is ${config.DRY_RUN_MAX_COUNT} — capping.`);
  }

  console.log('[plan-dry-run] Editorial stages 3-4 dry run');
  console.log(`[plan-dry-run] model=${config.EDITORIAL_MODEL}`);
  console.log(`[plan-dry-run] spend cap: $${config.DRY_RUN_MAX_USD.toFixed(2)} USD`);
  console.log('');

  let rows: Row[];
  if (args.ids.length > 0) {
    const clamped = args.ids.slice(0, cappedCount);
    const { rows: r } = await dbQuery<Row>(
      `SELECT id, source, headline, fact_sheet, chosen_hook
         FROM helios_social.article_queue
        WHERE id = ANY($1::uuid[])
          AND hook_gate_pass IS TRUE
          AND fact_sheet IS NOT NULL
          AND chosen_hook IS NOT NULL`,
      [clamped],
    );
    rows = r;
  } else {
    const { rows: r } = await dbQuery<Row>(
      `SELECT id, source, headline, fact_sheet, chosen_hook
         FROM helios_social.article_queue
        WHERE hook_gate_pass IS TRUE
          AND plan_generated_at IS NULL
          AND fact_sheet IS NOT NULL
          AND chosen_hook IS NOT NULL
        ORDER BY hook_scored_at DESC
        LIMIT $1`,
      [cappedCount],
    );
    rows = r;
  }

  if (rows.length === 0) {
    console.error('[plan-dry-run] No articles matched. Nothing to do.');
    process.exit(0);
  }

  console.log(`[plan-dry-run] Running ${rows.length} article(s)…\n`);

  let cumulativeCost = 0;
  const results: Array<{
    id: string;
    source: string;
    headline: string;
    ok: boolean;
    bucket: string | null;
    slideCount: number | null;
    validationIssues: string[];
    spent: number;
    error: string | null;
  }> = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const projected = cumulativeCost + 0.20;
    if (projected > config.DRY_RUN_MAX_USD) {
      console.error(`[plan-dry-run] HALT — cumulative $${cumulativeCost.toFixed(4)} + est next $0.20 would exceed cap $${config.DRY_RUN_MAX_USD.toFixed(2)}. Stopping after ${i}/${rows.length}.`);
      break;
    }

    const label = `${i + 1}/${rows.length}`;
    console.log(`── ${label} ${row.source}: ${row.headline.slice(0, 88)}`);
    console.log(`   id=${row.id}`);

    try {
      const strategyStart = Date.now();
      const strategyResult = await chooseStrategy({
        factSheet: row.fact_sheet as never,
        chosenHook: row.chosen_hook as never,
      });
      const strategyMs = Date.now() - strategyStart;
      cumulativeCost += strategyResult.usage.approxCostUsd;
      const s = strategyResult.strategy;
      console.log(`   strategy: value=${s.value_type}, arousal:${s.strategy_scores.arousal}/curiosity:${s.strategy_scores.curiosity}/knowledge:${s.strategy_scores.knowledge}, primary=${s.primary}, bucket=${s.bucket} (${s.target_slide_count} slides) — $${strategyResult.usage.approxCostUsd.toFixed(4)} in ${strategyMs}ms`);
      console.log(`     bucket: ${s.bucket_reason}`);
      console.log(`     archetype: ${s.archetype} — ${s.archetype_reason}`);

      const planStart = Date.now();
      const planResult = await buildStoryPlan({
        factSheet: row.fact_sheet as never,
        chosenHook: row.chosen_hook as never,
        strategy: s,
      });
      const planMs = Date.now() - planStart;
      cumulativeCost += planResult.usage.approxCostUsd;
      const plan = planResult.storyPlan;

      const validationIssues = validateStoryPlan(plan, s);

      console.log(`   story plan: ${plan.slide_count} slides — $${planResult.usage.approxCostUsd.toFixed(4)} in ${planMs}ms`);
      for (const slide of plan.slides) {
        console.log(`     ${String(slide.position).padStart(2)}. ${slide.beat.padEnd(9)} — ${slide.purpose}`);
        if (slide.swipe_reason) console.log(`         ↷ ${slide.swipe_reason}`);
      }
      if (plan.caption_plan) console.log(`   caption: ${plan.caption_plan}`);
      if (validationIssues.length > 0) {
        console.log(`   ⚠ ${validationIssues.length} validation issue(s):`);
        for (const issue of validationIssues) console.log(`     · ${issue}`);
      } else {
        console.log('   ✓ plan passes all validation checks');
      }

      // Persist.
      await dbQuery(
        `UPDATE helios_social.article_queue
            SET strategy          = $1::jsonb,
                bucket            = $2,
                archetype         = $3,
                story_plan        = $4::jsonb,
                plan_generated_at = now()
          WHERE id = $5`,
        [
          JSON.stringify(s),
          s.bucket,
          s.archetype,
          JSON.stringify(plan),
          row.id,
        ],
      );

      results.push({
        id: row.id,
        source: row.source,
        headline: row.headline,
        ok: true,
        bucket: s.bucket,
        slideCount: plan.slide_count,
        validationIssues,
        spent: strategyResult.usage.approxCostUsd + planResult.usage.approxCostUsd,
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ERROR: ${msg}`);
      results.push({
        id: row.id,
        source: row.source,
        headline: row.headline,
        ok: false,
        bucket: null,
        slideCount: null,
        validationIssues: [],
        spent: 0,
        error: msg,
      });
    }

    console.log(`   cumulative: $${cumulativeCost.toFixed(4)}\n`);
  }

  console.log('== SUMMARY ==');
  console.log('ok  | bucket             | slides | issues | source · headline');
  for (const r of results) {
    const mark = r.ok ? '✓ ' : '✗ ';
    const bucket = (r.bucket ?? '—').padEnd(18);
    const slides = r.slideCount !== null ? String(r.slideCount).padStart(2) : '--';
    const issues = String(r.validationIssues.length).padStart(2);
    console.log(`${mark} | ${bucket} | ${slides}    | ${issues}     | ${r.source} · ${r.headline.slice(0, 60)}`);
    if (r.error) console.log(`                                                → ${r.error}`);
  }
  console.log('');
  console.log(`total spend: $${cumulativeCost.toFixed(4)} USD  (cap $${config.DRY_RUN_MAX_USD.toFixed(2)})`);
  console.log(`ok: ${results.filter((r) => r.ok).length}/${results.length}`);
}

main().catch((err) => {
  console.error('[plan-dry-run] Unhandled:', err);
  process.exit(1);
});
