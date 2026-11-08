/**
 * Reel AI Drama worker (planning/AI Mini Docs/HUB-WIRING-CONTRACT.md §7.1 item 4). Every poll: run a person's queued
 * Develop / Calibrate click; once per New York day, tend the pool (whatever `auto` says); while `auto` is on, the
 * nightly fill from DRAMA_NIGHT_HOUR_NY (lib/reel-ai-drama/night.ts) and the weekly development session; while
 * publishing is live, book approved reels; then the next production job, one at a time. A night job that finishes ok
 * books today's next open slot unapproved. Posting: while publishing is live and the shared publisher does not drive
 * AI Drama (publisher_mode off or shadow), this worker releases due slots, posts one attempt at a time and reads
 * insights, as the explainers worker does; with publisher_mode live it stands down. Every job spends up to the
 * per-reel cap, so the worker runs only with --yes.
 *
 *   npx tsx scripts/reel_ai_drama_worker.ts                # estimate only
 *   npx tsx scripts/reel_ai_drama_worker.ts --yes          # loop: poll every 15s
 *   npx tsx scripts/reel_ai_drama_worker.ts --yes --once   # run the next queued job, then exit
 *
 * Database: EXPLAINERS_DATABASE_URL or EXPLAINERS_DB=supabase (a PGlite folder belongs to the dev server). The schema
 * must already be applied (`npm run db:reel-ai-drama`); the worker never runs DDL in production. Jobs need
 * ANTHROPIC_API_KEY and HEYGEN_API_KEY; without them the worker claims no job. Host: REEL_AI_DRAMA_LOCAL_DIR roots
 * logs and job files; EXPLAINERS_STORAGE=bucket is needed for anything to be booked or posted. Never deployed
 * without Lucas's OK.
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync(path.join(process.cwd(), '.env.local')) ? fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'reel-ai-drama-worker', message, ...fields }));
}

const POLL_MS = 15_000;
/** How many times one worker puts a job back after an outage outlasted every wait. Each try resumes from what it already paid for. */
const OUTAGE_RESUMES = 2;
/** The night is re-checked at most this often (it runs once a New York day; a skipped night re-checks cheaply). */
const NIGHT_EVERY_MS = 15 * 60_000;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// One stray promise must not take the worker, and the render running in it, down.
process.on('unhandledRejection', (reason) => log('unhandled_rejection', { error: errorText(reason) }));

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  if (!process.env.EXPLAINERS_DATABASE_URL?.trim() && process.env.EXPLAINERS_DB !== 'supabase') {
    log('missing_env', { name: 'EXPLAINERS_DATABASE_URL or EXPLAINERS_DB=supabase' });
    process.exit(1);
  }
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { ensureReelAiDramaSchema } = await import('@/lib/reel-ai-drama/schema');
  const { loadSettings, saveSetting } = await import('@/lib/reel-ai-drama/settings');
  const { holdAwake } = await import('@/lib/reel-ai-drama/render/runner');
  const { resilientDb, waitForNetwork, withRetry } = await import('@/lib/reel-ai-drama/retry');
  const { dramaJobsDir, dramaLocalDir } = await import('@/lib/reel-ai-drama/local-dir');
  // Started offline (or woken into an outage), the worker waits for the database instead of dying.
  const db = resilientDb(await withRetry(() => explainersDb(), undefined));
  // Production never runs DDL here: a missing schema stops the worker with the command that applies it.
  await ensureReelAiDramaSchema(db);
  const settings = await loadSettings(db);
  const { rows } = await db.query<{ n: unknown }>("SELECT count(*) AS n FROM reel_ai_drama.jobs WHERE status = 'queued'");
  const queued = Number(rows[0]?.n ?? 0);
  console.log(
    `Estimate: ${queued} queued job(s), each up to $${settings.per_reel_cap_usd.toFixed(2)} (≤ $${(queued * settings.per_reel_cap_usd).toFixed(2)} now). ` +
      (settings.auto
        ? `Generate is on: up to ${settings.daily_render_cap} job(s) a day (≤ $${settings.daily_spend_cap_usd.toFixed(2)} a day) and one development session a week (≤ $${settings.weekly_dev_cap_usd.toFixed(2)}).`
        : 'Generate is off: only queued jobs and clicks run.'),
  );
  if (!process.argv.includes('--yes')) {
    console.log('Not run. Pass --yes to start the worker.');
    return;
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
  const heygenApiKey = process.env.HEYGEN_API_KEY?.trim() ?? '';
  if (!anthropicApiKey) log('jobs_disabled', { reason: 'ANTHROPIC_API_KEY is not set' });
  if (!heygenApiKey) log('jobs_disabled', { reason: 'HEYGEN_API_KEY is not set' });

  const { artifactStoreFromEnv } = await import('@/lib/explainers/storage');
  const { claimNextJob, failStaleJobs, harnessFailureStreak, requeueJob } = await import('@/lib/reel-ai-drama/production/jobs');
  const { runJob } = await import('@/lib/reel-ai-drama/production/run');
  const { weeklyTick } = await import('@/lib/reel-ai-drama/production/schedule');
  const { liveProductionDeps, liveScheduleDeps, runLiveCalibration, runLiveDevelopment } = await import('@/lib/reel-ai-drama/production/live');
  const { afterDramaJob, failStaleDramaRequests, runNextDramaRequest } = await import('@/lib/reel-ai-drama/requests');
  const { runDramaNight, tendPoolOncePerDay } = await import('@/lib/reel-ai-drama/night');
  const { DRAMA_NIGHT_HOUR_NY } = await import('@/lib/reel-ai-drama/publish/config');
  const { dramaPublishingLive, dramaReleaseDue, scheduleApprovedDrama } = await import('@/lib/reel-ai-drama/publish/schedule');
  const { claimAndCarryDrama } = await import('@/lib/reel-ai-drama/publish/publish');
  const { pollDramaInsights } = await import('@/lib/reel-ai-drama/publish/insights');
  const { DRAMA_INSIGHTS_HOUR_NY, DRAMA_INSIGHTS_MINUTE_NY } = await import('@/lib/reel-ai-drama/publish/config');
  const { publisherOwnsPublishing } = await import('@/lib/publishing/publisher');
  const { createLiveReelClient, metaConfigured } = await import('@/lib/explainers/publish/meta');
  const { createExplainerInsightsClient } = await import('@/lib/explainers/publish/insights');
  const { signArtifact } = await import('@/lib/explainers/storage');
  const { nextRunAt } = await import('@/lib/instagram/clock');
  const { tendPool } = await import('@/lib/reel-ai-drama/development/pool');

  const storage = process.env.EXPLAINERS_STORAGE?.trim() === 'bucket' ? 'bucket' : 'local';
  log('storage', { storage, localDir: dramaLocalDir(), jobsDir: dramaJobsDir() });
  if (storage !== 'bucket') log('storage_local_only', { note: 'Videos stay on this disk: nothing this worker makes can be booked or published (set EXPLAINERS_STORAGE=bucket).' });

  const store = artifactStoreFromEnv();
  const stale = await failStaleJobs(db, 'Worker restarted while this job was running.');
  if (stale) log('stale_jobs_failed', { count: stale });
  const staleRequests = await failStaleDramaRequests(db);
  if (staleRequests) log('stale_requests_failed', { count: staleRequests });

  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      stopping = true;
      log('shutdown_requested', { signal });
    });
  }

  const resumes = new Map<string, number>();
  const runNext = async (): Promise<boolean> => {
    if (!anthropicApiKey || !heygenApiKey) return false;
    const job = await claimNextJob(db);
    if (!job) return false;
    log('job_claimed', { jobId: job.id, pitchId: job.pitch_id, capUsd: job.spend_cap_usd, trigger: job.trigger });
    const deps = await liveProductionDeps({ db, store, secrets: { anthropicApiKey, heygenApiKey }, log: (event, fields) => log(event, fields) });
    // A Mac host stays awake for the job (a no-op off darwin; released even if the job throws).
    const release = holdAwake();
    try {
      const outcome = await runJob(deps, job);
      log('job_done', { jobId: job.id, ...outcome });
      if (outcome.status === 'ok') {
        try {
          const after = await afterDramaJob(db, job);
          log('job_delivered', { jobId: job.id, caption: after.caption, booked: after.booked });
        } catch (error) {
          log('job_delivery_failed', { jobId: job.id, error: errorText(error) });
        }
      }
      const tried = resumes.get(job.id) ?? 0;
      if (outcome.status === 'failed' && outcome.failureClass === 'network' && tried < OUTAGE_RESUMES) {
        resumes.set(job.id, tried + 1);
        await waitForNetwork();
        log('job_resuming_after_outage', { jobId: job.id, requeued: await requeueJob(db, job.id) });
      } else if (outcome.status === 'failed' && (await harnessFailureStreak(db)) >= 2 && (await loadSettings(db)).auto) {
        // Two harness failures in a row: automatic runs stop until someone repairs it and turns Generate back on.
        await saveSetting(db, 'auto', false);
        log('auto_stopped', { reason: 'two jobs in a row failed outside the story', jobId: job.id });
      }
    } finally {
      release();
    }
    return true;
  };

  if (once) {
    if (!(await runNext())) log('nothing_queued');
    return;
  }

  const nyHour = (at: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(at)) % 24;
  let nightCheckedAt = 0;
  let lastNight = '';
  const schedule = liveScheduleDeps(db, (event, fields) => log(event, fields));
  /** With publisher_mode 'live' (and its heartbeat naming AI Drama) the shared publisher releases, posts and reads insights. */
  const standDown = () => publisherOwnsPublishing((text, params) => db.query(text, params) as never, 'reel_ai_drama');
  const nextInsights = () => nextRunAt(new Date(), DRAMA_INSIGHTS_HOUR_NY, DRAMA_INSIGHTS_MINUTE_NY);
  let insightsAt = nextInsights();
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      log('step_failed', { step: name, error: errorText(error) });
    }
  };
  while (!stopping) {
    const now = new Date();
    // A person's Develop / Calibrate click, queued by the app.
    await step('requests', async () => {
      if (!anthropicApiKey) return;
      const done = await runNextDramaRequest(db, { develop: (d) => runLiveDevelopment(d, 'click'), calibrate: (d) => runLiveCalibration(d) });
      if (done) log('request_done', { id: done.id, kind: done.kind, status: done.status, error: done.error });
    });
    // Once a New York day, whatever Generate says: re-rank and retire stale news (no model call).
    await step('tend_pool', async () => {
      const tended = await tendPoolOncePerDay(db, async () => tendPool(db, await loadSettings(db), now), now);
      if (tended) log('pool_tended', tended);
    });
    const current = await loadSettings(db).catch(() => settings);
    if (current.auto && nyHour(now) >= DRAMA_NIGHT_HOUR_NY && Date.now() - nightCheckedAt >= NIGHT_EVERY_MS) {
      nightCheckedAt = Date.now();
      await step('night', async () => {
        const night = await runDramaNight({ db, now, log: (event, fields) => log(event, fields) });
        const key = JSON.stringify(night.status === 'skipped' ? night : { status: night.status });
        if (key !== lastNight || night.status !== 'skipped') log('night', night as unknown as Record<string, unknown>);
        lastNight = key;
      });
    }
    await step('weekly', async () => {
      const tick = await weeklyTick(schedule, now);
      if (tick.auto && (tick.development === 'ran' || tick.development === 'failed')) log('weekly_tick', tick as unknown as Record<string, unknown>);
    });
    // Approved reels onto the clock; then, unless the shared publisher drives AI Drama, due slots into attempts and one
    // attempt to Instagram. Only while publishing_live is on.
    await step('publish', async () => {
      if (!(await dramaPublishingLive(db))) return;
      const booked = await scheduleApprovedDrama(db, now);
      if (booked) log('approved_booked', { count: booked });
      if (await standDown()) return;
      const released = await dramaReleaseDue(db);
      if (released) log('schedule_due', { released });
      if (!metaConfigured()) return;
      const posted = await claimAndCarryDrama({ db, meta: createLiveReelClient(), signVideo: signArtifact });
      if (posted) log('publish_complete', { ...posted });
    });
    if (now >= insightsAt) {
      insightsAt = nextInsights();
      await step('insights', async () => {
        if (!metaConfigured() || (await standDown())) return;
        const result = await pollDramaInsights(db, createExplainerInsightsClient({ token: process.env.META_USER_ACCESS_TOKEN! }));
        if (result.considered > 0) log('insights_complete', { ...result });
      });
    }
    try {
      if (await runNext()) continue;
    } catch (error) {
      log('loop_error', { error: errorText(error) });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    log('fatal', { error: errorText(error) });
    process.exit(1);
  },
);
