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

/** Request today's set for every enabled auto series that is due and has none. Returns what was requested. */
export async function requestAutoSets(db: Queryable, settings: StoriesSettings, now: Date): Promise<Series[]> {
  const date = nyDate(now);
  const out: Series[] = [];
  for (const s of SERIES) {
    const cfg = settings.series[s];
    if (!cfg.enabled || !cfg.auto || !isDueOn(cfg.window, date)) continue;
    // Too late to build and post today: skip, not post late.
    if (now > windowBounds(cfg.window, date).end) continue;
    const { created } = await requestSet(db, { series: s, nyDate: date, trigger: 'auto', style: cfg.style });
    if (created) out.push(s);
  }
  return out;
}
