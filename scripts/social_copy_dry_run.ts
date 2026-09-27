// scripts/social_copy_dry_run.ts — Editorial pipeline stages 5-7 dry run.
//
// From `~/.claude/skills/helios-social-editorial/SKILL.md`:
//   Stage 5: Copy per beat (Sonnet)
//   Stage 6: Voice pass — humanizer (Haiku, per-string) + polish (Sonnet, post-level)
//   Stage 7: Editorial QA (static + Sonnet)
//
// Reads articles that passed the plan stage (plan_generated_at NOT NULL) and
// haven't been QA'd yet (qa_pass IS NULL). Runs stages 5, 6, 7. Persists to
// article_queue. Prints slide-by-slide copy with span roles, caption, QA
// verdict, cost.
//
// Run:
//   npm run helios-social:copy-dry-run                  # default 3 articles
//   npm run helios-social:copy-dry-run -- --n 5         # 5 articles
//   npm run helios-social:copy-dry-run -- <id> <id>     # specific IDs

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
  published_at: string | null;
  fact_sheet: unknown;
  chosen_hook: unknown;
  strategy: unknown;
  story_plan: unknown;
};

async function main() {
  const { dbQuery } = await import('../lib/db');
  const config = await import('../lib/social/editorial/config');
  const { writeCopy } = await import('../lib/social/editorial/copy');
  const { humanizePost } = await import('../lib/social/copy/humanize');
  const { polishPost } = await import('../lib/social/editorial/polish');
  const { runEditorialQa } = await import('../lib/social/editorial/qa');
  const { repairPost } = await import('../lib/social/editorial/repair');

  const args = parseArgs(process.argv.slice(2));
  const defaultN = 3;
  const requested = args.count > 0 ? args.count : (args.ids.length > 0 ? args.ids.length : defaultN);
  const cappedCount = Math.min(requested, config.DRY_RUN_MAX_COUNT);
  if (cappedCount < requested) {
    console.error(`[copy-dry-run] Requested ${requested} but DRY_RUN_MAX_COUNT is ${config.DRY_RUN_MAX_COUNT} — capping.`);
  }

  console.log('[copy-dry-run] Editorial stages 5-7 dry run');
  console.log(`[copy-dry-run] editorial=${config.EDITORIAL_MODEL} humanizer=${config.HUMANIZER_MODEL}`);
  console.log(`[copy-dry-run] spend cap: $${config.DRY_RUN_MAX_USD.toFixed(2)} USD`);
  console.log('');

  let rows: Row[];
  if (args.ids.length > 0) {
    const clamped = args.ids.slice(0, cappedCount);
    const { rows: r } = await dbQuery<Row>(
      `SELECT id, source, headline, published_at, fact_sheet, chosen_hook, strategy, story_plan, copy_json
         FROM helios_social.article_queue
        WHERE id = ANY($1::uuid[])
          AND plan_generated_at IS NOT NULL
          AND fact_sheet IS NOT NULL
          AND chosen_hook IS NOT NULL
          AND strategy IS NOT NULL
          AND story_plan IS NOT NULL`,
      [clamped],
    );
    rows = r;
  } else {
    const { rows: r } = await dbQuery<Row>(
      `SELECT id, source, headline, published_at, fact_sheet, chosen_hook, strategy, story_plan, copy_json
         FROM helios_social.article_queue
        WHERE plan_generated_at IS NOT NULL
          AND (qa_pass IS NULL OR qa_pass IS FALSE)
          AND fact_sheet IS NOT NULL
          AND chosen_hook IS NOT NULL
          AND strategy IS NOT NULL
          AND story_plan IS NOT NULL
        ORDER BY plan_generated_at DESC
        LIMIT $1`,
      [cappedCount],
    );
    rows = r;
  }

  if (rows.length === 0) {
    console.error('[copy-dry-run] No articles matched. Nothing to do.');
    process.exit(0);
  }

  console.log(`[copy-dry-run] Running ${rows.length} article(s)…\n`);

  let cumulativeCost = 0;
  const results: Array<{
    id: string;
    source: string;
    headline: string;
    ok: boolean;
    qaPass: boolean | null;
    staticIssues: number;
    voiceIssues: number;
    missingWs: number;
    spent: number;
    error: string | null;
  }> = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    // Copy stage is the expensive one (~$0.10-0.15). Budget guard.
    const projected = cumulativeCost + 0.30;
    if (projected > config.DRY_RUN_MAX_USD) {
      console.error(`[copy-dry-run] HALT — cumulative $${cumulativeCost.toFixed(4)} + est next $0.30 would exceed cap $${config.DRY_RUN_MAX_USD.toFixed(2)}. Stopping after ${i}/${rows.length}.`);
      break;
    }

    const label = `${i + 1}/${rows.length}`;
    console.log(`── ${label} ${row.source}: ${row.headline.slice(0, 88)}`);
    console.log(`   id=${row.id}`);

    try {
      const copyStart = Date.now();
      const copyResult = await writeCopy({
        factSheet: row.fact_sheet as never,
        chosenHook: row.chosen_hook as never,
        strategy: row.strategy as never,
        storyPlan: row.story_plan as never,
        articlePublishedAt: row.published_at,
      });
      const copyMs = Date.now() - copyStart;
      cumulativeCost += copyResult.usage.approxCostUsd;
      console.log(`   copy: ${copyResult.post.slides.length} slides, caption ${copyResult.post.caption.length} chars — $${copyResult.usage.approxCostUsd.toFixed(4)} in ${copyMs}ms`);
      // Persist copy_json immediately — a polish/qa error after this line
      // shouldn't lose the expensive stage 5 output.
      await dbQuery(
        `UPDATE helios_social.article_queue
            SET copy_json = $1::jsonb
          WHERE id = $2`,
        [JSON.stringify(copyResult.post), row.id],
      );

      const humanStart = Date.now();
      // humanizePost expects a render Post; but our EditorialPost is a
      // superset of the fields it edits. Adapt by supplying only the fields
      // it needs and re-attach our EditorialPost metadata after.
      const adapted = {
        format: 'carousel' as const,
        storyType: 'tech' as const,
        source: row.source,
        sourceUrl: '',
        publishedAt: '',
        issueNumber: 0,
        caption: copyResult.post.caption,
        slides: copyResult.post.slides.map((s) => ({
          position: s.position,
          layoutVariant: 'story_beat' as const,
          headline: s.headline ?? undefined,
          body: s.body ?? undefined,
          bodyBottom: s.bodyBottom ?? undefined,
          title: s.title ?? undefined,
          altText: s.altText,
        })),
      };
      const humanized = await humanizePost(adapted);
      const humanMs = Date.now() - humanStart;
      cumulativeCost += (humanized.usage.inputTokens * 1
        + humanized.usage.cacheReadTokens * 0.1
        + humanized.usage.cacheWriteTokens * 1.25
        + humanized.usage.outputTokens * 5) / 1_000_000;
      console.log(`   humanizer: ${humanized.usage.inputTokens + humanized.usage.cacheReadTokens} in, ${humanized.usage.outputTokens} out — $${((humanized.usage.inputTokens * 1 + humanized.usage.cacheReadTokens * 0.1 + humanized.usage.cacheWriteTokens * 1.25 + humanized.usage.outputTokens * 5) / 1_000_000).toFixed(4)} in ${humanMs}ms`);

      // Rewrap humanized text into the EditorialPost shape.
      const humanizedEditorial = {
        slides: copyResult.post.slides.map((original, idx) => {
          const humanizedSlide = humanized.post.slides[idx];
          return {
            ...original,
            headline: humanizedSlide?.headline ?? original.headline,
            body: humanizedSlide?.body ?? original.body,
            bodyBottom: humanizedSlide?.bodyBottom ?? original.bodyBottom,
            title: humanizedSlide?.title ?? original.title,
          };
        }),
        caption: humanized.post.caption,
      };

      const polishStart = Date.now();
      const polished = await polishPost(humanizedEditorial);
      const polishMs = Date.now() - polishStart;
      cumulativeCost += polished.usage.approxCostUsd;
      console.log(`   polish: ${polished.changes.length} cross-slide change(s) — $${polished.usage.approxCostUsd.toFixed(4)} in ${polishMs}ms`);
      for (const change of polished.changes) {
        console.log(`     ↳ slide ${change.position} ${change.field}: ${change.rule} — ${change.note}`);
      }

      const qaStart = Date.now();
      let qa = await runEditorialQa(polished.post, row.fact_sheet as never);
      let finalPost = polished.post;
      let qaMs = Date.now() - qaStart;
      cumulativeCost += qa.usage.approxCostUsd;
      console.log(`   qa: ${qa.pass ? '✓ PASS' : '✗ FAIL'} — $${qa.usage.approxCostUsd.toFixed(4)} in ${qaMs}ms`);

      // Layer 2 — targeted repair pass. If QA flagged 1-5 fixable issues,
      // run a scoped Haiku repair, then re-run QA on the fixed post. Cap
      // at 1 repair attempt to prevent runaway cost on structurally
      // broken posts.
      const totalFixable = qa.static_issues.length + qa.llm.voice_issues.length;
      if (!qa.pass && totalFixable > 0 && totalFixable <= 5) {
        const repairStart = Date.now();
        const repair = await repairPost({
          post: polished.post,
          qa,
          factSheet: row.fact_sheet as never,
        });
        const repairMs = Date.now() - repairStart;
        cumulativeCost += repair.usage.approxCostUsd;
        console.log(`   repair: fixed ${repair.fixedPositions.length} slide(s) [${repair.fixedPositions.join(', ')}] — $${repair.usage.approxCostUsd.toFixed(4)} in ${repairMs}ms`);
        finalPost = repair.post;

        // Re-run QA on the repaired post.
        const qa2Start = Date.now();
        qa = await runEditorialQa(finalPost, row.fact_sheet as never);
        qaMs = Date.now() - qa2Start;
        cumulativeCost += qa.usage.approxCostUsd;
        console.log(`   qa (after repair): ${qa.pass ? '✓ PASS' : '✗ FAIL'} — $${qa.usage.approxCostUsd.toFixed(4)} in ${qaMs}ms`);
      }

      // Print slide-by-slide copy summary.
      console.log('   ── slides:');
      for (const slide of finalPost.slides) {
        const chunks: string[] = [];
        for (const field of ['title', 'headline', 'body', 'bodyBottom'] as const) {
          const run = slide[field];
          if (!run) continue;
          const text = run.map((s) => {
            if (s.role === 'hook') return `⟨orange:${s.text}⟩`;
            if (s.role === 'pivot') return `⟨green:${s.text}⟩`;
            return s.text;
          }).join('');
          chunks.push(`${field}: ${text}`);
        }
        console.log(`     ${String(slide.position).padStart(2)}. ${slide.beat.padEnd(9)} ${chunks.join(' | ')}`);
      }
      console.log(`   caption: "${finalPost.caption.slice(0, 200)}${finalPost.caption.length > 200 ? '…' : ''}"`);

      // Print QA issues.
      if (qa.static_issues.length > 0) {
        console.log(`   ⚠ static issues (${qa.static_issues.length}):`);
        for (const issue of qa.static_issues) console.log(`     · ${issue}`);
      }
      const missingWs = Object.entries(qa.llm.five_ws).filter(([, w]) => !w.answered);
      if (missingWs.length > 0) {
        console.log(`   ⚠ five Ws missing (${missingWs.length}):`);
        for (const [k, w] of missingWs) console.log(`     · ${k}: ${w.reason}`);
      }
      if (qa.llm.voice_issues.length > 0) {
        console.log(`   ⚠ voice issues (${qa.llm.voice_issues.length}):`);
        for (const iss of qa.llm.voice_issues) console.log(`     · slide ${iss.position} ${iss.field}: ${iss.pattern} — "${iss.text}"`);
      }

      // Persist.
      await dbQuery(
        `UPDATE helios_social.article_queue
            SET copy_json       = $1::jsonb,
                voice_passed_at = now(),
                qa_result       = $2::jsonb,
                qa_pass         = $3,
                qa_passed_at    = now()
          WHERE id = $4`,
        [
          JSON.stringify(finalPost),
          JSON.stringify(qa),
          qa.pass,
          row.id,
        ],
      );

      results.push({
        id: row.id,
        source: row.source,
        headline: row.headline,
        ok: true,
        qaPass: qa.pass,
        staticIssues: qa.static_issues.length,
        voiceIssues: qa.llm.voice_issues.length,
        missingWs: missingWs.length,
        spent: copyResult.usage.approxCostUsd + polished.usage.approxCostUsd + qa.usage.approxCostUsd,
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
        qaPass: null,
        staticIssues: 0,
        voiceIssues: 0,
        missingWs: 0,
        spent: 0,
        error: msg,
      });
    }

    console.log(`   cumulative: $${cumulativeCost.toFixed(4)}\n`);
  }

  console.log('== SUMMARY ==');
  console.log('qa   | static | voice | ws | source · headline');
  for (const r of results) {
    const qaMark = r.qaPass === true ? '✓ ' : r.qaPass === false ? '✗ ' : '- ';
    const stat = String(r.staticIssues).padStart(2);
    const voice = String(r.voiceIssues).padStart(2);
    const ws = String(r.missingWs).padStart(2);
    console.log(`${qaMark}   |   ${stat}   |  ${voice}   | ${ws} | ${r.source} · ${r.headline.slice(0, 60)}`);
    if (r.error) console.log(`                                        → ${r.error}`);
  }
  console.log('');
  console.log(`total spend: $${cumulativeCost.toFixed(4)} USD  (cap $${config.DRY_RUN_MAX_USD.toFixed(2)})`);
  console.log(`qa passes: ${results.filter((r) => r.qaPass === true).length}/${results.length}`);
}

main().catch((err) => {
  console.error('[copy-dry-run] Unhandled:', err);
  process.exit(1);
});
