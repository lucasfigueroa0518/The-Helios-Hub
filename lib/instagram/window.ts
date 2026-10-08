import { randomInt } from 'node:crypto';

import { calendarDateKey, SOCIAL_TIMEZONE, zonedTime } from '@/lib/instagram/clock';

/**
 * One daily posting window per content type (docs/social-overnight.md), with
 * the Trial Reels slot rules (lib/reels/publish/slots.ts): a started window
 * still counts, and the minute is drawn uniformly from the minutes still
 * ahead, never in the past. `taken` holds New York dates already filled.
 */

export type PostingWindow = { id: string; label: string; startMinute: number; endMinute: number };
export type WindowChoice = { nyDate: string; slot: string; publishAt: Date };

const minutesIn = (w: PostingWindow) => w.endMinute - w.startMinute + 1;

export function addCalendarDays(nyDate: string, days: number): string {
  const [year, month, day] = nyDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function windowMinuteInstant(w: PostingWindow, nyDate: string, offset: number): Date {
  if (offset < 0 || offset >= minutesIn(w)) throw new Error(`Minute ${offset} is outside the ${w.id} window.`);
  const minuteOfDay = w.startMinute + offset;
  const [year, month, day] = nyDate.split('-').map(Number);
  return zonedTime(year, month, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, SOCIAL_TIMEZONE);
}

/** Minutes of that day's window strictly after `now`; null once the window is over. */
export function openWindowRange(w: PostingWindow, nyDate: string, now: Date): { startOffset: number; count: number } | null {
  const total = minutesIn(w);
  const nowMs = now.getTime();
  if (windowMinuteInstant(w, nyDate, total - 1).getTime() <= nowMs) return null;
  if (windowMinuteInstant(w, nyDate, 0).getTime() > nowMs) return { startOffset: 0, count: total };
  let lo = 0;
  let hi = total - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (windowMinuteInstant(w, nyDate, mid).getTime() > nowMs) hi = mid - 1;
    else lo = mid;
  }
  const startOffset = lo + 1;
  return startOffset >= total ? null : { startOffset, count: total - startOffset };
}

export function uniformIndex(count: number): number {
  if (count < 1) throw new Error('The window has no minutes.');
  return randomInt(0, count);
}

/** The earliest open, untaken day's window, up to `throughDate` (default 14 days ahead). */
export function chooseWindow(
  w: PostingWindow,
  now: Date,
  taken: ReadonlySet<string>,
  rng: (count: number) => number = uniformIndex,
  throughDate?: string,
): WindowChoice | null {
  const start = calendarDateKey(now, SOCIAL_TIMEZONE);
  const last = throughDate ?? addCalendarDays(start, 13);
  for (let day = 0; day < 14; day += 1) {
    const nyDate = addCalendarDays(start, day);
    if (nyDate > last) break;
    if (taken.has(nyDate)) continue;
    const open = openWindowRange(w, nyDate, now);
    if (!open) continue;
    const drawn = rng(open.count);
    if (!Number.isInteger(drawn) || drawn < 0 || drawn >= open.count) {
      throw new Error(`Slot draw returned ${drawn} for a window of ${open.count} minutes.`);
    }
    return { nyDate, slot: w.id, publishAt: windowMinuteInstant(w, nyDate, open.startOffset + drawn) };
  }
  return null;
}

/**
 * Any two feed posts stay at least this far apart, across every content type
 * (SH-47). Stories are not feed posts and are exempt; so are Trial Reels (D33).
 */
export const FEED_GAP_MINUTES = 30;

/** Offsets in [startOffset, startOffset + count) whose instant is ≥ gap from every busy instant. */
export function spacedOffsets(
  instantOf: (offset: number) => Date,
  startOffset: number,
  count: number,
  busy: readonly Date[],
  gapMinutes = FEED_GAP_MINUTES,
): number[] {
  const gap = gapMinutes * 60_000;
  const out: number[] = [];
  for (let offset = startOffset; offset < startOffset + count; offset += 1) {
    const t = instantOf(offset).getTime();
    if (busy.every((b) => Math.abs(b.getTime() - t) >= gap)) out.push(offset);
  }
  return out;
}

/**
 * Several windows a day (SH-46, SH-48): the earliest open window whose
 * `nyDate|slot` is not taken and that still has a minute ≥ 30 minutes from
 * every other feed post; the minute is drawn uniformly from those.
 */
export function chooseFromWindows(
  windows: readonly PostingWindow[],
  now: Date,
  takenSlots: ReadonlySet<string>,
  busy: readonly Date[],
  rng: (count: number) => number = uniformIndex,
  throughDate?: string,
): WindowChoice | null {
  const start = calendarDateKey(now, SOCIAL_TIMEZONE);
  const last = throughDate ?? addCalendarDays(start, 13);
  for (let day = 0; day < 14; day += 1) {
    const nyDate = addCalendarDays(start, day);
    if (nyDate > last) break;
    for (const w of windows) {
      if (takenSlots.has(slotTakenKey(nyDate, w.id))) continue;
      const open = openWindowRange(w, nyDate, now);
      if (!open) continue;
      const offsets = spacedOffsets((o) => windowMinuteInstant(w, nyDate, o), open.startOffset, open.count, busy);
      if (offsets.length === 0) continue;
      const drawn = rng(offsets.length);
      if (!Number.isInteger(drawn) || drawn < 0 || drawn >= offsets.length) {
        throw new Error(`Slot draw returned ${drawn} for ${offsets.length} open minutes.`);
      }
      return { nyDate, slot: w.id, publishAt: windowMinuteInstant(w, nyDate, offsets[drawn]!) };
    }
  }
  return null;
}

export function slotTakenKey(nyDate: string, slot: string): string {
  return `${nyDate}|${slot}`;
}
