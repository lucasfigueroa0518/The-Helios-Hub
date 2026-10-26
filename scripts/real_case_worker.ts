/**
 * Real Case Reels worker (planning/Real Case Reels/BUILD_PLAN.md M5). A route alongside Explainer
 * Reels (RC-01): it claims Real Case render jobs (Lucas's Make reel clicks) one at a time, and, while
 * `auto_scout` is on, runs the nightly story cycle once a New York day at 2:30 AM (RC-11). It shares
 * Explainer Reels' database connection, and from the Explainer side reads only its topics and its
 * voice setting.
 *
 *   npm run real-case:worker            # loop: poll every 15s
 *   npm run real-case:worker -- --once  # run the next queued render, then exit
 *
 * Database: EXPLAINERS_DATABASE_URL (locally: `npm run explainers:db`), as the Explainer worker; a
 * PGlite folder belongs to the dev server, so it is refused here. Renders need ANTHROPIC_API_KEY and
 * HEYGEN_API_KEY; without the HeyGen key the worker still runs the story cycle and skips renders.
 * Local only until a run validates it: never deployed to a VM without Lucas's OK.
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

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'real-case-worker', message, ...fields }));
}

const POLL_MS = 15_000;
/** The nightly story cycle's New York time (after the Explainer idea cycle at 2:00). */
export const STORY_CYCLE_AT_NY = { hour: 2, minute: 30 };
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Minutes past midnight in New York. */
function nyMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0) % 24;
  return get('hour') * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  if (!process.env.EXPLAINERS_DATABASE_URL?.trim() && process.env.EXPLAINERS_DB !== 'supabase') {
    log('missing_env', { name: 'EXPLAINERS_DATABASE_URL or EXPLAINERS_DB=supabase' });
    process.exit(1);
  }
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
  const heygenApiKey = process.env.HEYGEN_API_KEY?.trim() ?? '';
  if (!anthropicApiKey) log('renders_disabled', { reason: 'ANTHROPIC_API_KEY is not set' });
  if (!heygenApiKey) log('renders_disabled', { reason: 'HEYGEN_API_KEY is not set' });

  const { explainersDb } = await import('@/lib/explainers/connection');
  const { loadAgentQuery } = await import('@/lib/explainers/render/agent');
  const { artifactStoreFromEnv } = await import('@/lib/explainers/storage');
  const { anthropic } = await import('@/lib/anthropic');
  const { liveJevTransport } = await import('@/lib/reels/jev/client');
  const { ensureRealCaseSchema } = await import('@/lib/real-case/schema');
  const { claimNextRealCaseJob, failStaleRealCaseJobs } = await import('@/lib/real-case/jobs');
  const { runRealCaseJob } = await import('@/lib/real-case/render/job');
  const { anthropicFactChecker } = await import('@/lib/real-case/render/fact-check');
  const { runStoryCycle } = await import('@/lib/real-case/cycle');
  const { anthropicStoryScout } = await import('@/lib/real-case/scout');

  const db = await explainersDb();
  await ensureRealCaseSchema(db);
  const store = artifactStoreFromEnv();
  const jobsRoot = process.env.REAL_CASE_JOBS_DIR || path.join(process.cwd(), '.explainers-local', 'real-case', 'jobs');
  const stale = await failStaleRealCaseJobs(db, 'Worker restarted while this render was running.');
  if (stale) log('stale_jobs_failed', { count: stale });

  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      stopping = true;
      log('shutdown_requested', { signal });
    });
  }

  const renderNext = async (): Promise<boolean> => {
    if (!anthropicApiKey || !heygenApiKey) return false;
    const job = await claimNextRealCaseJob(db);
    if (!job) return false;
    log('job_claimed', { jobId: job.id, storyId: job.story_id, capUsd: job.spend_cap_usd });
    const outcome = await runRealCaseJob(
      {
        db,
        query: await loadAgentQuery(),
        store,
        jobsRoot,
        secrets: { anthropicApiKey, heygenApiKey },
        factChecker: anthropicFactChecker(anthropic),
        jevTransport: liveJevTransport,
        log: (event, fields) => log(event, fields),
      },
      job,
    );
    log('job_done', { jobId: job.id, ...outcome });
    return true;
  };

  if (once) {
    if (!(await renderNext())) log('nothing_queued');
    return;
  }

  while (!stopping) {
    try {
      const now = new Date();
      if (nyMinutes(now) >= STORY_CYCLE_AT_NY.hour * 60 + STORY_CYCLE_AT_NY.minute) {
        // Off unless auto_scout; once per New York day (runStoryCycle enforces both).
        const cycle = await runStoryCycle({ db, scout: anthropicStoryScout(anthropic), jevTransport: liveJevTransport, now });
        if (cycle.status !== 'skipped' || !['auto_scout_off', 'already_ran_today'].includes(cycle.reason)) log('story_cycle', cycle as never);
      }
      if (await renderNext()) continue;
    } catch (error) {
      log('loop_error', { error: errorText(error) });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  log('fatal', { error: errorText(error) });
  process.exit(1);
});
