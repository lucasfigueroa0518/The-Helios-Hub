import { randomInt } from 'node:crypto';

import { calendarDateKey, zonedTime } from './clock';
import { CAROUSEL_SLOT, SOCIAL_TIMEZONE, type CarouselSlotId } from './config';

/**
 * The carousel posting window (7:00–8:15 AM New York). Same rules as the Trial
 * Reels slots (lib/reels/publish/slots.ts): a started window still counts, the
 * minute is drawn uniformly from the minutes still ahead, never in the past.
 */

export type CarouselSlotChoice = { nyDate: string; slot: CarouselSlotId; publishAt: Date };

const MINUTES = CAROUSEL_SLOT.endMinute - CAROUSEL_SLOT.startMinute + 1;

export function addCalendarDays(nyDate: string, days: number): string {
  const [year, month, day] = nyDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function slotMinuteInstant(nyDate: string, offset: number): Date {
  if (offset < 0 || offset >= MINUTES) throw new Error(`Minute ${offset} is outside the carousel window.`);
  const minuteOfDay = CAROUSEL_SLOT.startMinute + offset;
  const [year, month, day] = nyDate.split('-').map(Number);
  return zonedTime(year, month, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, SOCIAL_TIMEZONE);
}

/** Minutes of that day's window strictly after `now`; null once the window is over. */
export function openMinuteRange(nyDate: string, now: Date): { startOffset: number; count: number } | null {
  const nowMs = now.getTime();
  if (slotMinuteInstant(nyDate, MINUTES - 1).getTime() <= nowMs) return null;
  if (slotMinuteInstant(nyDate, 0).getTime() > nowMs) return { startOffset: 0, count: MINUTES };
  let lo = 0;
  let hi = MINUTES - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (slotMinuteInstant(nyDate, mid).getTime() > nowMs) hi = mid - 1;
    else lo = mid;
  }
  const startOffset = lo + 1;
  return startOffset >= MINUTES ? null : { startOffset, count: MINUTES - startOffset };
}

export function uniformIndex(count: number): number {
  if (count < 1) throw new Error('The window has no minutes.');
  return randomInt(0, count);
}

/** The earliest open, untaken day's window, up to `throughDate` (default 14 days). `taken` holds ny dates. */
export function chooseCarouselSlot(
  now: Date,
  taken: ReadonlySet<string>,
  rng: (count: number) => number = uniformIndex,
  throughDate?: string,
): CarouselSlotChoice | null {
  const start = calendarDateKey(now, SOCIAL_TIMEZONE);
  const last = throughDate ?? addCalendarDays(start, 13);
  for (let day = 0; day < 14; day += 1) {
    const nyDate = addCalendarDays(start, day);
    if (nyDate > last) break;
    if (taken.has(nyDate)) continue;
    const open = openMinuteRange(nyDate, now);
    if (!open) continue;
    const drawn = rng(open.count);
    if (!Number.isInteger(drawn) || drawn < 0 || drawn >= open.count) {
      throw new Error(`Slot draw returned ${drawn} for a window of ${open.count} minutes.`);
    }
    return { nyDate, slot: CAROUSEL_SLOT.id, publishAt: slotMinuteInstant(nyDate, open.startOffset + drawn) };
  }
  return null;
}
