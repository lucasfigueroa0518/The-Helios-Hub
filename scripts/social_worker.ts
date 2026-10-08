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
 * JPEGs in Storage, and the best posts take today's windows (9:00–10:00 AM, 2:30–3:30 PM).
 *
 * Nothing is scheduled or published unless social.settings.publishing_live is
 * on. Insights: every 30 minutes while a carousel is fresh, and a 5:30 AM sweep.
 * Once social_hub.settings publisher_mode is 'live', releasing, posting and
 * the 30-minute insights reads belong to the single publisher (D40).
 *
 * Social Hub (P2-M1): a 5:45 AM account sweep into the social_hub schema, and
 * any refresh the hub queued (refresh-on-visit): account pull, carousel
 * insights, and the Trial Reels insights poll (its own claim and cooldown).
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
  const { releaseDueSchedules, scheduleRunPosts } = await import('@/lib/social/overnight/schedule');
  const { claimAndPublish } = await import('@/lib/social/overnight/publish');
  const { createLiveCarouselClient, metaConfigured } = await import('@/lib/social/overnight/meta');
  const { createCarouselInsightsClient, pollCarouselInsights } = await import('@/lib/social/overnight/insights');
  const { mediaBucket } = await import('@/lib/media-bucket');
  const slideBucket = mediaBucket(cfg.SLIDE_BUCKET);
  const { storeSlideJpegs } = await import('@/lib/social/overnight/slides');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { closeDbPool } = await import('@/lib/db');
  const hub = await import('@/lib/instagram/account-sweep');
  const { createGraph } = await import('@/lib/instagram/graph');
  const { pollDueInsights } = await import('@/lib/reels/media-insights/poll');
  const { publisherOwnsPublishing } = await import('@/lib/publishing/publisher');
  const query = await socialQuery();
  /** With publisher_mode 'live' the single publisher releases, posts and reads insights (D40). */
  const standDown = () => publisherOwnsPublishing(query, 'carousels');

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
  const nextHubSweep = () => nextRunAt(new Date(), cfg.HUB_SWEEP_HOUR_LOCAL, cfg.HUB_SWEEP_MINUTE_LOCAL);

  /** Account sweep for the Social Hub; `id` is the refresh row it reports into. */
  async function hubSweep(id: string, withPostPolls: boolean): Promise<void> {
    let stats = null;
    let failure: string | null = null;
    try {
      const graph = createGraph();
      stats = await hub.runAccountSweep({ query, call: graph.call, igUserId: graph.igUserId, publishingLimit: () => graph.ops.publishingLimit() });
      if (withPostPolls) {
        await insights(true).catch((error) => stats!.errors.push(`carousel insights: ${errorText(error)}`));
        await pollDueInsights({}).catch((error: unknown) => stats!.errors.push(`reels insights: ${errorText(error)}`));
      }
    } catch (error) {
      failure = errorText(error);
    }
    await hub.finishHubRefresh(query, id, stats, failure).catch((error) => log('hub_refresh_record_failed', { error: errorText(error) }));
    log('hub_sweep_complete', { id, failure, ...(stats ? { days: stats.days, demographics: stats.demographics, onlineHours: stats.onlineHours, quota: stats.quota, errors: stats.errors.slice(0, 5) } : {}) });
  }

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
      for (const scheduled of await scheduleRunPosts(query, run.id)) {
        log('schedule', scheduled.scheduled ? { runId: run.id, publishAt: scheduled.publishAt } : { runId: run.id, note: scheduled.note });
      }
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
    let hubSweepAt = nextHubSweep();
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

      if (Date.now() >= hubSweepAt.getTime()) {
        if (metaConfigured()) {
          const id = await hub.startOvernightRefresh(query).catch((error) => {
            log('hub_sweep_skipped', { error: errorText(error) });
            return null;
          });
          if (id) await hubSweep(id, false);
        }
        hubSweepAt = nextHubSweep();
        continue;
      }

      if (metaConfigured()) {
        await hub.failStaleRefreshes(query).catch(() => undefined);
        const refresh = await hub.claimHubRefresh(query).catch(() => null);
        if (refresh) {
          await hubSweep(refresh.id, true);
          continue;
        }
      }

      const claimed = await runs.claimRun(query).catch((error) => {
        log('claim_failed', { error: errorText(error) });
        return null;
      });
      if (claimed) {
        await carryOutRun(claimed).catch((error) => log('run_failed', { runId: claimed.id, error: errorText(error) }));
        continue;
      }

      if (!(await standDown()) && (await publishingLive().catch(() => false))) {
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

      if (Date.now() - lastInsights >= INSIGHTS_EVERY_MS && !(await standDown())) {
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
