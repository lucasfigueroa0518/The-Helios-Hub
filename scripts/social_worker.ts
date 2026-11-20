/**
 * Helios Social carousel worker (docs/social-overnight.md). Runs as the
 * `helios-social` systemd unit on helios-social-worker. Vercel does not run this.
 *
 *   npm run social:worker
 *
 * 3:00 AM New York: queue the day's carousel run, every night and in every state
 * (settings standard D16, CONTRACT.md §4). Refill is not a control: the run's
 * selection (fetch or intake read, Jev scoring) writes the shortlist the carousel
 * pool reads, so it runs even while Carousels is paused, on a Last Few Days day or
 * when people already placed the day's quota (D3). Those nights the run makes no
 * story (`--stories 0`) and is held to pool_refill_cap_usd; it ends with
 * `refill_capped` when the cap stops it. Making posts follows makesPosts(state)
 * and the quota; scheduling and posting follow postsToInstagram(state).
 * A queued run (3 AM or manual) is carried out by scripts/social_daily.ts in a
 * child process (--run-id), so a Chromium crash or memory spike ends the
 * child, not the worker. After it: each shipped post's slides are rendered to
 * JPEGs in Storage, and the best posts take today's windows (9:00–10:00 AM, 2:30–3:30 PM).
 * Daily fill (D54): carousels a person placed for today count toward
 * posts_per_day, so the run makes (and schedules) only the rest; when nothing
 * is left it still refills the pool and makes nothing (D3).
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
 * AI Events This Week (planning/AI Events/DECISIONS.md, AE-08) shares this
 * process too: at 12:00 PM on its days (ai_events.settings.days, Sunday), in
 * every state, a run is queued that ranks the coming week's events (Jev
 * event-pick@1; the refill, D16) and, while AI Events makes posts, renders the
 * carousel (capped at run_cap_usd) and, only while Live, books the Sunday
 * 6:00–7:00 PM window; paused, it only ranks, under pool_refill_cap_usd. Its
 * runs (the clock, the hub's Generate or Rebuild post) are claimed after Last
 * Few Days', under the same 30-minute timeout. Its posts publish and their
 * insights are read here until the single publisher drives the type.
 *
 * Field Notes (planning/Field Notes/CONTRACT.md) shares this process the same way: at 2:00 AM, while it
 * makes posts (auto_run on), a run is queued for its next unfilled day that refills the tip pool and picks the tips,
 * writes the slides (live Claude and Jev, capped at run_cap_usd) and renders the carousel on the photo
 * pool; otherwise a Field Notes day (Tuesday, Friday) queues a refill-only run in every state (D16). Only
 * while Live does an approved post book the afternoon 2:30–3:30 PM window. Its runs (the clock, the hub's Generate or Rebuild post) are claimed after AI Events', under
 * the same 30-minute timeout. Its posts publish and their insights are read here until the single
 * publisher drives the type. Each poll also runs Field Notes' face check on new uploads (Vercel has no
 * Chromium): up to 10 photos queued 'pending' at upload, one shared headless browser per batch, no model
 * call (lib/field-notes/photos/faces-worker.ts).
 *
 * Nothing is scheduled or published unless the type's state is Live (stateOf
 * auto_run + publishing_live; Generate off with Live on reads as paused and logs
 * state_mismatch). Every post needs a person's approval: require_approval is never
 * read as off (D16). Insights: every 30 minutes while a carousel is fresh, and a 5:30 AM sweep.
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
 * LIVE when Carousels makes posts (Approval or Live): Claude, web search, Jev (~$2
 * a night, capped by the run's cap_usd). Every night otherwise: the refill only
 * (Jev selection, capped by pool_refill_cap_usd, $0.25 by default). The worker
 * never changes a state.
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
  const { getSocialSetting } = await import('@/lib/social/overnight/settings');
  const { logRefillCapped, readTypeGate } = await import('@/lib/social/refill');
  const { carouselNight, threeAmRequests } = await import('@/lib/social/overnight/night');
  const runs = await import('@/lib/social/overnight/runs');
  const { carouselFill, nightStoriesFor, releaseDueSchedules, scheduleRunPosts } = await import('@/lib/social/overnight/schedule');
  const { quotaFilledNote, reportFill } = await import('@/lib/social-hub/fill');
  const { readTonightMoves } = await import('@/lib/social-hub/moves-store');
  const { finishNightPlacements } = await import('@/lib/social-hub/queue-store');
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
  const { carryOutLfdRun } = await import('@/lib/lfd/worker');
  const { tapProcessOutput, withHangGuard } = await import('@/lib/content-runs/hang-guard');
  // Every log line counts as progress for the content-run hang guard.
  tapProcessOutput();
  const { threeAmQueue } = await import('@/lib/lfd/clock');
  const { isAiEventsDay, isFieldNotesDay, isLfdDay, slotPlan } = await import('@/lib/social-hub/slots');
  const { readSlotSource } = await import('@/lib/social-hub/slots/load');
  const { liveLfdDeps } = await import('@/lib/lfd/live');
  const { liveMemesForPost } = await import('@/lib/memes/lfd-post-live');
  const { claimAndPublishLfd } = await import('@/lib/lfd/publish');
  const { releaseDueLfd } = await import('@/lib/lfd/schedule');
  const aiEventsSettings = await import('@/lib/ai-events/settings');
  const aiEventsStore = await import('@/lib/ai-events/store');
  const { carryOutAiEventsRun } = await import('@/lib/ai-events/worker');
  const { AI_EVENTS_SPINE_VERTICAL } = await import('@/lib/ai-events/config');
  const { firstAiEventsCheckAt, nextAiEventsRunAt, noonQueue } = await import('@/lib/ai-events/clock');
  const { liveAiEventsDeps, liveAiEventsSnapshot } = await import('@/lib/ai-events/live');
  const { claimAndPublishAiEvents } = await import('@/lib/ai-events/publish');
  const { releaseDueAiEvents } = await import('@/lib/ai-events/schedule');
  const fieldNotesSettings = await import('@/lib/field-notes/settings');
  const fieldNotesStore = await import('@/lib/field-notes/store');
  const { carryOutFieldNotesRun } = await import('@/lib/field-notes/worker');
  const { FIELD_NOTES_SPINE_VERTICAL } = await import('@/lib/field-notes/config');
  const { firstFieldNotesCheckAt, nextFieldNotesRunAt, noonQueue: fieldNotesNoonQueue, refillNight: fieldNotesRefillNight } = await import('@/lib/field-notes/clock');
  const { fillDates, leadDaysFor } = await import('@/lib/social-hub/lead');
  const { liveFieldNotesDeps } = await import('@/lib/field-notes/live');
  const { claimAndPublishFieldNotes } = await import('@/lib/field-notes/publish');
  const { releaseDueFieldNotes } = await import('@/lib/field-notes/schedule');
  const { openLiveFaceDetector, runFacesStep } = await import('@/lib/field-notes/photos/faces-worker');
  const { PHOTO_BANK_BUCKET } = await import('@/lib/media-library/types');
  const { claimAndRunRevisions, startUpRevisions } = await import('@/lib/revisions/worker');
  const { newAnthropic } = await import('@/lib/anthropic-client');
  const intakeTypes = await import('@/lib/intake/types');
  const intakeRun = await import('@/lib/intake/run');
  const query = await socialQuery();
  /** The same connection, typed for lib/lfd (it takes the hub's query shape). */
  const lfdQuery = query as unknown as HubQuery;
  /** The same connection, typed for the central intake (object with .query). */
  const intakeQuery: import('@/lib/intake/types').IntakeQuery = { query: (text, params) => lfdQuery(text, params) };
  /** With publisher_mode 'live' the single publisher releases, posts and reads insights (D40). */
  const standDown = () => publisherOwnsPublishing(query, 'carousels');
  /** The public calendar snapshot after an AI Events run or post (plan M3). */
  const aiEventsSnapshot = liveAiEventsSnapshot(lfdQuery);
  // LFD, AI Events and Field Notes runs only run inside this process: any still 'running' at boot died with the last one.
  // Reaped here instead of by age, so a long live run is never failed for taking long (CI decision 2026-11-10).
  for (const [name, store] of [['lfd', lfdStore], ['ai_events', aiEventsStore], ['field_notes', fieldNotesStore]] as const) {
    const reaped = await store.reapRunsAtStartup(lfdQuery).catch((error) => (log(`${name}_startup_reap_failed`, { error: errorText(error) }), 0));
    if (reaped) log(`${name}_startup_reaped`, { runs: reaped });
  }
  // Carousel (social.runs) runs are this daemon's children too (CI-33).
  const carouselReaped = await runs.reapRunsAtStartup(query).catch((error) => (log('carousel_startup_reap_failed', { error: errorText(error) }), 0));
  if (carouselReaped) log('carousel_startup_reaped', { runs: carouselReaped });
  /**
   * Targeted Revisions: the live Haiku call behind the interpreter. Its system block arrives
   * already cached (lib/revisions/interpret.ts, cachedSystemText); the client is made on first use.
   */
  let revisionsClient: ReturnType<typeof newAnthropic> | null = null;
  const reviseComplete: import('@/lib/revisions/interpret').Complete = async (req) => {
    revisionsClient ??= newAnthropic();
    const res = await revisionsClient.messages.create({ model: req.model, max_tokens: req.max_tokens, system: req.system, messages: req.messages });
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { text, usage: res.usage };
  };

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
  const nextIgPhotoSync = () => nextRunAt(new Date(), cfg.IG_PHOTO_SYNC_HOUR_LOCAL, cfg.IG_PHOTO_SYNC_MINUTE_LOCAL);
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

  /**
   * The 3:00 AM decision (LFD-02) with each type's state (D16): whether Last Few Days or Carousels makes posts
   * tonight. Reading the gates logs state_mismatch. Used at 3:00 and again when the run is claimed, so a queued
   * scheduled run knows whether it makes stories or only refills the pool.
   */
  async function threeAmSlot(at: Date) {
    const lfd = await lfdSettings.readLfdSettings(lfdQuery).catch((error) => {
      log('lfd_settings_failed', { error: errorText(error) });
      return null;
    });
    const carousel = await readTypeGate(lfdQuery, 'carousels', log);
    await readTypeGate(lfdQuery, 'last_few_days', log);
    // Template mode: the calendar says whether today is a Last Few Days day (null while legacy).
    const today = calendarDateKey(at);
    const plan = await slotPlan(lfdQuery, today, 1).catch(() => null);
    return { lfd, carousel, slot: threeAmQueue(today, lfd, carousel.makes, plan ? isLfdDay(plan, today) : null) };
  }

  /** The daily script in a child process. Resolves with its exit code and the end of its stderr. */
  function runDailyScript(
    runId: string,
    stories: number,
    capUsd: number,
    rerunPostId?: string,
    storyIds: readonly string[] = [],
    moves: { pinIds: readonly string[]; demoteIds: readonly string[]; archiveIds: readonly string[]; placed: ReadonlyArray<readonly [string, number]> } = { pinIds: [], demoteIds: [], archiveIds: [], placed: [] },
  ): Promise<{ code: number | null; tail: string }> {
    return new Promise((resolve) => {
      const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
      const args = [
        'scripts/social_daily.ts', '--run-id', runId, '--stories', String(stories), '--cap-usd', String(capUsd),
        ...(rerunPostId ? ['--rerun-post', rerunPostId] : []),
        ...storyIds.flatMap((id) => ['--story-id', id]),
        ...moves.pinIds.flatMap((id) => ['--pin-id', id]),
        ...moves.demoteIds.flatMap((id) => ['--demote-id', id]),
        ...moves.archiveIds.flatMap((id) => ['--archive-id', id]),
        ...moves.placed.flatMap(([id, key]) => ['--place-id', `${id}=${key}`]),
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
    let capUsd = run.capUsd;
    /** Set when the run only refills the pool (D3, D16): it makes no story and is held to the refill cap. */
    let refillOnly: string | null = null;
    let movesReadAt: Date | undefined;
    let moves: { pinIds: string[]; demoteIds: string[]; archiveIds: string[]; placed: Array<readonly [string, number]> } = { pinIds: [], demoteIds: [], archiveIds: [], placed: [] };
    if (!rerun && pinned.length) {
      log('run_pinned', { runId: run.id, storyIds: pinned });
    } else if (!rerun) {
      // A scheduled run makes stories only when tonight is Carousels' (D16: makesPosts, and not a Last Few Days day);
      // otherwise, or when the day's quota is full, it only refills the pool (D3). A person's manual run works in every state.
      const night = run.trigger === 'scheduled' ? await threeAmSlot(new Date()) : null;
      const refillCap = night?.carousel.refillCapUsd ?? (await readTypeGate(lfdQuery, 'carousels', log)).refillCapUsd;
      // Daily fill (D54): what people placed for today counts toward posts_per_day; the run makes only the rest.
      const runStories = (await getSocialSetting<number>('run_stories')) ?? cfg.DEFAULT_RUN_STORIES;
      // A failed read never strands the claimed run: it makes run_stories, as before the rule.
      const fill = night && night.slot.queue !== 'carousels' ? null : await carouselFill(query).catch((error) => {
        log('fill_failed', { runId: run.id, error: errorText(error) });
        return null;
      });
      // Template mode: the day's carousel slots are the knob, so run_stories never cuts the fill.
      const fillStories = fill ? nightStoriesFor(fill, runStories, await readSlotSource(query)) : runStories;
      if (fill) reportFill(fill, log, { runId: run.id, runStories, stories: fillStories });
      const plan = carouselNight({
        slot: night?.slot ?? null,
        fill: fill ? { stories: fillStories, note: `${quotaFilledNote(fill, 'carousel')} The run made nothing new.` } : null,
        runStories,
        runCapUsd: run.capUsd,
        refillCapUsd: refillCap,
      });
      stories = plan.stories;
      capUsd = plan.capUsd;
      refillOnly = plan.refillOnly;
      if (refillOnly) {
        log('run_refill_only', { runId: run.id, reason: refillOnly, capUsd });
      } else if (run.trigger === 'scheduled') {
        // Shared queue: the 3 AM run makes tonight's carousel promote first and sinks demoted stories (a failed read: no moves).
        movesReadAt = new Date();
        const tonight = await readTonightMoves(query, 'carousels');
        moves = {
          pinIds: tonight.pins.map((pin) => ideaRef(pin.ideaId)),
          demoteIds: [...tonight.demoted].map(ideaRef),
          archiveIds: [...tonight.archived].map(ideaRef),
          placed: [...tonight.placed].map(([id, key]) => [ideaRef(id), key] as const),
        };
        if (moves.pinIds.length || moves.demoteIds.length || moves.archiveIds.length || moves.placed.length) log('run_moves', { runId: run.id, ...moves });
      }
    }
    log('run_started', { runId: run.id, stories, capUsd, ...(refillOnly ? { refillOnly: true } : {}), ...(rerun ? { rerunOf: rerun.postId, rerunRequest: rerun.requestId } : {}) });
    const { code, tail } = await runDailyScript(run.id, stories, capUsd, rerun?.postId, pinned, moves);
    // The script finishes the run itself; one still `running` means it died first.
    await runs.failRun(query, run.id, `The daily script exited (${code}) before finishing the run. ${tail}`);
    const done = (await query(`SELECT status, stop_reason FROM social.runs WHERE id = $1`, [run.id])).rows[0];
    const status = done?.status;
    log('run_complete', { runId: run.id, exitCode: code, status });
    if (refillOnly) {
      // The refill's spend stays on the run (status as the script left it, so the cost pages count it); its reason says why no story.
      if (done?.stop_reason === 'cost-cap') logRefillCapped(log, 'carousels', { capUsd, step: 'selection', runId: run.id });
      else if (status !== 'failed') await query(`UPDATE social.runs SET stop_reason = $2 WHERE id = $1`, [run.id, `refill-only: ${refillOnly}`.slice(0, 2000)]).catch((error) => log('run_note_failed', { runId: run.id, error: errorText(error) }));
      log('run_refill_complete', { runId: run.id, status, stopReason: done?.stop_reason ?? null });
      return;
    }
    // The scheduled night ran to a finish: hand placements are used up and the stories compete by score again (a run that died keeps them).
    if (!rerun && !pinned.length && run.trigger === 'scheduled' && code === 0 && status !== 'failed') await finishNightPlacements(query, 'carousels', undefined, movesReadAt);

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

    // A rerun's new version waits in Content ready for a person; only the nightly run fills today's windows, and only while Live (D16).
    if (!rerun && (await readTypeGate(lfdQuery, 'carousels', log)).posts) {
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
    const aiEvents = await pollCarouselInsights(query, client, new Date(), 200, 'ai_events');
    if (force || aiEvents.considered > 0) log('ai_events_insights_complete', { ...aiEvents });
    const fieldNotes = await pollCarouselInsights(query, client, new Date(), 200, 'field_notes');
    if (force || fieldNotes.considered > 0) log('field_notes_insights_complete', { ...fieldNotes });
  }

  // Targeted Revisions left `running` by the previous process (deploy, OOM, systemd restart) end
  // `failed` with a plain note, never requeued; this worker's rows only (explainers are helios-explainers').
  await startUpRevisions({ query: async () => query, filter: { exclude: 'explainers' }, log });

  try {
    let runAt = nextRun();
    let sweepAt = nextSweep();
    let hubSweepAt = nextHubSweep();
    let healthAt = nextHealthReport();
    let igPhotoSyncAt = nextIgPhotoSync();
    let lastInsights = 0;
    let lastRerunError: string | null = null;
    let lastRevisionsError: string | null = null;
    let lastLfdError: string | null = null;
    // Started after today's noon: check once now, so a Sunday-afternoon restart still runs the week.
    let aiEventsAt = firstAiEventsCheckAt(new Date());
    let lastAiEventsError: string | null = null;
    // The same for Field Notes' 2:00 AM check (auto_run ships off, so it queues nothing until a person turns it on).
    let fieldNotesAt = firstFieldNotesCheckAt(new Date());
    // Central intake (night schedule v2): main at 12:00 AM, top-up at 2:40 AM, Jev only. A worker
    // that starts before 2:00 AM checks the main run right away; mainRanToday keeps it to once a day.
    const nextIntakeMain = () => nextRunAt(new Date(), intakeTypes.INTAKE_MAIN_HOUR_NY, 0);
    const nextIntakeTopup = () => nextRunAt(new Date(), intakeTypes.INTAKE_TOPUP_HOUR_NY, intakeTypes.INTAKE_TOPUP_MINUTE_NY);
    const nyHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    let intakeMainAt = nyHour < intakeTypes.INTAKE_TOPUP_HOUR_NY ? new Date() : nextIntakeMain();
    let intakeTopupAt = nextIntakeTopup();
    let lastFieldNotesError: string | null = null;
    let lastFieldNotesFacesError: string | null = null;
    const photoBank = mediaBucket(PHOTO_BANK_BUCKET);
    log('scheduled', { nextRunAt: runAt.toISOString(), nextAiEventsRunAt: aiEventsAt.toISOString(), nextFieldNotesRunAt: fieldNotesAt.toISOString(), nextIntakeMainAt: intakeMainAt.toISOString(), nextIntakeTopupAt: intakeTopupAt.toISOString(), nextInsightsAt: sweepAt.toISOString(), nextHealthReportAt: healthAt.toISOString(), nextIgPhotoSyncAt: igPhotoSyncAt.toISOString(), pollMs: POLL_MS });

    while (!stopping) {
      if (Date.now() >= igPhotoSyncAt.getTime()) {
        // 11:45 PM: the Instagram photo read (CI-32). Today's published posts' photos go into the 20-day ledger
        // before the midnight builds pick. Reads Instagram only, no model call; a failure only logs.
        if (!metaConfigured()) {
          log('ig_photo_sync_skipped', { reason: 'META_USER_ACCESS_TOKEN / META_IG_BUSINESS_ACCOUNT_ID not set' });
        } else {
          const { liveIgSyncDeps, syncPublishedPhotos } = await import('@/lib/photos/ig-sync');
          // Capped so it can't hold up the midnight builds; a cut-off read resumes the next night (ig-sync.ts).
          const out = await withHangGuard(
            liveIgSyncDeps(query, (line) => log('ig_photo_sync_note', { line }))
              .then(syncPublishedPhotos)
              .then(({ matches: _matches, ...report }) => ({ ok: true as const, report }))
              .catch((error) => ({ ok: false as const, error: errorText(error) })),
            { backstopMs: cfg.IG_PHOTO_SYNC_TIMEOUT_MS, onHang: (reason) => ({ ok: false as const, error: `stopped (${reason}); resumes next night` }) },
          );
          if (out.ok) log('ig_photo_sync_complete', out.report);
          else log('ig_photo_sync_failed', { error: out.error });
        }
        igPhotoSyncAt = nextIgPhotoSync();
        continue;
      }

      if (Date.now() >= intakeMainAt.getTime()) {
        // 12:00 AM: the central intake's main run (fetch, group, score; Jev only, $0.50 cap). Never twice a day.
        try {
          if (await intakeRun.mainRanToday(intakeQuery, new Date())) {
            log('intake_main_skipped', { reason: 'main already ran today' });
          } else {
            const { runId, record } = await intakeRun.runIntake(await intakeRun.liveIntakeDeps(intakeQuery, 'main'), 'main');
            log('intake_main_complete', { runId, orders: record.orders, usd: record.usd, stopReason: record.stopReason ?? null, grouping: record.grouping });
          }
        } catch (error) {
          log('intake_main_failed', { error: errorText(error) });
        }
        intakeMainAt = nextIntakeMain();
        continue;
      }

      if (Date.now() >= intakeTopupAt.getTime()) {
        // 2:40 AM: the intake top-up (fresh news for the 3:00 pair; $0.15 cap).
        try {
          const { runId, record } = await intakeRun.runIntake(await intakeRun.liveIntakeDeps(intakeQuery, 'topup'), 'topup');
          log('intake_topup_complete', { runId, orders: record.orders, usd: record.usd, stopReason: record.stopReason ?? null, grouping: record.grouping });
        } catch (error) {
          log('intake_topup_failed', { error: errorText(error) });
        }
        intakeTopupAt = nextIntakeTopup();
        continue;
      }

      if (Date.now() >= runAt.getTime()) {
        // 3:00 AM: on a Last Few Days day with Last Few Days making posts, its run takes the carousel run's slot (LFD-02).
        const { lfd, carousel, slot } = await threeAmSlot(new Date());
        // The carousel run is queued every night too (D3, D16): it makes stories on Carousels' nights and only refills the
        // pool otherwise (carryOutRun decides again at claim time), so the quota or a pause never leaves the pool stale.
        const making = slot.queue === 'carousels';
        const req = threeAmRequests(slot, {
          lfdRunCapUsd: lfd?.runCapUsd ?? null,
          carouselRunCapUsd: making ? (await getSocialSetting<number>('run_cap_usd')) ?? cfg.DEFAULT_RUN_CAP_USD : 0,
          refillCapUsd: carousel.refillCapUsd,
        });
        if (req.lfd && lfd?.runCapUsd != null) {
          const id = await lfdStore.requestRun(lfdQuery, 'scheduled', lfd.runCapUsd).catch((error) => {
            log('lfd_request_failed', { error: errorText(error) });
            return null;
          });
          log('lfd_run_requested', { runId: id, trigger: 'scheduled' });
        }
        const id = await runs.requestRun(query, 'scheduled', { capUsd: req.carousel.capUsd, hookPass: true }).catch((error) => {
          log('request_failed', { error: errorText(error) });
          return null;
        });
        log('run_requested', { runId: id, trigger: 'scheduled', mode: req.carousel.mode, state: carousel.state, ...(making ? {} : { reason: req.carousel.reason }) });
        runAt = nextRun();
        continue;
      }

      if (Date.now() >= aiEventsAt.getTime()) {
        // 12:00 PM: on an AI Events day (Sunday) the week's run is queued in every state (AE-08; D3, D16): the ranking is the
        // refill. It renders the posts only while AI Events makes posts; otherwise it ranks under the refill cap.
        const ae = await aiEventsSettings.readAiEventsSettings(lfdQuery).catch((error) => {
          log('ai_events_settings_failed', { error: errorText(error) });
          return null;
        });
        // Template mode: the calendar says whether today has an AI Events slot (null while legacy).
        const aeToday = calendarDateKey(new Date());
        const aePlan = await slotPlan(lfdQuery, aeToday, 1).catch(() => null);
        const noon = noonQueue(new Date(), ae, aePlan ? isAiEventsDay(aePlan, aeToday) : null);
        if (noon.queue) {
          const aeGate = await readTypeGate(lfdQuery, 'ai_events', log);
          const aeCap = noon.make && ae?.runCapUsd != null ? ae.runCapUsd : aeGate.refillCapUsd;
          const id = await aiEventsStore.requestRun(lfdQuery, 'scheduled', aeCap).catch((error) => {
            log('ai_events_request_failed', { error: errorText(error) });
            return null;
          });
          log('ai_events_run_requested', { runId: id, trigger: 'scheduled', mode: noon.make ? 'make' : 'refill', reason: noon.reason });
        } else {
          log('ai_events_run_skipped', { reason: noon.reason });
        }
        aiEventsAt = nextAiEventsRunAt(new Date());
        continue;
      }

      if (Date.now() >= fieldNotesAt.getTime()) {
        // 2:00 AM: while Field Notes makes posts (auto_run on), a run is queued for the earliest unfilled Field Notes day in
        // the next 2 days (Bald-Eagle D4, lib/field-notes/clock.ts); it refills the tip pool first. Otherwise a Field Notes
        // day queues a refill-only run, in every state (D3, D16).
        const fn = await fieldNotesSettings.readFieldNotesSettings(lfdQuery).catch((error) => {
          log('field_notes_settings_failed', { error: errorText(error) });
          return null;
        });
        // Never twice a night (a restart after the check): a scheduled run already queued today says no.
        const fnToday = await fieldNotesStore.scheduledRunToday(lfdQuery, calendarDateKey(new Date())).catch((error) => {
          log('field_notes_today_check_failed', { error: errorText(error) });
          return null;
        });
        // Template mode: the calendar says which dates in the fill window have a Field Notes slot (null while legacy).
        const fnDate = calendarDateKey(new Date());
        const fnDates = fillDates(fnDate, leadDaysFor('field_notes'));
        const fnPlan = await slotPlan(lfdQuery, fnDate, 1 + leadDaysFor('field_notes')).catch(() => null);
        // Dates in the window that already have a post, booking or queued run: skipped (one post per Field Notes day).
        const fnFilled = await fieldNotesStore.fieldNotesFilledDates(lfdQuery, fnDates).catch((error) => {
          log('field_notes_filled_check_failed', { error: errorText(error) });
          return new Set(fnDates);
        });
        const fnNoon = fieldNotesNoonQueue(new Date(), fn, fnToday, fnPlan ? (d: string) => isFieldNotesDay(fnPlan, d) : null, fnFilled);
        if (fnNoon.queue && fn?.runCapUsd != null) {
          const id = await fieldNotesStore.requestRun(lfdQuery, 'scheduled', fn.runCapUsd, { nyDate: fnNoon.target ?? null }).catch((error) => {
            log('field_notes_request_failed', { error: errorText(error) });
            return null;
          });
          log('field_notes_run_requested', { runId: id, trigger: 'scheduled', nyDate: fnNoon.target });
        } else {
          log('field_notes_run_skipped', { reason: fnNoon.reason });
          // No post run tonight (paused, or the days ahead are filled): a Field Notes day still refills its tip pool (D3, D16).
          const refill = fieldNotesRefillNight(new Date(), fn, fnToday, fnPlan ? (d: string) => isFieldNotesDay(fnPlan, d) : null);
          if (refill.queue) {
            const fnGate = await readTypeGate(lfdQuery, 'field_notes', log);
            const id = await fieldNotesStore.requestRun(lfdQuery, 'scheduled', fnGate.refillCapUsd, { refillOnly: true }).catch((error) => {
              log('field_notes_request_failed', { error: errorText(error) });
              return null;
            });
            log('field_notes_run_requested', { runId: id, trigger: 'scheduled', mode: 'refill', reason: refill.reason });
          } else {
            log('field_notes_refill_skipped', { reason: refill.reason });
          }
        }
        fieldNotesAt = nextFieldNotesRunAt(new Date());
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
        // Long runs are normal and never cut off (CI decision, 2026-11-10). Only a HUNG run is failed, so it can't
        // stall this loop (3:00, publishing, insights, hub sweeps): no output for RUN_QUIET_LIMIT_MS (45 min), or the
        // 12 h backstop (lib/content-runs/hang-guard.ts). The hung promise is not cancelled.
        const out = await withHangGuard(
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
          {
            onHang: async (reason) => {
              log('lfd_run_hung', { runId: lfdClaimed.id, reason });
              await lfdStore.failRun(lfdQuery, lfdClaimed.id, reason).catch((error) => log('lfd_fail_failed', { runId: lfdClaimed.id, error: errorText(error) }));
              return { runId: lfdClaimed.id, status: 'failed' as const, note: reason };
            },
          },
        );
        log('lfd_run_result', { ...out });
        continue;
      }

      // AI Events runs (Sunday 12:00, or the hub's Generate and Rebuild post), after Last Few Days' and in this same process.
      const aeClaimed = await aiEventsStore.claimRun(lfdQuery).catch((error) => {
        // Logged once per distinct error (e.g. before the ai_events schema is applied), not every poll.
        const text = errorText(error);
        if (text !== lastAiEventsError) log('ai_events_claim_failed', { error: text });
        lastAiEventsError = text;
        return null;
      });
      if (aeClaimed) {
        // Never cut off for length; only a hung run (no progress for 45 min, or the 12 h backstop) is failed.
        const out = await withHangGuard(
          carryOutAiEventsRun(
            {
              query: lfdQuery,
              now: () => new Date(),
              log,
              engine: (_run, capUsd) => liveAiEventsDeps(lfdQuery, { capUsd }),
              snapshot: aiEventsSnapshot,
            },
            aeClaimed,
          ).catch((error) => ({ runId: aeClaimed.id, status: 'failed' as const, note: errorText(error) })),
          {
            onHang: async (reason) => {
              log('ai_events_run_hung', { runId: aeClaimed.id, reason });
              await aiEventsStore.failRun(lfdQuery, aeClaimed.id, reason).catch((error) => log('ai_events_fail_failed', { runId: aeClaimed.id, error: errorText(error) }));
              return { runId: aeClaimed.id, status: 'failed' as const, note: reason };
            },
          },
        );
        log('ai_events_run_result', { ...out });
        continue;
      }

      // Field Notes runs (the noon clock, or the hub's Generate and Rebuild post), after AI Events' and in this same process.
      const fnClaimed = await fieldNotesStore.claimRun(lfdQuery).catch((error) => {
        // Logged once per distinct error (e.g. before the field_notes schema is applied), not every poll.
        const text = errorText(error);
        if (text !== lastFieldNotesError) log('field_notes_claim_failed', { error: text });
        lastFieldNotesError = text;
        return null;
      });
      if (fnClaimed) {
        // Never cut off for length; only a hung run (no progress for 45 min, or the 12 h backstop) is failed.
        const out = await withHangGuard(
          carryOutFieldNotesRun(
            {
              query: lfdQuery,
              now: () => new Date(),
              log,
              engine: (_run, capUsd) => liveFieldNotesDeps(lfdQuery, { capUsd }),
            },
            fnClaimed,
          ).catch((error) => ({ runId: fnClaimed.id, status: 'failed' as const, note: errorText(error) })),
          {
            onHang: async (reason) => {
              log('field_notes_run_hung', { runId: fnClaimed.id, reason });
              await fieldNotesStore.failRun(lfdQuery, fnClaimed.id, reason).catch((error) => log('field_notes_fail_failed', { runId: fnClaimed.id, error: errorText(error) }));
              return { runId: fnClaimed.id, status: 'failed' as const, note: reason };
            },
          },
        );
        log('field_notes_run_result', { ...out });
        continue;
      }

      // Targeted Revisions a person queued from the hub (only those rows; never a sweep): interpret, then ask back or run.
      // Explainer revisions are helios-explainers' (they run a render session in its job folders and memory budget).
      const revised = await claimAndRunRevisions({ q: query, complete: reviseComplete, notify: async (m) => log('revision_notice', { message: m }), now: () => new Date(), log, filter: { exclude: 'explainers' } }).catch((error) => {
        // Logged once per distinct error (e.g. before db/revisions_schema.sql is applied), not every poll.
        const text = errorText(error);
        if (text !== lastRevisionsError) log('revisions_claim_failed', { error: text });
        lastRevisionsError = text;
        return 0;
      });
      if (revised > 0) continue;

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

      // Posting only while Live (D16), and only approved posts: require_approval is never read as off.
      if (!(await standDown()) && (await readTypeGate(lfdQuery, 'carousels', log)).posts) {
        const due = await releaseDueSchedules(query, { requireApproval: true }).catch((error) => {
          log('schedule_release_failed', { error: errorText(error) });
          return 0;
        });
        if (due > 0) log('schedule_due', { released: due });
        if (metaConfigured()) {
          const published = await claimAndPublish({ query, meta: createLiveCarouselClient(), signImage: (p: string, secs: number) => slideBucket.sign(p, secs), photoHashes: {} }).catch((error) => {
            log('publish_failed', { error: errorText(error) });
            return null;
          });
          if (published) {
            log('publish_complete', { ...published });
            continue;
          }
        }
      }

      // Last Few Days posts the same way while the single publisher doesn't drive it (D40, D41), only while Live (D16).
      if ((await readTypeGate(lfdQuery, 'last_few_days', log)).posts && !(await publisherOwnsPublishing(query, 'last_few_days'))) {
        const due = await releaseDueLfd(query, { requireApproval: true }).catch((error) => {
          log('lfd_schedule_release_failed', { error: errorText(error) });
          return 0;
        });
        if (due > 0) log('lfd_schedule_due', { released: due });
        if (metaConfigured()) {
          const published = await claimAndPublishLfd({ query, meta: createLiveCarouselClient(), signImage: (p: string, secs: number) => slideBucket.sign(p, secs), photoHashes: {} }).catch((error) => {
            log('lfd_publish_failed', { error: errorText(error) });
            return null;
          });
          if (published) {
            log('lfd_publish_complete', { ...published });
            continue;
          }
        }
      }

      // AI Events posts the same way while the single publisher doesn't drive it; a post republishes the calendar snapshot.
      if ((await readTypeGate(lfdQuery, 'ai_events', log)).posts && !(await publisherOwnsPublishing(query, AI_EVENTS_SPINE_VERTICAL))) {
        const due = await releaseDueAiEvents(query, { requireApproval: true }).catch((error) => {
          log('ai_events_schedule_release_failed', { error: errorText(error) });
          return 0;
        });
        if (due > 0) log('ai_events_schedule_due', { released: due });
        if (metaConfigured()) {
          const published = await claimAndPublishAiEvents(
            { query, meta: createLiveCarouselClient(), signImage: (p: string, secs: number) => slideBucket.sign(p, secs), photoHashes: {} },
            { snapshot: aiEventsSnapshot, log },
          ).catch((error) => {
            log('ai_events_publish_failed', { error: errorText(error) });
            return null;
          });
          if (published) {
            log('ai_events_publish_complete', { ...published });
            continue;
          }
        }
      }

      // Field Notes posts the same way while the single publisher doesn't drive it.
      if ((await readTypeGate(lfdQuery, 'field_notes', log)).posts && !(await publisherOwnsPublishing(query, FIELD_NOTES_SPINE_VERTICAL))) {
        const due = await releaseDueFieldNotes(query, { requireApproval: true }).catch((error) => {
          log('field_notes_schedule_release_failed', { error: errorText(error) });
          return 0;
        });
        if (due > 0) log('field_notes_schedule_due', { released: due });
        if (metaConfigured()) {
          const published = await claimAndPublishFieldNotes({ query, meta: createLiveCarouselClient(), signImage: (p: string, secs: number) => slideBucket.sign(p, secs), photoHashes: {} }).catch((error) => {
            log('field_notes_publish_failed', { error: errorText(error) });
            return null;
          });
          if (published) {
            log('field_notes_publish_complete', { ...published });
            continue;
          }
        }
      }

      // Field Notes face check: new uploads only (finalize queues them 'pending'; Vercel has no Chromium). Up to one
      // batch per poll, one shared browser opened only when a photo was claimed; never a sweep of older pool rows.
      const fnFaces = await runFacesStep({ db: query as never, download: (p: string) => photoBank.download(p), openDetector: openLiveFaceDetector }).catch((error) => {
        // Logged once per distinct error (e.g. before the faces columns are applied), not every poll.
        const text = errorText(error);
        if (text !== lastFieldNotesFacesError) log('field_notes_faces_failed', { error: text });
        lastFieldNotesFacesError = text;
        return null;
      });
      if (fnFaces && fnFaces.claimed > 0) {
        lastFieldNotesFacesError = null;
        log('field_notes_faces_batch', { ...fnFaces });
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
