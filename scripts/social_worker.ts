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
 * Daily fill (D54): carousels a person placed for today count toward
 * posts_per_day, so the run makes (and schedules) only the rest, and is
 * skipped with the reason when nothing is left.
 *
 * A one-story rerun the Social Hub queued (Regenerate, social.rerun_requests,
 * D51) is claimed when no run is queued or running: it opens its own run and
 * the same child script carries it out (--rerun-post), under the run cap;
 * its new post is not auto-scheduled.
 *
 * Last Few Days (docs/superpowers/specs/2026-10-13-last-few-days-design.md
 * §7.3) shares this process instead of a unit of its own: at 3:00 on its days
 * (lfd.settings.days, Tue/Fri) with its auto_run on, a Last Few Days run is
 * queued instead of the carousel run. Its runs (3:00, or the hub's "Make Last
 * Few Days now") are claimed in this loop, so they never overlap a carousel
 * run; a finished post joins the spine and, while lfd publishing_live is on,
 * takes its day's 9:00–10:00 AM window. Its posts publish and its insights are
 * read here like carousels until the single publisher drives the type.
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
 * Social Hub Health: a 7:30 AM morning report (read-only) into
 * social_hub.health_reports, capped at 10 minutes so a hung query can't stall
 * this loop (a timeout logs health_report_failed).
 *
 * LIVE when auto_run is on: Claude, web search, Jev (~$2 a night, capped by
 * the run's cap_usd). The worker never turns either switch on.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { HubQuery } from '@/lib/social-hub/db';

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
  const { calendarDateKey, nextRunAt } = await import('@/lib/instagram/clock');
  const cfg = await import('@/lib/social/overnight/config');
  const { socialQuery } = await import('@/lib/social/store');
  const { autoRunOn, getSocialSetting, publishingLive, requireApproval } = await import('@/lib/social/overnight/settings');
  const runs = await import('@/lib/social/overnight/runs');
  const { carouselFill, nightStories, releaseDueSchedules, scheduleRunPosts } = await import('@/lib/social/overnight/schedule');
  const { quotaFilledNote, reportFill } = await import('@/lib/social-hub/fill');
  const { readTonightMoves } = await import('@/lib/social-hub/moves-store');
  const { ideaRef } = await import('@/lib/social-hub/views/moves');
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
  const lfdSettings = await import('@/lib/lfd/settings');
  const lfdStore = await import('@/lib/lfd/store');
  const { carryOutLfdRun, withLfdTimeout } = await import('@/lib/lfd/worker');
  const { LFD_RUN_TIMEOUT_MS } = await import('@/lib/lfd/config');
  const { threeAmQueue } = await import('@/lib/lfd/clock');
  const { liveLfdDeps } = await import('@/lib/lfd/live');
  const { liveMemesForPost } = await import('@/lib/memes/lfd-post-live');
  const { claimAndPublishLfd } = await import('@/lib/lfd/publish');
  const { releaseDueLfd } = await import('@/lib/lfd/schedule');
  const query = await socialQuery();
  /** The same connection, typed for lib/lfd (it takes the hub's query shape). */
  const lfdQuery = query as unknown as HubQuery;
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
  const nextHealthReport = () => nextRunAt(new Date(), cfg.HEALTH_REPORT_HOUR_LOCAL, cfg.HEALTH_REPORT_MINUTE_LOCAL);
  const health = await import('@/lib/social-hub/health/job');
  const { explainersHubQuery } = await import('@/lib/social-hub/db');
  const { readPosting } = await import('@/lib/content-type/posting');

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
  function runDailyScript(
    runId: string,
    stories: number,
    capUsd: number,
    rerunPostId?: string,
    storyIds: readonly string[] = [],
    moves: { promoteId: string | null; demoteIds: readonly string[] } = { promoteId: null, demoteIds: [] },
  ): Promise<{ code: number | null; tail: string }> {
    return new Promise((resolve) => {
      const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
      const args = [
        'scripts/social_daily.ts', '--run-id', runId, '--stories', String(stories), '--cap-usd', String(capUsd),
        ...(rerunPostId ? ['--rerun-post', rerunPostId] : []),
        ...storyIds.flatMap((id) => ['--story-id', id]),
        ...(moves.promoteId ? ['--promote-id', moves.promoteId] : []),
        ...moves.demoteIds.flatMap((id) => ['--demote-id', id]),
      ];
      const child = spawn(tsx, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let tail = '';
      const keep = (chunk: Buffer, stream: NodeJS.WriteStream) => {
        stream.write(chunk);
        tail = (tail + chunk.toString('utf8')).slice(-2000);
      };
      child.stdout.on('data', (chunk: Buffer) => keep(chunk, process.stdout));
      child.stderr.on('data', (chunk: Buffer) => keep(chunk, process.stderr));
      child.on('close', (code) => resolve({ code, tail }));
      child.on('error', (error) => resolve({ code: -1, tail: errorText(error) }));
    });
  }

  /**
   * A queued run, or a one-story rerun (`rerun`: its post; D51) carried out in the same child script.
   * `run.storyIds`: Run now named the stories to make (the top of the ranked queue); the run makes exactly those.
   */
  async function carryOutRun(run: { id: string; capUsd: number; storyIds?: string[]; trigger?: string }, rerun?: { requestId: string; postId: string }): Promise<void> {
    const pinned = run.storyIds ?? [];
    let stories = pinned.length || 1;
    let moves: { promoteId: string | null; demoteIds: string[] } = { promoteId: null, demoteIds: [] };
    if (!rerun && pinned.length) {
      log('run_pinned', { runId: run.id, storyIds: pinned });
    } else if (!rerun) {
      // Daily fill (D54): what people placed for today counts toward posts_per_day; the run makes only the rest.
      const runStories = (await getSocialSetting<number>('run_stories')) ?? cfg.DEFAULT_RUN_STORIES;
      // A failed read never strands the claimed run: it makes run_stories, as before the rule.
      const fill = await carouselFill(query).catch((error) => {
        log('fill_failed', { runId: run.id, error: errorText(error) });
        return null;
      });
      stories = fill ? nightStories(fill, runStories) : runStories;
      if (fill) reportFill(fill, log, { runId: run.id, runStories, stories });
      if (fill && stories < 1) {
        const note = `${quotaFilledNote(fill, 'carousel')} The run made nothing new.`;
        await runs.skipRun(query, run.id, note);
        log('run_skipped', { runId: run.id, reason: 'quota_filled', note });
        return;
      }
      // Shared queue: the 3 AM run makes tonight's carousel promote first and sinks demoted stories (a failed read: no moves).
      if (run.trigger === 'scheduled') {
        const tonight = await readTonightMoves(query, 'carousels');
        moves = { promoteId: tonight.promote ? ideaRef(tonight.promote.ideaId) : null, demoteIds: [...tonight.demoted].map(ideaRef) };
        if (moves.promoteId || moves.demoteIds.length) log('run_moves', { runId: run.id, ...moves });
      }
    }
    log('run_started', { runId: run.id, stories, capUsd: run.capUsd, ...(rerun ? { rerunOf: rerun.postId, rerunRequest: rerun.requestId } : {}) });
    const { code, tail } = await runDailyScript(run.id, stories, run.capUsd, rerun?.postId, pinned, moves);
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

    // A rerun's new version waits in Content ready for a person; only the nightly run fills today's windows.
    if (!rerun && (await publishingLive())) {
      for (const scheduled of await scheduleRunPosts(query, run.id)) {
        log('schedule', scheduled.scheduled ? { runId: run.id, publishAt: scheduled.publishAt } : { runId: run.id, note: scheduled.note });
      }
    }
  }

  async function insights(force: boolean): Promise<void> {
    if (!metaConfigured()) return;
    const client = createCarouselInsightsClient({ token: process.env.META_USER_ACCESS_TOKEN! });
    const result = await pollCarouselInsights(query, client);
    if (force || result.considered > 0) log('insights_complete', { ...result });
    // Last Few Days posts are feed carousels too: the same reads on the same cadence (spec §7.3).
    const lfd = await pollCarouselInsights(query, client, new Date(), 200, 'last_few_days');
    if (force || lfd.considered > 0) log('lfd_insights_complete', { ...lfd });
  }

  try {
    let runAt = nextRun();
    let sweepAt = nextSweep();
    let hubSweepAt = nextHubSweep();
    let healthAt = nextHealthReport();
    let lastInsights = 0;
    let lastRerunError: string | null = null;
    let lastLfdError: string | null = null;
    log('scheduled', { nextRunAt: runAt.toISOString(), nextInsightsAt: sweepAt.toISOString(), nextHealthReportAt: healthAt.toISOString(), pollMs: POLL_MS });

    while (!stopping) {
      if (Date.now() >= runAt.getTime()) {
        // 3:00 AM: on a Last Few Days day with its auto_run on, its run takes the carousel run's slot (LFD-02).
        const lfd = await lfdSettings.readLfdSettings(lfdQuery).catch((error) => {
          log('lfd_settings_failed', { error: errorText(error) });
          return null;
        });
        const slot = threeAmQueue(calendarDateKey(new Date()), lfd, await autoRunOn().catch(() => false));
        if (slot.queue === 'last_few_days' && lfd?.runCapUsd != null) {
          const id = await lfdStore.requestRun(lfdQuery, 'scheduled', lfd.runCapUsd).catch((error) => {
            log('lfd_request_failed', { error: errorText(error) });
            return null;
          });
          log('lfd_run_requested', { runId: id, trigger: 'scheduled' });
        } else if (slot.queue === 'carousels') {
          const capUsd = (await getSocialSetting<number>('run_cap_usd')) ?? cfg.DEFAULT_RUN_CAP_USD;
          const id = await runs.requestRun(query, 'scheduled', { capUsd, hookPass: true }).catch((error) => {
            log('request_failed', { error: errorText(error) });
            return null;
          });
          log('run_requested', { runId: id, trigger: 'scheduled' });
        } else {
          log('run_skipped', { reason: slot.reason });
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

      if (Date.now() >= healthAt.getTime()) {
        await health
          .withTimeout(
            health.runMorningReport({ q: query, explainersQ: explainersHubQuery, posting: (v) => readPosting(v) }, new Date()),
            health.MORNING_REPORT_TIMEOUT_MS,
            'health report',
          )
          .then((r) => log('health_report_complete', r))
          .catch((error) => log('health_report_failed', { error: errorText(error) }));
        healthAt = nextHealthReport();
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

      // Last Few Days runs (3:00 Tue/Fri, or the hub's button), in this same process: never beside a carousel run.
      const lfdClaimed = await lfdStore.claimRun(lfdQuery).catch((error) => {
        // Logged once per distinct error (e.g. before the lfd schema is applied), not every poll.
        const text = errorText(error);
        if (text !== lastLfdError) log('lfd_claim_failed', { error: text });
        lastLfdError = text;
        return null;
      });
      if (lfdClaimed) {
        // The engine is built with the cap carryOutLfdRun read and validated (lfd.settings.run_cap_usd).
        // A hung run must not stall this loop (3:00, publishing, insights, hub sweeps): past LFD_RUN_TIMEOUT_MS
        // it is failed and the loop goes on. The cut-off promise is not cancelled and may keep running in the
        // background (accepted; real runs take 3–8 minutes).
        const out = await withLfdTimeout(
          carryOutLfdRun(
            {
              query: lfdQuery,
              now: () => new Date(),
              log,
              engine: (run, capUsd) => liveLfdDeps(lfdQuery, { capUsd, trigger: run.trigger, runId: run.id }).then((r) => r.deps),
              // Memes in the post (lib/memes/lfd-post.ts), while lfd.settings.memes is on.
              memes: liveMemesForPost(lfdQuery, log),
            },
            lfdClaimed,
          ).catch((error) => ({ runId: lfdClaimed.id, status: 'failed' as const, note: errorText(error) })),
          LFD_RUN_TIMEOUT_MS,
          async () => {
            log('lfd_run_timeout', { runId: lfdClaimed.id });
            await lfdStore.failRun(lfdQuery, lfdClaimed.id, 'timed out after 30 minutes').catch((error) => log('lfd_fail_failed', { runId: lfdClaimed.id, error: errorText(error) }));
            return { runId: lfdClaimed.id, status: 'failed' as const, note: 'timed out after 30 minutes' };
          },
        );
        log('lfd_run_result', { ...out });
        continue;
      }

      // One-story reruns the Social Hub queued (D51), when no run is queued or running.
      const capUsd = (await getSocialSetting<number>('run_cap_usd').catch(() => null)) ?? cfg.DEFAULT_RUN_CAP_USD;
      const rerun = await runs.claimRerun(query, { capUsd, hookPass: true }).catch((error) => {
        // Logged once per distinct error (e.g. the table before db/social_schema.sql is applied), not every poll.
        const text = errorText(error);
        if (text !== lastRerunError) log('rerun_claim_failed', { error: text });
        lastRerunError = text;
        return null;
      });
      if (rerun) {
        await carryOutRun({ id: rerun.runId, capUsd: rerun.capUsd }, { requestId: rerun.id, postId: rerun.postId })
          .catch((error) => log('run_failed', { runId: rerun.runId, error: errorText(error) }));
        await runs.settleReruns(query).catch((error) => log('rerun_settle_failed', { error: errorText(error) }));
        const done = (await query(`SELECT status, new_post_id, error FROM social.rerun_requests WHERE id = $1`, [rerun.id]).catch(() => ({ rows: [] }))).rows[0];
        log('rerun_complete', { requestId: rerun.id, runId: rerun.runId, status: done?.status, newPostId: done?.new_post_id ?? null, error: done?.error ?? null });
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

      // Last Few Days posts the same way while the single publisher doesn't drive it (D40, D41).
      const lfdNow = await lfdSettings.readLfdSettings(lfdQuery).catch(() => null);
      if (lfdNow?.publishingLive && !(await publisherOwnsPublishing(query, 'last_few_days'))) {
        const due = await releaseDueLfd(query, { requireApproval: lfdNow.requireApproval }).catch((error) => {
          log('lfd_schedule_release_failed', { error: errorText(error) });
          return 0;
        });
        if (due > 0) log('lfd_schedule_due', { released: due });
        if (metaConfigured()) {
          const published = await claimAndPublishLfd({ query, meta: createLiveCarouselClient(), signImage: (p: string, secs: number) => slideBucket.sign(p, secs) }).catch((error) => {
            log('lfd_publish_failed', { error: errorText(error) });
            return null;
          });
          if (published) {
            log('lfd_publish_complete', { ...published });
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
