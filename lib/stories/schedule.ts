/**
 * When Stories post (S-01, S-20, M8). Windows are America/New_York; the minute
 * is uniform across every minute in the window, both ends included, the way
 * lib/reels/publish/slots.ts picks a reel's minute.
 *
 *   - A series is due on a day its window lists (Guess the Number Mon/Thu,
 *     Free vs. Paid Tue/Sat, Morning Download daily).
 *   - Auto series (S-05) get a `requested` set early that day; the worker
 *     builds it, approves it (auto), and schedules it.
 *   - A set approved by hand is scheduled for its day's window; if the window
 *     has passed, Lucas's "Publish now" is the only way out (risk 6: a missed
 *     window is skipped, not posted late).
 */
import { randomInt } from 'node:crypto';

import { zonedTime } from '@/lib/reels/schedule';
import { consoleFillLog, remainingQuota, reportFill, userPlaced, type DailyFill, type FillLog } from '@/lib/social-hub/fill';
import { driftMinute } from '@/lib/social-hub/slots/book';
import { DRIFT } from '@/lib/social-hub/slots/times';
import type { ResolvedSlot } from '@/lib/social-hub/slots/types';
import type { Queryable } from '@/lib/stories/db';
import type { Series } from '@/lib/stories/render/types';
import { nyDate, requestSet, SLOT_MINUTE_SQL, type StorySet } from '@/lib/stories/repository';
import { SERIES, type PostingWindow, type StoriesSettings } from '@/lib/stories/settings';

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** Day of week (0 = Sunday) of a New York calendar date. */
export const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export const isDueOn = (w: PostingWindow, date: string) => w.days.includes(weekday(date));

/** The instant a window opens and closes on a New York date. */
export function windowBounds(w: PostingWindow, date: string): { start: Date; end: Date } {
  const [y, mo, d] = date.split('-').map(Number);
  const at = (m: number) => zonedTime(y!, mo!, d!, Math.floor(m / 60), m % 60, 'America/New_York');
  return { start: at(minutes(w.start)), end: at(minutes(w.end)) };
}

/** A minute inside the window, uniform; never before `notBefore` (a set approved mid-window). Null when the window has passed. */
export function pickPublishAt(w: PostingWindow, date: string, notBefore: Date, rand: (n: number) => number = randomInt): Date | null {
  const { start, end } = windowBounds(w, date);
  const from = Math.max(start.getTime(), Math.ceil(notBefore.getTime() / 60_000) * 60_000);
  if (from > end.getTime()) return null;
  const span = Math.floor((end.getTime() - from) / 60_000) + 1;
  return new Date(from + rand(span) * 60_000);
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * The window a set posts in. Template mode (the set has a `slot_minute`): its
 * slot, [slot, slot + 15]; otherwise its series' own window, as before.
 */
export function setWindow(seriesWindow: PostingWindow, slotMinute: number | null | undefined): PostingWindow {
  return slotMinute == null ? seriesWindow : slotWindow(slotMinute);
}

/** A Stories slot as a posting window: [slot, slot + 15], any day. */
export const slotWindow = (slotMinute: number): PostingWindow => ({ start: hhmm(slotMinute), end: hhmm(slotMinute + DRIFT), days: [0, 1, 2, 3, 4, 5, 6] });

/**
 * The minute a set posts, never before `notBefore`; null when its time has
 * passed. A set with a slot books at a drifted minute in [slot, slot + 15]
 * (the calendar's driftMinute; Stories ignore the feed gap); a set without
 * one takes a uniform minute in its series' window (pickPublishAt).
 */
export function pickSetPublishAt(
  seriesWindow: PostingWindow,
  set: Pick<StorySet, 'series' | 'ny_date' | 'slot_minute'>,
  notBefore: Date,
  rand: (n: number) => number = randomInt,
): Date | null {
  if (set.slot_minute == null) return pickPublishAt(seriesWindow, set.ny_date, notBefore, rand);
  const slot: ResolvedSlot = { vertical: 'stories', startMinute: set.slot_minute, series: set.series, feedMode: null, origin: 'template' };
  return driftMinute(set.ny_date, slot, notBefore, [], rand);
}

const clock12 = (hhmm: string) => {
  const m = minutes(hhmm);
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}`;
};
/** "8:30-10:00 AM" for a window, as the Hub says it to a person. */
export function windowLabel(w: PostingWindow): string {
  const ampm = (hhmm: string) => (minutes(hhmm) >= 720 ? 'PM' : 'AM');
  const [a, b] = [ampm(w.start), ampm(w.end)];
  return `${clock12(w.start)}${a === b ? '' : ` ${a}`}-${clock12(w.end)} ${b}`;
}

/**
 * What a person should be told when they approve a set: does the worker still
 * have a minute to schedule it? The worker never posts a set late
 * (worker.ts: a passed window is skipped), so after the window only
 * Publish now moves it.
 */
export function approvalNote(w: PostingWindow, date: string, now: Date, publishingLive = true): string {
  const label = windowLabel(w);
  if (pickPublishAt(w, date, now, () => 0) === null) {
    return `Approved, but the ${label} window has passed for ${date}, so this will not be scheduled and will not post unless you press Publish now.`;
  }
  if (!publishingLive) return `Approved. Publishing is switched off in Settings, so it will wait there and is only scheduled once publishing is back on (the ${label} window still has to be open).`;
  return `Approved. It posts at a random minute in its ${label} window.`;
}

/** Each series posts one set per due day: the daily fill's quota for a series (D54). */
export const SERIES_DAY_QUOTA = 1;

/**
 * How many sets a person put on this series' day: a set someone generated
 * (`click`) that is approved, scheduled, posting or posted for it, or a slot
 * placed by a person on the spine for that series and day (`source = 'user'`).
 * Rejected, failed and skipped sets, and cancelled or failed slots, never
 * count. An auto set already holding its day is the night's own work: it
 * isn't a placement, and the one-live-set-per-day index keeps a second one out.
 */
export async function seriesDayPlaced(db: Queryable, series: Series, date: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM stories.sets
      WHERE series = $1 AND ny_date = $2::date AND trigger = 'click'
        AND status IN ('approved', 'scheduled', 'publishing', 'published')`,
    [series, date],
  );
  const sets = Number(rows[0]?.n ?? 0);
  // The spine is a projection (D44): if it can't be read, the set rows above still decide.
  const spine = await userPlaced((text, params) => db.query(text, params), 'stories', date, { slot: series }).catch(() => 0);
  return Math.max(sets, spine);
}

/** Series days already reported as filled, per database handle, so the 15-second loop logs each once. */
const reportedFills = new WeakMap<object, Set<string>>();

/**
 * How many times the worker asks for an auto set for one series on one day
 * after its builds ended without a set (2026-10-11). A skipped set (no story
 * or pair cleared the bar, or the day's spend cap was reached) leaves the
 * one-live-set-per-day index, so without this the 15-second loop asked again
 * on every tick: on Sat Oct 10 it made 1,126 skipped Free vs. Paid sets in six
 * hours, about \$1.95 of builds before the \$2 daily cap held. A skip is
 * tried once a day (the same pool gives the same answer a minute later); an
 * error is tried up to three times. A person's Generate click is never held.
 */
export const MAX_AUTO_SKIPS_PER_DAY = 1;
export const MAX_AUTO_FAILURES_PER_DAY = 3;

/** Ended auto attempts for a series day; in template mode for one slot of it (null: the series' one set of the day). */
async function autoAttempts(db: Queryable, series: Series, date: string, slotMinute: number | null): Promise<{ skipped: number; failed: number }> {
  // Legacy (no slot) never names the slot column, so it runs before the schema has it (R12).
  const { rows } = await db.query<{ status: string; n: number }>(
    `SELECT status, count(*)::int AS n FROM stories.sets
      WHERE series = $1 AND ny_date = $2::date AND trigger = 'auto' AND status IN ('skipped', 'failed')
        ${slotMinute === null ? '' : `AND ${SLOT_MINUTE_SQL} = $3::smallint`}
      GROUP BY status`,
    slotMinute === null ? [series, date] : [series, date, slotMinute],
  );
  const n = (status: string) => Number(rows.find((r) => r.status === status)?.n ?? 0);
  return { skipped: n('skipped'), failed: n('failed') };
}

const reportedHolds = new WeakMap<object, Set<string>>();

/** Log once per key per database handle (the 15-second loop would repeat it). */
function once(store: WeakMap<object, Set<string>>, db: object, key: string, emit: () => void): void {
  const seen = store.get(db) ?? new Set<string>();
  store.set(db, seen);
  if (seen.has(key)) return;
  if (seen.size > 500) seen.clear();
  seen.add(key);
  emit();
}

/** True when the day's auto attempts for this series (and slot) ended without a set too often (see MAX_AUTO_SKIPS_PER_DAY); logs `auto_held` once. */
async function autoHeld(db: Queryable, s: Series, date: string, slotMinute: number | null, log: FillLog): Promise<boolean> {
  const tried = await autoAttempts(db, s, date, slotMinute);
  if (tried.skipped < MAX_AUTO_SKIPS_PER_DAY && tried.failed < MAX_AUTO_FAILURES_PER_DAY) return false;
  const key = slotMinute == null ? `${s}:${date}` : `${s}:${date}:${slotMinute}`;
  once(reportedHolds, db, key, () =>
    log('auto_held', { series: s, nyDate: date, ...(slotMinute == null ? {} : { slotMinute }), skipped: tried.skipped, failed: tried.failed, why: 'the day\'s auto attempt ended without a set; Generate (a person) can still ask' }));
  return true;
}

/** Live (not rejected, failed or skipped) sets of a series day, any trigger, any slot. */
async function liveSetsOn(db: Queryable, s: Series, date: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM stories.sets WHERE series = $1 AND ny_date = $2::date AND status NOT IN ('rejected', 'failed', 'skipped')`,
    [s, date],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Request today's set for every enabled auto series that is due and has none.
 * Returns what was requested, a series once per set. Daily fill (D54): a
 * series' day that a person already filled (a set they generated and
 * approved or scheduled, or placed there) gets no auto set; logged once as
 * `fill_reduced`. Any other live set for the day (in the making, the auto set
 * itself, or a template set with a slot) holds it (one live set per series
 * per day).
 *
 * `slots` (template mode, from storiesSlotsOn: today's Stories slots within
 * the per-series cap): one set per open slot (openStorySlots), `slot_minute`
 * = the slot, so a series can post more than once a day; each is logged as
 * `auto_requested` with its minute. Null or absent: each series' own days and
 * window, as before.
 */
export async function requestAutoSets(db: Queryable, settings: StoriesSettings, now: Date, opts: { log?: FillLog; slots?: readonly ResolvedSlot[] | null } = {}): Promise<Series[]> {
  if (opts.slots) return requestSlotSets(db, settings, now, opts.slots, opts.log ?? consoleFillLog);
  const date = nyDate(now);
  const log = opts.log ?? consoleFillLog;
  const out: Series[] = [];
  for (const s of SERIES) {
    const cfg = settings.series[s];
    if (!cfg.enabled || !cfg.auto || !isDueOn(cfg.window, date)) continue;
    // Too late to build and post today: skip, not post late.
    if (now > windowBounds(cfg.window, date).end) continue;
    const placed = await seriesDayPlaced(db, s, date);
    const fill: DailyFill = { vertical: 'stories', nyDate: date, quota: SERIES_DAY_QUOTA, userPlaced: placed, making: remainingQuota(SERIES_DAY_QUOTA, placed) };
    if (fill.making < 1) {
      once(reportedFills, db, `${s}:${date}`, () => reportFill(fill, log, { series: s }));
      continue;
    }
    // Any live set holds the day, a template one with a slot too (a slot read that failed lands here).
    if ((await liveSetsOn(db, s, date)) > 0) continue;
    // An auto attempt that ended in a skip or errors is not repeated on every tick (see MAX_AUTO_SKIPS_PER_DAY).
    if (await autoHeld(db, s, date, null, log)) continue;
    const { created } = await requestSet(db, { series: s, nyDate: date, trigger: 'auto', style: cfg.style });
    if (created) out.push(s);
  }
  return out;
}

/** `morning_download@09:00`, for logs. */
export const slotLabel = (series: Series, minute: number) => `${series}@${hhmm(minute)}`;

/** One series' day in template mode: the slots still to make, and the day's fill. */
export type SeriesSlotDay = { open: ResolvedSlot[]; fill: DailyFill; slotted: number; loose: number };

/**
 * Template mode: which of each series' capped Stories slots on today's date
 * still need a set (the worker requests exactly these; Run now lists a
 * series while it has one). A slot is held by a live set at its minute. Every
 * other live set of the series day (no slot: Generate, a placement under the
 * series name; any status, any trigger) fills the earliest free slot. No more
 * than the series' slot count is ever live, and a slot whose [slot, slot + 15]
 * has passed is not open. Enabled and auto switches are the caller's.
 */
export async function openStorySlots(db: Queryable, slots: readonly ResolvedSlot[], now: Date): Promise<Map<Series, SeriesSlotDay>> {
  const date = nyDate(now);
  const out = new Map<Series, SeriesSlotDay>();
  for (const s of SERIES) {
    const mine = slots.filter((x) => x.vertical === 'stories' && x.series === s).sort((a, b) => a.startMinute - b.startMinute);
    if (!mine.length) continue;
    const { rows } = await db.query<{ m: number | null }>(
      `SELECT ${SLOT_MINUTE_SQL} AS m FROM stories.sets WHERE series = $1 AND ny_date = $2::date AND status NOT IN ('rejected', 'failed', 'skipped')`,
      [s, date],
    );
    // A set at an over-cap minute (a person put it there) is theirs, not the run's: it never starves a within-cap slot.
    const minutes = new Set(rows.flatMap((r) => (r.m === null ? [] : [Number(r.m)])).filter((m) => mine.some((x) => x.startMinute === m)));
    const looseSets = rows.filter((r) => r.m === null).length;
    // The spine is a projection (D44): a placement under the series name counts like a set without a slot.
    const spine = await userPlaced((text, params) => db.query(text, params), 'stories', date, { slot: s }).catch(() => 0);
    const loose = Math.max(looseSets, spine);
    const live = minutes.size + loose;
    const allowance = Math.max(0, mine.length - live);
    const free = mine.filter((x) => !minutes.has(x.startMinute)).slice(loose);
    const open = free.filter((x) => now <= windowBounds(slotWindow(x.startMinute), date).end).slice(0, allowance);
    out.set(s, { open, slotted: minutes.size, loose, fill: { vertical: 'stories', nyDate: date, quota: mine.length, userPlaced: loose, making: allowance } });
  }
  return out;
}

async function requestSlotSets(db: Queryable, settings: StoriesSettings, now: Date, slots: readonly ResolvedSlot[], log: FillLog): Promise<Series[]> {
  const date = nyDate(now);
  const out: Series[] = [];
  for (const [s, day] of await openStorySlots(db, slots, now)) {
    const cfg = settings.series[s];
    if (!cfg.enabled || !cfg.auto) continue;
    // A person's set without a slot took one of the day's slots: logged once with the series day's totals.
    if (day.loose > 0) once(reportedFills, db, `${s}:${date}`, () => reportFill(day.fill, log, { series: s, slotted: day.slotted }));
    for (const slot of day.open) {
      const minute = slot.startMinute;
      if (await autoHeld(db, s, date, minute, log)) continue;
      const { created } = await requestSet(db, { series: s, nyDate: date, trigger: 'auto', style: cfg.style, slotMinute: minute });
      if (!created) continue;
      out.push(s);
      log('auto_requested', { series: s, nyDate: date, slotMinute: minute, slot: slotLabel(s, minute) });
    }
  }
  return out;
}
