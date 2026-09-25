/**
 * Trial Reels nightly worker (FND-02 / D-017).
 *
 * Runs as its own systemd unit beside `helios-worker` so a long scrape can
 * never starve outreach drafting, and vice versa. Vercel does not run this.
 *
 *   npm run reels:worker        # schedule 1 AM America/New_York, then loop
 *   npm run reels:run           # one run now, then exit
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

function loadLocalEnvironment(): void {
  loadEnvFile(path.join(process.cwd(), '.env.local'));
  loadEnvFile(path.join(process.cwd(), 'scripts/gcp/worker.env'));
}

loadLocalEnvironment();

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), component: 'reels-worker', message, ...fields }),
  );
}

/** How often the worker looks for a Run now queued from the review page. */
const POLL_MS = 15_000;

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const { claimAndRun, runReelsNight } = await import('@/lib/reels/pipeline/run');
  const { claimAndWriteCopy } = await import('@/lib/reels/copy/jobs');
  const { claimAndRenderVisual } = await import('@/lib/reels/visual/run');
  const { claimAndRenderVideo } = await import('@/lib/reels/visual/video-run');
  const { nextRunAt } = await import('@/lib/reels/schedule');
  const { closeDbPool } = await import('@/lib/db');

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('shutdown_requested', { signal });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  try {
    if (once) {
      const outcome = await runReelsNight('manual');
      log('run_complete', { status: outcome.status, runId: outcome.runId, note: outcome.note });
      return;
    }

    let scheduledFor = nextRunAt(new Date());
    log('scheduled', { nextRunAt: scheduledFor.toISOString(), pollMs: POLL_MS });

    while (!stopping) {
      // Two ways in: the 1 AM schedule, and whatever the page queued.
      if (Date.now() >= scheduledFor.getTime()) {
        const outcome = await runReelsNight('scheduled');
        log('run_complete', { trigger: 'scheduled', status: outcome.status, runId: outcome.runId });
        scheduledFor = nextRunAt(new Date());
        log('scheduled', { nextRunAt: scheduledFor.toISOString() });
        continue;
      }

      const claimed = await claimAndRun().catch((error) => {
        log('claim_failed', { error: error instanceof Error ? error.message : String(error) });
        return null;
      });
      if (claimed) {
        log('run_complete', { trigger: 'manual', status: claimed.status, runId: claimed.runId });
        continue;
      }

      const copy = await claimAndWriteCopy().catch((error) => {
        log('copy_failed', { error: error instanceof Error ? error.message : String(error) });
        return null;
      });
      if (copy) {
        log('copy_complete', { id: copy.id, status: copy.status });
        await carryOn();
        continue;
      }

      const frame = await claimAndRenderVisual().catch((error) => {
        log('frame_failed', { error: error instanceof Error ? error.message : String(error) });
        return null;
      });
      if (frame) {
        log('frame_complete', { id: frame.id, status: frame.status });
        await carryOn();
        continue;
      }

      const video = await claimAndRenderVideo().catch((error) => {
        log('video_failed', { error: error instanceof Error ? error.message : String(error) });
        return null;
      });
      if (video) {
        log('video_complete', { id: video.id, status: video.status });
        await carryOn();
        continue;
      }

      if (await carryOn()) continue;

      await sleep(POLL_MS, () => stopping);
    }
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

/** Queue the next stage of any whole-generation request. True when one was queued. */
async function carryOn(): Promise<boolean> {
  const { advanceFinishes } = await import('@/lib/reels/visual/finish');
  return advanceFinishes().catch((error) => {
    log('finish_failed', { error: error instanceof Error ? error.message : String(error) });
    return false;
  });
}

/**
 * Chunked so SIGTERM is answered promptly instead of after a full poll. The
 * timer must stay referenced: it is the only thing holding the event loop
 * open between polls, and without it the process exits and misses 1 AM.
 */
function sleep(ms: number, cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      if (cancelled() || Date.now() >= deadline) {
        resolve();
        return;
      }
      setTimeout(tick, 1000);
    };
    tick();
  });
}

main().catch((error) => {
  log('fatal', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
