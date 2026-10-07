/**
 * Explainer Reels worker (BUILD_PLAN §4–§6). Claims one queued render at a time
 * and runs it; while auto_render is on, also runs the daily idea cycle.
 *
 *   npm run explainers:worker          # loop: poll every 15s
 *   npm run explainers:worker -- --once   # run the next queued render, then exit
 *
 * Needs EXPLAINERS_DATABASE_URL (locally: `npm run explainers:db`),
 * ANTHROPIC_API_KEY, and HEYGEN_API_KEY. It never sees Supabase or outreach
 * keys it does not need, and passes only render keys to the agent.
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
/** The daily idea cycle runs once per Eastern day, at or after this hour (A-7: only with auto_render on). */
const IDEA_CYCLE_HOUR_NY = 9;

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
  required('EXPLAINERS_DATABASE_URL');
  const secrets = { anthropicApiKey: required('ANTHROPIC_API_KEY'), heygenApiKey: required('HEYGEN_API_KEY') };

  const { explainersDb } = await import('@/lib/explainers/connection');
  const { claimNextJob, failStaleRunningJobs, nyDate } = await import('@/lib/explainers/repository');
  const { runRenderJob } = await import('@/lib/explainers/render/job');
  const { loadAgentQuery } = await import('@/lib/explainers/render/agent');
  const { localArtifactStore } = await import('@/lib/explainers/storage');
  const { loadSettings } = await import('@/lib/explainers/settings');
  const { runIdeaCycle } = await import('@/lib/explainers/ideas/cycle');
  const { anthropicIdeaModel } = await import('@/lib/explainers/ideas/generator');
  const { anthropic } = await import('@/lib/anthropic');
  const { liveJevTransport } = await import('@/lib/reels/jev/client');

  const db = await explainersDb();
  const query = await loadAgentQuery();
  const store = localArtifactStore();
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

  let lastCycleDay = '';
  log('started', { pollMs: POLL_MS, jobsRoot });
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
    } catch (error) {
      log('loop_error', { error: error instanceof Error ? error.message : String(error) });
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
