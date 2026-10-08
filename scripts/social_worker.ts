/**
 * Helios Social carousel worker (docs/social-overnight.md). Runs as the
 * `helios-social` systemd unit on helios-social-worker. Vercel does not run this.
 *
 *   npm run social:worker
 *
 * 3:00 AM New York: when social.settings.auto_run is on, queue the day's run.
 * A queued run (3 AM or manual) is carried out by scripts/social_daily.ts in a
 * child process (--run-id), so a Chromium crash or memory spike ends the
 * child, not the worker. After it: each shipped post's slides are rendered to
 * JPEGs in Storage, and the best post takes today's 7:00–8:15 AM window.
 *
 * Nothing is scheduled or published unless social.settings.publishing_live is
 * on. Insights: every 30 minutes while a carousel is fresh, and a 5:30 AM sweep.
 *
 * LIVE when auto_run is on: Claude, web search, Jev (~$2 a night, capped by
 * the run's cap_usd). The worker never turns either switch on.
 */
import { spawn } from 'node:child_process';
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
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'social-worker', message, ...fields }));
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const POLL_MS = 15_000;
const INSIGHTS_EVERY_MS = 30 * 60_000;

async function main(): Promise<void> {
  const { nextRunAt } = await import('@/lib/instagram/clock');
  const cfg = await import('@/lib/social/overnight/config');
  const { socialQuery } = await import('@/lib/social/store');
  const { autoRunOn, getSocialSetting, publishingLive, requireApproval } = await import('@/lib/social/overnight/settings');
  const runs = await import('@/lib/social/overnight/runs');
  const { releaseDueSchedules, scheduleRunPost } = await import('@/lib/social/overnight/schedule');
  const { claimAndPublish } = await import('@/lib/social/overnight/publish');
  const { createLiveCarouselClient, metaConfigured } = await import('@/lib/social/overnight/meta');
  const { createCarouselInsightsClient, pollCarouselInsights } = await import('@/lib/social/overnight/insights');
  const { mediaBucket } = await import('@/lib/media-bucket');
  const slideBucket = mediaBucket(cfg.SLIDE_BUCKET);
  const { storeSlideJpegs } = await import('@/lib/social/overnight/slides');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { closeDbPool } = await import('@/lib/db');
  const query = await socialQuery();

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('shutdown_requested', { signal });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  const nextRun = () => nextRunAt(new Date(), cfg.SOCIAL_RUN_HOUR_LOCAL, cfg.SOCIAL_RUN_MINUTE_LOCAL);
  const nextSweep = () => nextRunAt(new Date(), cfg.SOCIAL_INSIGHTS_HOUR_LOCAL, cfg.SOCIAL_INSIGHTS_MINUTE_LOCAL);

  /** The daily script in a child process. Resolves with its exit code and the end of its stderr. */
  function runDailyScript(runId: string, stories: number, capUsd: number): Promise<{ code: number | null; tail: string }> {
    return new Promise((resolve) => {
      const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
      const child = spawn(tsx, ['scripts/social_daily.ts', '--run-id', runId, '--stories', String(stories), '--cap-usd', String(capUsd)], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'inherit', 'pipe'],
      });
      let tail = '';
      child.stderr.on('data', (chunk: Buffer) => {
        process.stderr.write(chunk);
        tail = (tail + chunk.toString('utf8')).slice(-2000);
      });
      child.on('close', (code) => resolve({ code, tail }));
      child.on('error', (error) => resolve({ code: -1, tail: errorText(error) }));
    });
  }

  async function carryOutRun(run: { id: string; capUsd: number }): Promise<void> {
    const stories = (await getSocialSetting<number>('run_stories')) ?? cfg.DEFAULT_RUN_STORIES;
    log('run_started', { runId: run.id, stories, capUsd: run.capUsd });
    const { code, tail } = await runDailyScript(run.id, stories, run.capUsd);
    // The script finishes the run itself; one still `running` means it died first.
    await runs.failRun(query, run.id, `The daily script exited (${code}) before finishing the run. ${tail}`);
    const status = (await query(`SELECT status FROM social.runs WHERE id = $1`, [run.id])).rows[0]?.status;
    log('run_complete', { runId: run.id, exitCode: code, status });

    for (const post of await runs.postsMissingSlides(query, run.id)) {
      try {
        const render = (await query(`SELECT render FROM social.posts WHERE id = $1`, [post.id])).rows[0]?.render;
        const objects = await storeSlideJpegs(post.slug, render, { fitCheck: checkRenderFit, upload: (p: string, b: Buffer) => slideBucket.upload(p, b, 'image/jpeg') });
        await runs.saveSlideObjects(query, post.id, objects);
        log('slides_stored', { slug: post.slug, slides: objects.length });
      } catch (error) {
        log('slides_failed', { slug: post.slug, error: errorText(error) });
      }
    }

    if (await publishingLive()) {
      const scheduled = await scheduleRunPost(query, run.id);
      log('schedule', scheduled.scheduled ? { runId: run.id, publishAt: scheduled.publishAt } : { runId: run.id, note: scheduled.note });
    }
  }

  async function insights(force: boolean): Promise<void> {
    if (!metaConfigured()) return;
    const result = await pollCarouselInsights(query, createCarouselInsightsClient({ token: process.env.META_USER_ACCESS_TOKEN! }));
    if (force || result.considered > 0) log('insights_complete', { ...result });
  }

  try {
    let runAt = nextRun();
    let sweepAt = nextSweep();
    let lastInsights = 0;
    log('scheduled', { nextRunAt: runAt.toISOString(), nextInsightsAt: sweepAt.toISOString(), pollMs: POLL_MS });

    while (!stopping) {
      if (Date.now() >= runAt.getTime()) {
        if (await autoRunOn().catch(() => false)) {
          const capUsd = (await getSocialSetting<number>('run_cap_usd')) ?? cfg.DEFAULT_RUN_CAP_USD;
          const id = await runs.requestRun(query, 'scheduled', { capUsd, hookPass: true }).catch((error) => {
            log('request_failed', { error: errorText(error) });
            return null;
          });
          log('run_requested', { runId: id, trigger: 'scheduled' });
        } else {
          log('run_skipped', { reason: 'auto_run is off' });
        }
        runAt = nextRun();
        continue;
      }

      if (Date.now() >= sweepAt.getTime()) {
        await insights(true).catch((error) => log('insights_failed', { error: errorText(error) }));
        lastInsights = Date.now();
        sweepAt = nextSweep();
        continue;
      }

      const claimed = await runs.claimRun(query).catch((error) => {
        log('claim_failed', { error: errorText(error) });
        return null;
      });
      if (claimed) {
        await carryOutRun(claimed).catch((error) => log('run_failed', { runId: claimed.id, error: errorText(error) }));
        continue;
      }

      if (await publishingLive().catch(() => false)) {
        const due = await releaseDueSchedules(query, { requireApproval: await requireApproval() }).catch((error) => {
          log('schedule_release_failed', { error: errorText(error) });
          return 0;
        });
        if (due > 0) log('schedule_due', { released: due });
        if (metaConfigured()) {
          const published = await claimAndPublish({ query, meta: createLiveCarouselClient(), signImage: (p: string, secs: number) => slideBucket.sign(p, secs) }).catch((error) => {
            log('publish_failed', { error: errorText(error) });
            return null;
          });
          if (published) {
            log('publish_complete', { ...published });
            continue;
          }
        }
      }

      if (Date.now() - lastInsights >= INSIGHTS_EVERY_MS) {
        await insights(false).catch((error) => log('insights_failed', { error: errorText(error) }));
        lastInsights = Date.now();
      }

      await sleep(POLL_MS, () => stopping);
    }
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

/** Chunked so SIGTERM is answered promptly; the referenced timer keeps the process alive between polls. */
function sleep(ms: number, cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      if (cancelled() || Date.now() >= deadline) return resolve();
      setTimeout(tick, Math.min(1000, deadline - Date.now()));
    };
    tick();
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  },
);
