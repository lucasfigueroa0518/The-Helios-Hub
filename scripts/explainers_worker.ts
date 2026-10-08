/**
 * Explainer Reels worker (BUILD_PLAN §4–§6, docs/social-overnight.md). Claims
 * one queued render at a time and runs it; while auto_render is on, also runs
 * the daily idea cycle at 2:00 AM New York. While publishing_live is on,
 * approved renders are scheduled into the 1:00–2:30 PM and 3:30–5:00 PM
 * windows and published (by the single publisher once publisher_mode is live).
 * Insights: every 30 minutes while a reel is fresh, and a 5:15 AM sweep.
 *
 *   npm run explainers:worker          # loop: poll every 15s
 *   npm run explainers:worker -- --once   # run the next queued render, then exit
 *
 * Database: EXPLAINERS_DATABASE_URL (locally: `npm run explainers:db`) or
 * EXPLAINERS_DB=supabase (the social worker VM). EXPLAINERS_STORAGE=bucket
 * copies render outputs to the `explainers` Supabase bucket. Renders need
 * ANTHROPIC_API_KEY and HEYGEN_API_KEY; without the HeyGen key the worker
 * still schedules, publishes and reads insights, and skips renders. Only
 * render keys are passed to the agent.
 */
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));
loadEnvFile(path.join(process.cwd(), 'scripts/gcp/explainers.env'));

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'explainers-worker', message, ...fields }));
}

const POLL_MS = 15_000;
const INSIGHTS_EVERY_MS = 30 * 60_000;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    log('missing_env', { name });
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  if (!process.env.EXPLAINERS_DATABASE_URL?.trim() && process.env.EXPLAINERS_DB !== 'supabase') {
    log('missing_env', { name: 'EXPLAINERS_DATABASE_URL or EXPLAINERS_DB=supabase' });
    process.exit(1);
  }
  const heygenApiKey = process.env.HEYGEN_API_KEY?.trim() ?? '';
  if (!heygenApiKey) log('renders_disabled', { reason: 'HEYGEN_API_KEY is not set' });
  const secrets = { anthropicApiKey: required('ANTHROPIC_API_KEY'), heygenApiKey };

  const { explainersDb } = await import('@/lib/explainers/connection');
  const { claimNextJob, failStaleRunningJobs, nyDate } = await import('@/lib/explainers/repository');
  const { runRenderJob } = await import('@/lib/explainers/render/job');
  const { loadAgentQuery } = await import('@/lib/explainers/render/agent');
  const { artifactStoreFromEnv, signArtifact } = await import('@/lib/explainers/storage');
  const { IDEA_CYCLE_HOUR_NY, EXPLAINERS_INSIGHTS_HOUR_NY, EXPLAINERS_INSIGHTS_MINUTE_NY } = await import('@/lib/explainers/publish/config');
  const { publishingLive, releaseDueSchedules, scheduleApproved } = await import('@/lib/explainers/publish/schedule');
  const { claimAndPublish } = await import('@/lib/explainers/publish/publish');
  const { createLiveReelClient, metaConfigured } = await import('@/lib/explainers/publish/meta');
  const { createExplainerInsightsClient, pollExplainerInsights } = await import('@/lib/explainers/publish/insights');
  const { publisherOwnsPublishing } = await import('@/lib/publishing/publisher');
  const { nextRunAt } = await import('@/lib/instagram/clock');
  const { loadSettings } = await import('@/lib/explainers/settings');
  const { runIdeaCycle } = await import('@/lib/explainers/ideas/cycle');
  const { anthropicIdeaModel } = await import('@/lib/explainers/ideas/generator');
  const { anthropic } = await import('@/lib/anthropic');
  const { liveJevTransport } = await import('@/lib/reels/jev/client');

  const db = await explainersDb();
  const query = await loadAgentQuery();
  const store = artifactStoreFromEnv();
  const jobsRoot = process.env.EXPLAINERS_JOBS_DIR || path.join(process.cwd(), '.explainers-local', 'jobs');

  // One worker, one render at a time: anything still `running` died with a previous process.
  const stale = await failStaleRunningJobs(db, 'Worker restarted while this render was running.');
  if (stale) log('stale_jobs_failed', { count: stale });

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('shutdown_requested', { signal });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  const renderNext = async (): Promise<boolean> => {
    if (!secrets.heygenApiKey) return false;
    const job = await claimNextJob(db);
    if (!job) return false;
    log('job_claimed', { jobId: job.id, topicId: job.topic_id, trigger: job.trigger, capUsd: job.spend_cap_usd });
    const outcome = await runRenderJob({ db, query, store, jobsRoot, secrets, log: (event, fields) => log(event, fields) }, job);
    log('job_finished', { jobId: job.id, ...outcome });
    return true;
  };

  if (once) {
    if (!(await renderNext())) log('nothing_queued');
    return;
  }

  /** With publisher_mode 'live' the single publisher releases, posts and reads insights (D40). */
  const standDown = () => publisherOwnsPublishing((text, params) => db.query(text, params) as never, 'explainers');

  /** Approved reels onto the clock, due slots into attempts, one attempt to Instagram. Only while publishing_live is on. */
  const publishStep = async (): Promise<void> => {
    if (!(await publishingLive(db))) return;
    const scheduled = await scheduleApproved(db);
    if (scheduled > 0) log('scheduled_approved', { count: scheduled });
    if (await standDown()) return;
    const released = await releaseDueSchedules(db);
    if (released > 0) log('schedule_due', { released });
    if (!metaConfigured()) return;
    const published = await claimAndPublish({ db, meta: createLiveReelClient(), signVideo: signArtifact });
    if (published) log('publish_complete', { ...published });
  };

  const insightsStep = async (force: boolean): Promise<void> => {
    if (!metaConfigured() || (await standDown())) return;
    const result = await pollExplainerInsights(db, createExplainerInsightsClient({ token: process.env.META_USER_ACCESS_TOKEN! }));
    if (force || result.considered > 0) log('insights_complete', { ...result });
  };

  let lastCycleDay = '';
  let lastInsights = 0;
  const nextSweep = () => nextRunAt(new Date(), EXPLAINERS_INSIGHTS_HOUR_NY, EXPLAINERS_INSIGHTS_MINUTE_NY);
  let sweepAt = nextSweep();
  log('started', { pollMs: POLL_MS, jobsRoot, ideaCycleHourNy: IDEA_CYCLE_HOUR_NY, nextInsightsAt: sweepAt.toISOString(), storage: process.env.EXPLAINERS_STORAGE ?? 'local' });
  while (!stopping) {
    try {
      const settings = await loadSettings(db);
      const now = new Date();
      const hourNy = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now));
      const today = nyDate(now);
      if (settings.auto_render && hourNy >= IDEA_CYCLE_HOUR_NY && lastCycleDay !== today) {
        lastCycleDay = today;
        const cycle = await runIdeaCycle({ db, ideaModel: anthropicIdeaModel(anthropic), jevTransport: liveJevTransport });
        log('idea_cycle', { status: cycle.status, ...('reason' in cycle ? { reason: cycle.reason } : {}) });
      }
      await renderNext();
      await publishStep().catch((error) => log('publish_failed', { error: errorText(error) }));
      if (Date.now() >= sweepAt.getTime() || Date.now() - lastInsights >= INSIGHTS_EVERY_MS) {
        const forced = Date.now() >= sweepAt.getTime();
        await insightsStep(forced).catch((error) => log('insights_failed', { error: errorText(error) }));
        lastInsights = Date.now();
        if (forced) sweepAt = nextSweep();
      }
    } catch (error) {
      log('loop_error', { error: errorText(error) });
    }
    for (let waited = 0; waited < POLL_MS && !stopping; waited += 1000) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  log('stopped');
}

main().catch((error) => {
  log('fatal', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
