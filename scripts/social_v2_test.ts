/**
 * Local test runner for the v2 pipeline.
 *
 *   npm run social:v2:test -- --article <id>
 *   npm run social:v2:test -- --article <id> --from-brief runs/<ts>/brief.json
 *   npm run social:v2:test -- --article <id> --max-cost 0.75
 *
 * Reads the article from prod DB (SELECT only). Writes NOTHING to DB — the
 * pipeline's persistDebugAndCompose is intercepted and its would-be write is
 * captured to disk instead. Outputs land in runs/<ISO-timestamp>/ :
 *
 *   transcript.json  — captured debug + result + would-be render_post_json
 *   summary.md       — readable review: brief, slides w/ char counts, caption,
 *                      every code-check error, every fact-check round, costs
 *   brief.json       — reporterOutput + fetched source texts (for --from-brief)
 *
 * Cost cap defaults to $1.50 per run (override with --max-cost). If the cap
 * trips mid-run, the orchestrator bails to needs_human_review as it would
 * in production — the runner still writes whatever was captured.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({
    options: {
      article: { type: 'string' },
      'from-brief': { type: 'string' },
      'max-cost': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const articleId = values.article;
  const fromBriefPath = values['from-brief'];
  const maxCostArg = values['max-cost'];

  if (!articleId) {
    console.error('Usage: npm run social:v2:test -- --article <uuid> [--from-brief runs/<ts>/brief.json] [--max-cost 1.5]');
    process.exit(2);
  }

  // Set cost cap BEFORE importing orchestrate — its getMaxCostUsd() reads
  // process.env at call time so this order isn't strictly required, but
  // it's more obvious what's going on.
  if (maxCostArg !== undefined) {
    process.env.HELIOS_V2_MAX_COST_USD = maxCostArg;
  }

  // Dynamic imports so the cost-cap env is set before the orchestrator's
  // deps snapshot might latch anything.
  const { runCreatorPipeline } = await import('@/lib/social/editorial/v2/orchestrate');
  const { dbQuery } = await import('@/lib/db');
  const {
    buildFromBriefDeps,
    buildSummaryMarkdown,
    wrapDepsForCapture,
  } = await import('@/lib/social/editorial/v2/test-runner-support');

  // Load article (SELECT only — no writes).
  type Row = {
    id: string;
    source: string;
    source_url: string;
    headline: string;
    body: string;
    published_at: Date | string | null;
  };
  const { rows } = await dbQuery<Row>(
    `SELECT id, source, source_url, headline, body, published_at
       FROM helios_social.article_queue
      WHERE id = $1`,
    [articleId],
  );
  const row = rows[0];
  if (!row) {
    console.error(`Article ${articleId} not found`);
    process.exit(1);
  }
  if (!row.body || row.body.length < 200) {
    console.error(`Article ${articleId} body too thin (${row.body?.length ?? 0} chars, need ≥ 200)`);
    process.exit(1);
  }

  // Runs dir with ISO timestamp — safe for filesystem across OSes.
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(process.cwd(), 'runs', runId);
  await fs.mkdir(runDir, { recursive: true });

  console.log(`Article: ${row.id} — ${row.headline}`);
  console.log(`Run dir: ${runDir}`);
  console.log(`Cost cap: $${maxCostArg ?? '1.5'}`);

  // If --from-brief, load the cached brief and stub Reporter+fetchPage.
  let baseDeps: Awaited<ReturnType<typeof buildFromBriefDeps>> | Record<string, never> = {};
  let usedFromBrief = false;
  if (fromBriefPath) {
    const cached = JSON.parse(await fs.readFile(fromBriefPath, 'utf-8'));
    baseDeps = buildFromBriefDeps(cached);
    usedFromBrief = true;
    console.log(`Loaded cached brief: ${fromBriefPath}`);
    console.log(`  Reporter + fetchPage stubbed; Writer onwards runs live.`);
  }

  // Wrap deps so we capture reporterOutput, fetchedSources, and the
  // persist callback's inputs — without ever touching the DB.
  const { deps, captured } = wrapDepsForCapture({
    // If --from-brief: pass through the stubs. Otherwise runCreatorPipeline
    // will fall back to its own real defaults.
    ...(usedFromBrief ? baseDeps : {}),
  });

  console.log('Running pipeline...');
  const result = await runCreatorPipeline(
    {
      id: row.id,
      source: row.source,
      source_url: row.source_url,
      headline: row.headline,
      body: row.body,
      published_at: row.published_at,
    },
    {},
    deps,
  );
  captured.result = result;

  // Write transcript.json — everything captured, plus the row we ran against.
  await fs.writeFile(
    path.join(runDir, 'transcript.json'),
    JSON.stringify(
      {
        meta: {
          runId,
          articleId: row.id,
          articleHeadline: row.headline,
          articleSource: row.source,
          usedFromBrief,
          fromBriefPath: fromBriefPath ?? null,
          costCap: Number(process.env.HELIOS_V2_MAX_COST_USD ?? '1.5'),
        },
        result: captured.result,
        columns: {
          composeStatus: captured.composeStatus,
          composeError: captured.composeError,
          renderPostJson: captured.renderPostJson,
          renderSlug: captured.renderSlug,
        },
        debug: captured.debug,
      },
      null,
      2,
    ),
    'utf-8',
  );

  // Write brief.json — only if we ran the Reporter live and captured a real
  // ReporterOutput. In --from-brief mode we already have the source.
  if (!usedFromBrief && captured.reporterOutput) {
    await fs.writeFile(
      path.join(runDir, 'brief.json'),
      JSON.stringify(
        {
          reporterOutput: captured.reporterOutput,
          sourceTexts: captured.fetchedSources,
        },
        null,
        2,
      ),
      'utf-8',
    );
  }

  // Write summary.md — human-readable.
  const summary = buildSummaryMarkdown(captured, {
    articleId: row.id,
    articleHeadline: row.headline,
    runId,
    usedFromBrief,
  });
  await fs.writeFile(path.join(runDir, 'summary.md'), summary, 'utf-8');

  console.log('');
  console.log(`Status: ${result.status}`);
  if (result.reason) console.log(`Reason: ${result.reason}`);
  console.log(`Stages: ${result.stagesRun.join(' → ') || '(none)'}`);
  console.log(`Total cost: $${result.costUsd.toFixed(4)}`);
  console.log('');
  console.log(`Wrote: ${path.relative(process.cwd(), path.join(runDir, 'summary.md'))}`);
  console.log(`       ${path.relative(process.cwd(), path.join(runDir, 'transcript.json'))}`);
  if (!usedFromBrief && captured.reporterOutput) {
    console.log(`       ${path.relative(process.cwd(), path.join(runDir, 'brief.json'))}`);
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('social:v2:test failed:', err);
  process.exit(1);
});
