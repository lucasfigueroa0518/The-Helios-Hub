/**
 * Helios Social — the daily run, as the worker will do it (M8 schedules it):
 *
 *   fetch feeds → runDay (selection with LIVE Jev → Reporter → … → mechanical)
 *
 * Until M2+ exist, the stages after selection are zero-cost stubs, so a
 * run today does real selection and stops there in substance. Writes the
 * normal logs (set-aside, feed health in `Claude outputs/`) plus a run log
 * in runs/daily-<ts>/. No Claude, no DB.
 *
 *   npx tsx scripts/social_daily.ts --jev-cap-usd 0.05
 *
 * Live Jev needs Tommy's OK; the cap is required and enforced.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const capArg = process.argv.indexOf('--jev-cap-usd');
  const capUsd = capArg > 0 ? Number(process.argv[capArg + 1]) : NaN;
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error('--jev-cap-usd <amount> is required for a live run');

  const { HELIOS_SOCIAL_FEEDS } = await import('@/lib/social/feeds');
  const { capped, createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { fetchBodyLive } = await import('@/lib/social/ingest/select/enrich');
  const { createFileFeedHealthLog, fetchFeeds } = await import('@/lib/social/ingest/select/feed-health');
  const { createFilePosted } = await import('@/lib/social/ingest/select/posted');
  const { createCostMeter } = await import('@/lib/social/pipeline/cost-meter');
  const { runDay } = await import('@/lib/social/pipeline/orchestrator');
  const { createSelectionStage } = await import('@/lib/social/pipeline/selection-stage');
  const { createFileSetAsideLog } = await import('@/lib/social/pipeline/set-aside-log');
  const { createStubStages, STUB_COST_USD } = await import('@/lib/social/pipeline/stubs');
  type Selection = import('@/lib/social/ingest/select/select').Selection;

  const now = new Date();
  const runDir = path.join(process.cwd(), 'runs', `daily-${now.toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(runDir, { recursive: true });

  const articles = await fetchFeeds(HELIOS_SOCIAL_FEEDS);

  const jevTally = createJevTally();
  const jev = capped(tallied(createJevAsk(), jevTally), jevTally, capUsd);
  let selection: Selection | null = null;

  // M2+ are not built: zero-cost stubs, so the meter shows only real spend.
  const zero = Object.fromEntries(Object.keys(STUB_COST_USD).map((k) => [k, 0]));
  const stages = {
    ...createStubStages({ costUsd: zero }),
    score: createSelectionStage({
      feeds: HELIOS_SOCIAL_FEEDS,
      jev,
      posted: createFilePosted(),
      fetchBody: fetchBodyLive,
      feedHealthLog: createFileFeedHealthLog(),
      onSelection: (s) => {
        selection = s;
      },
    }),
  };

  const result = await runDay({ articles, stages, meter: createCostMeter(), log: createFileSetAsideLog(), now });

  await fsp.writeFile(
    path.join(runDir, 'run.json'),
    JSON.stringify({ startedAt: now.toISOString(), articles: articles.length, jev: jevTally, result, selection }, null, 2),
  );
  console.log(JSON.stringify({
    runDir: path.relative(process.cwd(), runDir),
    articles: articles.length,
    stopReason: result.stopReason,
    jevCalls: jevTally.calls,
    jevInputTokens: jevTally.inputTokens,
    jevCostUsd: Number(jevTally.costUsd.toFixed(6)),
    meterUsd: result.costUsd,
    setAsides: result.setAsides,
  }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  },
);
