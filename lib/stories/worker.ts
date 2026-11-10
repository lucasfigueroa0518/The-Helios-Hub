/**
 * One pass of the Stories worker (plan §4, §7, M8). scripts/stories_worker.ts
 * runs it every 15 seconds; tests run it against PGlite and stubs.
 *
 *   0. pool: the first pass after 3:00 AM refreshes stories.pool from the
 *      reels, carousel and catalog pools, or from the central intake for a
 *      series the consumer switch has on it (lib/stories/pool.ts; reads only);
 *      then, once per pool day, AI Trivia's writer adds its day's questions
 *      (runTriviaDaily, lib/stories/trivia/daily.ts; AT-13: every day). It
 *      renders no video, so the 3:00 hour's one-video-renderer rule holds
 *   1. auto series: request today's set at 3:00 AM (docs/social-overnight.md,
 *      night schedule v2: after the 2:40 intake top-up);
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
  daySpendUsd,
  monthSpendUsd,
  releaseStaleBuilds,
  dueSets,
  failSet,
  framesDueForInsights,
  getSet,
  listSets,
  markPublished,
  markPublishing,
  nyDate,
  recordFrameContainer,
  recordFramePublished,
  recordHistory,
  recordInsights,
  scheduleSet,
} from '@/lib/stories/repository';
import type { IntakeJev } from '@/lib/intake/types';
import { poolDay, refreshPoolIfDue, type PoolReads } from '@/lib/stories/pool';
import { storiesPoolReads, type ReadConsumerMode } from '@/lib/stories/pool-intake';
import { pickSetPublishAt, requestAutoSets } from '@/lib/stories/schedule';
import { loadSettings, type StoriesSettings } from '@/lib/stories/settings';
import { recordPublishedPhoto } from '@/lib/stories/sources/carousel';
import { accountBusy } from '@/lib/stories/spine';
import type { StoriesStorage } from '@/lib/stories/storage';
import { closeCell } from '@/lib/stories/trivia/cells';
import { runTriviaDaily } from '@/lib/stories/trivia/daily';

/** Auto sets are requested in the Stories hour of the night clock (docs/social-overnight.md, night schedule v2). */
export const AUTO_REQUEST_AFTER = '03:00';

export type WorkerDeps = {
  db: StoriesDb;
  /** reels.* and social.* (read; plus the used-photo insert at publish). */
  sourceDb: StoriesDb;
  /** Builds need the live model clients; created only when a set is claimed. */
  builder: () => Promise<SetBuilderDeps>;
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
};

/** stories.settings key where runTriviaDaily records the pool day it last ran (it runs once per pool day). */
export const TRIVIA_DAILY_KEY = 'trivia_daily';

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
  }

  // 1. Auto series.
  if (nyClock(now) >= AUTO_REQUEST_AFTER) {
    // Daily fill (D54): a series day someone already filled gets no auto set; logged once as fill_reduced.
    // Template mode: one set per Stories slot today, capped per series (null while legacy, or unreadable: each series' own days).
    const slots = await storiesSlotsOn((t, p) => deps.db.query(t, p), nyDate(now)).catch(() => null);
    const requested = await requestAutoSets(deps.db, settings, now, { log: (message, fields) => log(`${message} ${JSON.stringify(fields)}`), slots });
    if (requested.length) log(`auto: requested ${requested.join(', ')}`);
  }

  const released = await releaseStaleBuilds(deps.db);
  if (released.length) log(`build interrupted, trying again: ${released.join(', ')}`);

  // 2. Build one requested set.
  const claimed = await claimNextRequested(deps.db);
  if (claimed) {
    const b = await deps.builder();
    const r = await buildSet({ log, ...b }, claimed.id);
    out.built++;
    log(`build ${claimed.series} ${claimed.ny_date}: ${r.status}${r.flagged ? ' (flagged)' : ''} ${r.detail.slice(0, 200)}`);
    if (r.status === 'ready' && claimed.trigger === 'auto' && settings.series[claimed.series].auto && !r.flagged && !settings.requireApproval) await approveSet(deps.db, claimed.id);
  }

  // 3–4 post nothing while the master switch is off.
  if (!settings.publishingLive) {
    await pollInsights(deps, now, out);
    return out;
  }

  // 3. Schedule approved sets.
  for (const s of await listSets(deps.db, { statuses: ['approved'] })) {
    // A set with a slot (template mode) books in [slot, slot + 15]; one without, in its series' window.
    const at = pickSetPublishAt(settings.series[s.series].window, s, now);
    if (!at) continue; // window passed: the Hub offers Publish now or reject
    await scheduleSet(deps.db, s.id, at);
    out.scheduled++;
    log(`scheduled ${s.series} ${s.ny_date} for ${at.toISOString()}`);
  }

  // 4. Publish due sets.
  for (const s of await dueSets(deps.db, now)) {
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
    if (!f.photo?.src || f.photo.kind === 'logo') continue;
    await recordPublishedPhoto(deps.sourceDb, { url: f.photo.src, usedAt: at, storyId: `stories:${setId}`, slide: f.seq, credit: f.photo.credit, scene: f.role }).catch((err) => log(`used_photos: ${err instanceof Error ? err.message : String(err)}`));
  }
  if (series === 'ai_trivia') {
    // The question has run: its content-map cell is never asked again (CONTRACT §2 cell lifecycle).
    const cellId = ((got.set.payload.trivia as { q?: { cellId?: unknown } } | undefined)?.q?.cellId);
    if (typeof cellId === 'string') await closeCell(deps.db, cellId).catch((err) => log(`trivia: could not close cell ${cellId}: ${err instanceof Error ? err.message : String(err)}`));
    else log(`trivia: set ${setId} has no cell id; no cell closed`);
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
    const spent = await monthSpendUsd(deps.db, now);
    const today = await daySpendUsd(deps.db, now);
    const held = spent >= settings.monthlyWatchUsd ? 'monthly watch reached' : today >= settings.dailyCapUsd ? 'daily cap reached' : null;
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

const logged = new Set<string>();
const once = (key: string, f: () => void) => {
  if (logged.has(key)) return;
  logged.add(key);
  f();
};
