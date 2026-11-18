/**
 * One pass of the Stories worker (plan §4, §7, M8). scripts/stories_worker.ts
 * runs it every 15 seconds; tests run it against PGlite and stubs.
 *
 *   0. pool: the first pass after 3:00 AM refreshes stories.pool from the
 *      reels, carousel and catalog pools, or from the central intake for a
 *      series the consumer switch has on it (lib/stories/pool.ts; reads only);
 *      then, once per pool day, AI Trivia's writer adds its day's questions
 *      (runTriviaDaily, lib/stories/trivia/daily.ts; AT-13: every day). It
 *      renders no video, so the 3:00 hour's one-video-renderer rule holds;
 *      then, once per pool day, Real or AI?'s candidate maker adds its day's
 *      4 screened images (runRoaDaily, lib/stories/roa/daily.ts; RA-16)
 *   1. auto series: request the night's sets at 3:00 AM (docs/social-overnight.md,
 *      night schedule v2: after the 2:40 intake top-up): Morning Download for
 *      today; AI Trivia and Real or AI? 2 days ahead (Bald-Eagle D4,
 *      lib/social-hub/lead.ts);
 *      in template mode one set per Stories slot (a series may post twice)
 *   2. build: claim one `requested` set → build, render, review → `ready`;
 *      an auto set approves itself only when require_approval is off and the
 *      review did not flag it (S-05, S-33); otherwise it waits for Approve
 *   3. schedule: each approved set gets a minute in its window (S-20), or in
 *      [slot, slot + 15] when it has a slot
 *   4. publish: each due set posts its frames in order (S-59); on success the
 *      history (repeat checks) and Tommy's used-photo log are written (S-24),
 *      and an AI Trivia set's content-map cell is closed
 *      Steps 3 and 4 run only while publishing_live is on.
 *   5. insights: poll published frames every 2 hours until the final capture
 */
import { storiesSlotsOn } from '@/lib/social-hub/slots';
import type { ResolvedSlot } from '@/lib/social-hub/slots/types';
import type { StoriesDb } from '@/lib/stories/db';
import { buildSet, type SetBuilderDeps } from '@/lib/stories/build';
import { createStoriesJev } from '@/lib/stories/jev';
import { isFinalCapture, type StoryInsightsClient } from '@/lib/stories/publish/insights';
import type { StoriesMetaClient } from '@/lib/stories/publish/meta';
import { publishSet } from '@/lib/stories/publish/publish';
import type { Series } from '@/lib/stories/render/types';
import {
  approveSet,
  claimNextRequested,
  monthSpendUsd,
  releaseStaleBuilds,
  dueSets,
  failSet,
  framesDueForInsights,
  getSet,
  listSets,
  markPublished,
  markPublishing,
  recordFrameContainer,
  recordFramePublished,
  recordHistory,
  recordInsights,
  scheduleSet,
  typeDaySpendUsd,
} from '@/lib/stories/repository';
import type { IntakeJev } from '@/lib/intake/types';
import { poolDay, refreshPoolIfDue, type PoolReads } from '@/lib/stories/pool';
import { storiesPoolReads, type ReadConsumerMode } from '@/lib/stories/pool-intake';
import { pickSetPublishAt, requestAutoSets } from '@/lib/stories/schedule';
import { loadSettings, seriesTypeSettings, typeSettings, type StoriesSettings } from '@/lib/stories/settings';
import { STORY_VERTICALS, verticalOfSeries, type StoryVertical } from '@/lib/social-hub/story-types';
import { isBrandAsset } from '@/lib/photos/used';
import { recordPublishedPhoto } from '@/lib/stories/sources/carousel';
import { accountBusy } from '@/lib/stories/spine';
import type { StoriesStorage } from '@/lib/stories/storage';
import { runTriviaDaily } from '@/lib/stories/trivia/daily';
import { runRoaDaily } from '@/lib/stories/roa/daily';
import { buildGameDay, dayToBuild, lockDue, readLaunch } from '@/lib/stories/trivia/game-days';
import { createBankReader } from '@/lib/media-library/reader';

/** Auto sets are requested in the Stories hour of the night clock (docs/social-overnight.md, night schedule v2). */
export const AUTO_REQUEST_AFTER = '03:00';

export type WorkerDeps = {
  db: StoriesDb;
  /** reels.* and social.* (read; plus the used-photo insert at publish). */
  sourceDb: StoriesDb;
  /** Builds need the live model clients; created only when a set is claimed. */
  /** The build's live clients. `series` is the set being built (absent for the daily runs), so a builder can tune its photo finder per series (SS-28). */
  builder: (series?: Series) => Promise<SetBuilderDeps>;
  meta: () => StoriesMetaClient;
  insights: () => StoryInsightsClient;
  storage: () => StoriesStorage;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Tests stub the pool's source reads. */
  poolReads?: (now: Date) => PoolReads;
  /** The central intake for series on it: the posted check's Jev (its own cost bucket) and the mode read. */
  intake?: { jev?: () => IntakeJev; readMode?: ReadConsumerMode };
  /** AI Trivia's daily writer run; tests stub it. Default: runTriviaDaily with the builder's live clients. */
  triviaDaily?: (now: Date, settings: StoriesSettings) => Promise<unknown>;
  /** The web game's day builder; tests stub it. Default: buildGameDay with the builder's live clients. */
  triviaGame?: (now: Date, settings: StoriesSettings, date: string, launch: string) => Promise<unknown>;
  /** Real or AI?'s daily candidate run; tests stub it. Default: runRoaDaily with the builder's live clients. */
  roaDaily?: (now: Date, settings: StoriesSettings) => Promise<unknown>;
  /** Fetches a published photo to hash it for the used-photo ledger (tests stub it). */
  photoHttp?: typeof fetch;
};

/** stories.settings key where runTriviaDaily records the pool day it last ran (it runs once per pool day). */
export const TRIVIA_DAILY_KEY = 'trivia_daily';
/** stories.settings key where runRoaDaily records the pool day it last ran (planning/Real or AI/CONTRACT.md §1). */
export const ROA_DAILY_KEY = 'roa_daily';

const nyClock = (at: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

export async function tick(deps: WorkerDeps): Promise<{ built: number; scheduled: number; published: number; insights: number }> {
  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? (() => {});
  const settings = await loadSettings(deps.db);
  const out = { built: 0, scheduled: 0, published: 0, insights: 0 };

  // 0. The pool, once per pool day, before any auto set is requested or built.
  if (nyClock(now) >= AUTO_REQUEST_AFTER) {
    try {
      const reads = deps.poolReads ?? ((at) => storiesPoolReads(deps.sourceDb, at, { readMode: deps.intake?.readMode, intake: { jev: deps.intake?.jev } }));
      const r = await refreshPoolIfDue(deps.db, () => reads(now), now);
      if (r) log(`pool: refreshed (${r.upserted} in, ${r.dropped} dropped${r.errors.length ? `; ${r.errors.join('; ')}` : ''}${r.intake ? `; sources ${JSON.stringify(r.intake)}` : ''})`);
    } catch (err) {
      log(`pool: refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await triviaDailyIfDue(deps, settings, now);
    await roaDailyIfDue(deps, settings, now);
  }
  // 0b. The web game (HUB-PLAN.md): lock what is due (any hour), then build the next day under the type's spend cap.
  await triviaGameIfDue(deps, settings, now);

  // 1. Auto series.
  if (nyClock(now) >= AUTO_REQUEST_AFTER) {
    // Daily fill (D54): a series day someone already filled gets no auto set; logged once as fill_reduced.
    // Template mode: one set per Stories slot of each target date, capped per series (null while legacy, or
    // unreadable: each series' own days). One slot read per date per pass.
    const read = new Map<string, Promise<readonly ResolvedSlot[] | null>>();
    const slotsFor = (date: string) => {
      if (!read.has(date)) read.set(date, storiesSlotsOn((t, p) => deps.db.query(t, p), date).catch(() => null));
      return read.get(date)!;
    };
    const requested = await requestAutoSets(deps.db, settings, now, { log: (message, fields) => log(`${message} ${JSON.stringify(fields)}`), slotsFor });
    if (requested.length) log(`auto: requested ${requested.join(', ')}`);
  }

  const released = await releaseStaleBuilds(deps.db);
  if (released.length) log(`build interrupted, trying again: ${released.join(', ')}`);

  // 2. Build one requested set.
  const claimed = await claimNextRequested(deps.db);
  if (claimed) {
    const b = await deps.builder(claimed.series);
    const r = await buildSet({ log, ...b }, claimed.id);
    out.built++;
    log(`build ${claimed.series} ${claimed.ny_date}: ${r.status}${r.flagged ? ' (flagged)' : ''} ${r.detail.slice(0, 200)}`);
    // Approval is the set's type's switch (SS-22).
    if (r.status === 'ready' && claimed.trigger === 'auto' && settings.series[claimed.series].auto && !r.flagged && !seriesTypeSettings(settings, claimed.series).requireApproval) await approveSet(deps.db, claimed.id);
  }

  // 3–4 post nothing for a type whose master switch is off (SS-22: each Stories-format type has its own).
  const live = (series: Series) => seriesTypeSettings(settings, series).publishingLive;
  if (!STORY_VERTICALS.some((v) => typeSettings(settings, v).publishingLive)) {
    await pollInsights(deps, now, out);
    return out;
  }

  // 3. Schedule approved sets.
  for (const s of await listSets(deps.db, { statuses: ['approved'] })) {
    if (!live(s.series)) continue;
    // A set with a slot (template mode) books in [slot, slot + 15]; one without, in its series' window.
    const at = pickSetPublishAt(settings.series[s.series].window, s, now);
    if (!at) continue; // window passed: the Hub offers Publish now or reject
    await scheduleSet(deps.db, s.id, at);
    out.scheduled++;
    log(`scheduled ${s.series} ${s.ny_date} for ${at.toISOString()}`);
  }

  // 4. Publish due sets.
  for (const s of await dueSets(deps.db, now)) {
    if (!live(s.series)) continue;
    if (await publishOne(deps, s.id, s.series)) out.published++;
  }

  // 5. Insights.
  await pollInsights(deps, now, out);
  return out;
}

async function pollInsights(deps: WorkerDeps, now: Date, out: { insights: number }): Promise<void> {
  const log = deps.log ?? (() => {});
  const due = await framesDueForInsights(deps.db, { now });
  if (!due.length) return;
  const client = deps.insights();
  for (const f of due) {
    try {
      const r = await client.storyInsights(f.ig_media_id);
      await recordInsights(deps.db, f.id, r.metrics, r.raw, isFinalCapture(new Date(f.published_at), now), now);
      out.insights++;
    } catch (err) {
      log(`insights ${f.ig_media_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function publishOne(deps: WorkerDeps, setId: string, series: Series): Promise<boolean> {
  const log = deps.log ?? (() => {});
  // One post at a time on the account (D44): wait while another type is mid-publish; the next pass retries.
  if (await accountBusy(deps.db)) {
    log(`publish ${series}: waiting, another post is in flight on the account`);
    return false;
  }
  await markPublishing(deps.db, setId);
  const got = (await getSet(deps.db, setId))!;
  const missing = got.frames.filter((f) => !f.storage_path);
  if (missing.length) {
    await failSet(deps.db, setId, `frames without a rendered JPEG: ${missing.map((f) => f.seq).join(', ')}`);
    return true;
  }
  const result = await publishSet(
    got.frames.map((f) => ({ id: f.id, seq: f.seq, storagePath: f.storage_path!, media: f.media })),
    {
      meta: deps.meta(),
      // The account gate reads the reserve and records its reading on the spine (D44).
      gateQuery: (text, params) => deps.db.query(text, params) as never,
      storage: deps.storage(),
      sleep: deps.sleep,
      now: deps.now,
      onContainer: (frameId, containerId) => recordFrameContainer(deps.db, frameId, containerId),
      onPublished: (frameId, mediaId, at) => recordFramePublished(deps.db, frameId, mediaId, at),
    },
  );
  if (!result.ok) {
    const went = result.published.length;
    await failSet(deps.db, setId, `${result.stage}: ${result.error}${went ? ` (${went} frame(s) already live)` : ' (nothing went live)'}`);
    log(`publish ${series}: failed at ${result.stage}: ${result.error}`);
    return true;
  }
  await markPublished(deps.db, setId);
  const keys = (got.set.payload.historyKeys as string[] | undefined) ?? [];
  await recordHistory(deps.db, series, keys, setId);
  const at = deps.now?.() ?? new Date();
  for (const f of got.frames) {
    if (!f.photo?.src || isBrandAsset(f.photo.kind)) continue;
    await recordPublishedPhoto(deps.sourceDb, { url: f.photo.src, usedAt: at, storyId: `stories:${setId}`, vertical: verticalOfSeries(series), slide: f.seq, credit: f.photo.credit, scene: f.role }, deps.photoHttp ? { http: deps.photoHttp } : {}).catch((err) => log(`used_photos: ${err instanceof Error ? err.message : String(err)}`));
  }
  log(`published ${series} ${got.set.ny_date}: ${result.mediaIds.length} frames`);
  return true;
}

/**
 * AI Trivia's writer after the 3:00 refresh (AT-13: every day, post day or not; the pool cap keeps it at 20).
 * runTriviaDaily records its pool day in stories.settings 'trivia_daily' and runs once per day; this pass reads
 * that record first so a done day costs one read, and holds the run while the series is off or the month's watch
 * or the day's cap is reached, like a build.
 */
async function triviaDailyIfDue(deps: WorkerDeps, settings: StoriesSettings, now: Date): Promise<void> {
  const log = deps.log ?? (() => {});
  if (!settings.series.ai_trivia.enabled) return;
  try {
    const { rows } = await deps.db.query<{ value: { day?: string } | null }>(`SELECT value FROM stories.settings WHERE key = $1`, [TRIVIA_DAILY_KEY]);
    if (rows[0]?.value?.day === poolDay(now)) return;
    const held = await spendHeld(deps, settings, 'ai_trivia', now);
    if (held) {
      once(`${poolDay(now)}:${held}`, () => log(`trivia: daily writer held (${held})`));
      return;
    }
    const run = deps.triviaDaily ?? (async (at: Date, s: StoriesSettings) => {
      const b = await deps.builder();
      return runTriviaDaily({ db: b.db, write: b.write, jev: createStoriesJev(b.jevTransport, b.db), settings: s, now: at });
    });
    const result = await run(now, settings);
    log(`trivia: daily writer ${JSON.stringify(result ?? null).slice(0, 300)}`);
  } catch (err) {
    log(`trivia: daily writer failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * "Are you Smarter Than AI?" web game days (AT-76 to AT-79): lock every full day whose 11 pm has come, then build the
 * next day (lib/stories/trivia/game-days.ts) while a launch date is set. The build is held like the daily writer: the
 * month's watch or AI Trivia's daily cap; MAX_GAME_CHECKS caps the fact-checks one day may spend.
 */
async function triviaGameIfDue(deps: WorkerDeps, settings: StoriesSettings, now: Date): Promise<void> {
  const log = deps.log ?? (() => {});
  try {
    const launch = await readLaunch(deps.db);
    if (!launch) return;
    const locked = await lockDue(deps.db, now);
    if (locked.locked.length || locked.missed.length || locked.served.length) log(`trivia-game: ${JSON.stringify(locked)}`);
    const date = await dayToBuild(deps.db, launch, now);
    if (!date) return;
    const held = await spendHeld(deps, settings, 'ai_trivia', now);
    if (held) {
      once(`game:${date}:${held}`, () => log(`trivia-game: ${date} held (${held})`));
      return;
    }
    const run = deps.triviaGame ?? (async (at: Date, s: StoriesSettings, day: string, l: string) => {
      const b = await deps.builder();
      return buildGameDay({ db: b.db, write: b.write, opponent: b.opponent, settings: s, now: at, log }, day, l);
    });
    const r = await run(now, settings, date, launch);
    const line = `trivia-game: ${JSON.stringify(r)}`;
    once(`game:${line}`, () => log(line));
    const after = await lockDue(deps.db, now);
    if (after.locked.length) log(`trivia-game: ${JSON.stringify(after)}`);
  } catch (err) {
    log(`trivia-game: failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Real or AI?'s candidate maker after the 3:00 refresh (RA-16: 4 a day, post day or not; the pool cap keeps 20).
 * runRoaDaily records its pool day in stories.settings 'roa_daily' (in a `finally`) and runs once per day; like
 * Trivia's pass, this reads that record first and holds the run while the series is off or a spend cap is reached.
 */
async function roaDailyIfDue(deps: WorkerDeps, settings: StoriesSettings, now: Date): Promise<void> {
  const log = deps.log ?? (() => {});
  if (!settings.series.real_or_ai.enabled) return;
  try {
    const { rows } = await deps.db.query<{ value: { day?: string } | null }>(`SELECT value FROM stories.settings WHERE key = $1`, [ROA_DAILY_KEY]);
    if (rows[0]?.value?.day === poolDay(now)) return;
    const held = await spendHeld(deps, settings, 'real_or_ai', now);
    if (held) {
      once(`roa:${poolDay(now)}:${held}`, () => log(`roa: daily candidates held (${held})`));
      return;
    }
    const run = deps.roaDaily ?? (async (at: Date, s: StoriesSettings) => {
      const b = await deps.builder();
      // Real photos: the photo bank in the shared database first (read only; off while its switch is off), then
      // Commons and NASA. Jev vision, gpt-image-2 and those reads are runRoaDaily's own live defaults.
      const bank = createBankReader({ query: (text, params) => b.sourceDb.query(text, params) as never });
      // The photo_finders switch, the used-photo ledger and the bank live in the shared database (SS-28).
      return runRoaDaily({ db: b.db, sourceDb: b.sourceDb, write: b.write, storage: b.storage, bank, settings: s, now: at });
    });
    const result = await run(now, settings);
    log(`roa: daily candidates ${JSON.stringify(result ?? null).slice(0, 300)}`);
  } catch (err) {
    log(`roa: daily candidates failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Why a type's daily run is held, or null: the engine-wide monthly watch, or the type's own daily cap against what
 * the type spent that New York day (SS-22: one type at its cap never holds another).
 */
async function spendHeld(deps: WorkerDeps, settings: StoriesSettings, vertical: StoryVertical, now: Date): Promise<string | null> {
  if ((await monthSpendUsd(deps.db, now)) >= settings.monthlyWatchUsd) return 'monthly watch reached';
  if ((await typeDaySpendUsd(deps.db, vertical, now)) >= typeSettings(settings, vertical).dailyCapUsd) return 'daily cap reached';
  return null;
}

const logged = new Set<string>();
const once = (key: string, f: () => void) => {
  if (logged.has(key)) return;
  logged.add(key);
  f();
};
