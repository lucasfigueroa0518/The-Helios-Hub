/**
 * Reel AI Drama worker: claims production jobs one at a time (the lab's Make clicks, the schedule's
 * picks, a killed story's replacement) and, while `settings.auto` is on, runs the weekly clock
 * (production/schedule.ts: one development session a week under its cap, `per_week` jobs spread over
 * the week). Pattern: scripts/real_case_worker.ts. Every job spends up to the per-reel cap, so the
 * worker runs only with --yes.
 *
 *   npx tsx scripts/reel_ai_drama_worker.ts                # estimate only
 *   npx tsx scripts/reel_ai_drama_worker.ts --yes          # loop: poll every 15s
 *   npx tsx scripts/reel_ai_drama_worker.ts --yes --once   # run the next queued job, then exit
 *
 * Database: EXPLAINERS_DATABASE_URL or EXPLAINERS_DB=supabase (a PGlite folder belongs to the dev
 * server). Jobs need ANTHROPIC_API_KEY and HEYGEN_API_KEY; without them the worker claims no job (the
 * schedule still runs). Local only: never deployed without Lucas's OK.
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
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  if (!process.env.EXPLAINERS_DATABASE_URL?.trim() && process.env.EXPLAINERS_DB !== 'supabase') {
    log('missing_env', { name: 'EXPLAINERS_DATABASE_URL or EXPLAINERS_DB=supabase' });
    process.exit(1);
  }
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { ensureReelAiDramaSchema } = await import('@/lib/reel-ai-drama/schema');
  const { loadSettings } = await import('@/lib/reel-ai-drama/settings');
  const db = await explainersDb();
  await ensureReelAiDramaSchema(db);
  const settings = await loadSettings(db);
  const { rows } = await db.query<{ n: unknown }>("SELECT count(*) AS n FROM reel_ai_drama.jobs WHERE status = 'queued'");
  const queued = Number(rows[0]?.n ?? 0);
  console.log(
    `Estimate: ${queued} queued job(s), each up to $${settings.per_reel_cap_usd.toFixed(2)} (≤ $${(queued * settings.per_reel_cap_usd).toFixed(2)} now). ` +
      (settings.auto
        ? `Auto is on: ${settings.per_week} jobs a week (≤ $${(settings.per_week * settings.per_reel_cap_usd).toFixed(2)}) and one development session a week (≤ $${settings.weekly_dev_cap_usd.toFixed(2)}).`
        : 'Auto is off: only queued jobs run.'),
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
  const { claimNextJob, failStaleJobs } = await import('@/lib/reel-ai-drama/production/jobs');
  const { runJob } = await import('@/lib/reel-ai-drama/production/run');
  const { weeklyTick } = await import('@/lib/reel-ai-drama/production/schedule');
  const { liveProductionDeps, liveScheduleDeps } = await import('@/lib/reel-ai-drama/production/live');

  const store = artifactStoreFromEnv();
  const stale = await failStaleJobs(db, 'Worker restarted while this job was running.');
  if (stale) log('stale_jobs_failed', { count: stale });

  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      stopping = true;
      log('shutdown_requested', { signal });
    });
  }

  const runNext = async (): Promise<boolean> => {
    if (!anthropicApiKey || !heygenApiKey) return false;
    const job = await claimNextJob(db);
    if (!job) return false;
    log('job_claimed', { jobId: job.id, pitchId: job.pitch_id, capUsd: job.spend_cap_usd });
    const deps = await liveProductionDeps({ db, store, secrets: { anthropicApiKey, heygenApiKey }, log: (event, fields) => log(event, fields) });
    const outcome = await runJob(deps, job);
    log('job_done', { jobId: job.id, ...outcome });
    return true;
  };

  if (once) {
    if (!(await runNext())) log('nothing_queued');
    return;
  }

  const schedule = liveScheduleDeps(db, (event, fields) => log(event, fields));
  while (!stopping) {
    try {
      const tick = await weeklyTick(schedule, new Date());
      if (tick.auto && (tick.development === 'ran' || tick.development === 'failed' || tick.requested.length)) log('weekly_tick', tick as never);
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
