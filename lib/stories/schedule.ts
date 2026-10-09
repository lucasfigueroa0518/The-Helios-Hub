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
import type { Queryable } from '@/lib/stories/db';
import type { Series } from '@/lib/stories/render/types';
import { nyDate, requestSet } from '@/lib/stories/repository';
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
 * Request today's set for every enabled auto series that is due and has none.
 * Returns what was requested. Daily fill (D54): a series' day that a person
 * already filled (a set they generated and approved or scheduled, or placed
 * there) gets no auto set; logged once as `fill_reduced`. Any other live set
 * for the day (in the making, or the auto set itself) holds it as before
 * (one live set per series per day).
 */
export async function requestAutoSets(db: Queryable, settings: StoriesSettings, now: Date, opts: { log?: FillLog } = {}): Promise<Series[]> {
  const date = nyDate(now);
  const out: Series[] = [];
  for (const s of SERIES) {
    const cfg = settings.series[s];
    if (!cfg.enabled || !cfg.auto || !isDueOn(cfg.window, date)) continue;
    // Too late to build and post today: skip, not post late.
    if (now > windowBounds(cfg.window, date).end) continue;
    const placed = await seriesDayPlaced(db, s, date);
    const fill: DailyFill = { vertical: 'stories', nyDate: date, quota: SERIES_DAY_QUOTA, userPlaced: placed, making: remainingQuota(SERIES_DAY_QUOTA, placed) };
    if (fill.making < 1) {
      const key = `${s}:${date}`;
      const seen = reportedFills.get(db) ?? new Set<string>();
      reportedFills.set(db, seen);
      if (!seen.has(key)) {
        if (seen.size > 500) seen.clear();
        seen.add(key);
        reportFill(fill, opts.log ?? consoleFillLog, { series: s });
      }
      continue;
    }
    const { created } = await requestSet(db, { series: s, nyDate: date, trigger: 'auto', style: cfg.style });
    if (created) out.push(s);
  }
  return out;
}
