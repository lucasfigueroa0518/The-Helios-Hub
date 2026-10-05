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
 *   npx tsx scripts/social_daily.ts --jev-cap-usd 0.05 --reporter-cap-usd 0.50 --stories 3
 *
 * Live Jev needs Tommy's OK; the cap is required and enforced. With
 * --reporter-cap-usd the Reporter runs LIVE (Sonnet 5.5) on each story in
 * run order until --stories stories get past it; each brief is saved to the
 * run directory. Stages after the Reporter stay zero-cost stubs.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const capArg = process.argv.indexOf('--jev-cap-usd');
  const capUsd = capArg > 0 ? Number(process.argv[capArg + 1]) : NaN;
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error('--jev-cap-usd <amount> is required for a live run');
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? Number(process.argv[i + 1]) : undefined;
  };
  const reporterCap = arg('--reporter-cap-usd');
  const stories = arg('--stories') ?? 2;

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
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { liveMessagesCreate, runReporter } = await import('@/lib/social/reporter/reporter');
  const { readPage } = await import('@/lib/social/reporter/read-page');
  const { readableDate } = await import('@/lib/social/pipeline/reporter-stage');
  type PipelineStages = import('@/lib/social/pipeline/stages').PipelineStages;

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

  const reporterLog: unknown[] = [];
  if (reporterCap !== undefined) {
    if (!Number.isFinite(reporterCap) || reporterCap <= 0) throw new Error('--reporter-cap-usd must be a positive amount');
    const create = liveMessagesCreate(new Anthropic());
    const report: PipelineStages['report'] = async (story) => {
      // Approved budget is --stories live Reporter runs; never start another.
      if (reporterLog.length >= stories) {
        return { ok: false, reasonCode: 'cost-cap', detail: `live Reporter run limit (${stories}) reached`, costUsd: 0 };
      }
      const reads: Array<{ url: string; ok: boolean; chars?: number; error?: string }> = [];
      const r = await runReporter(
        { story: story.title, startingSources: story.sources, today: readableDate(now) },
        {
          create,
          costCapUsd: reporterCap,
          readPage: async (url) => {
            const page = await readPage(url);
            reads.push(page.ok ? { url, ok: true, chars: page.text.length } : { url, ok: false, error: page.error });
            return page;
          },
        },
      );
      const n = reporterLog.length + 1;
      if (r.raw) await fsp.writeFile(path.join(runDir, `brief-${n}.txt`), r.raw);
      reporterLog.push({ n, storyId: story.id, title: story.title, startingSources: story.sources, ok: r.ok, reason: r.ok ? null : r.reason, detail: r.ok ? null : r.detail, costUsd: r.costUsd, turns: r.turns, webSearches: r.webSearches, pageReadCalls: r.pageReads, reads });
      if (!r.ok) return { ok: false, reasonCode: r.reason, detail: r.detail, costUsd: r.costUsd };
      return { ok: true, value: { storyId: story.id, parsed: r.brief, raw: r.raw, pages: r.pages }, costUsd: r.costUsd };
    };
    stages.report = report;
  }

  const result = await runDay({ articles, stages, meter: createCostMeter(), log: createFileSetAsideLog(), now, targetPosts: stories });

  await fsp.writeFile(
    path.join(runDir, 'run.json'),
    JSON.stringify({ startedAt: now.toISOString(), articles: articles.length, jev: jevTally, reporter: reporterLog, result, selection }, null, 2),
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
    reporter: reporterLog.map((x) => { const { reads: _r, ...rest } = x as { reads: unknown }; return rest; }),
  }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  },
);
