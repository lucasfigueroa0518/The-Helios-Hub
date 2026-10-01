import { randomInt } from 'node:crypto';

import { RUN_TIMEZONE } from '@/lib/reels/config';
import { calendarDateKey, zonedTime } from '@/lib/reels/schedule';

/**
 * Three posting windows, America/New_York, every day of the week.
 * Both ends are minutes that can be chosen: 10:00 AM, 12:30 PM, and 9:00 PM
 * are inside the slot. A slot holds one reel. The minute is uniform across
 * every minute in the window.
 */

export const POSTING_TIME_ZONE = RUN_TIMEZONE;

export const POSTING_SLOTS = [
  { id: 'morning', label: '8:45–10:00 AM', startMinute: 8 * 60 + 45, endMinute: 10 * 60 },
  { id: 'midday', label: '11:15 AM–12:30 PM', startMinute: 11 * 60 + 15, endMinute: 12 * 60 + 30 },
  { id: 'evening', label: '6:00–9:00 PM', startMinute: 18 * 60, endMinute: 21 * 60 },
] as const;

export type SlotId = (typeof POSTING_SLOTS)[number]['id'];

export type SlotChoice = {
  nyDate: string;
  slot: SlotId;
  publishAt: Date;
};

const SLOT_BY_ID = new Map(POSTING_SLOTS.map((slot) => [slot.id, slot]));

/** How many clock minutes the slot contains, including both ends. */
export function slotMinuteCount(slot: SlotId): number {
  const window = SLOT_BY_ID.get(slot);
  if (!window) throw new Error(`Unknown posting slot: ${slot}`);
  return window.endMinute - window.startMinute + 1;
}

export function slotLabel(slot: SlotId): string {
  return SLOT_BY_ID.get(slot)?.label ?? slot;
}

const SLOT_NAME: Record<SlotId, string> = {
  morning: 'Morning',
  midday: 'Midday',
  evening: 'Evening',
};

/** Which posting window contains this instant, or unscheduled when it sits outside all three. */
export function slotForInstant(at: Date, timeZone: string = POSTING_TIME_ZONE): SlotId | 'unscheduled' {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const clock = hour * 60 + minute;
  for (const slot of POSTING_SLOTS) {
    if (clock >= slot.startMinute && clock <= slot.endMinute) return slot.id;
  }
  return 'unscheduled';
}

/** A schedule row wins. A force post with no row is placed by the clock. */
export function resolveSlot(stored: string | null | undefined, finishedAt: Date): SlotId | 'unscheduled' {
  if (stored === 'morning' || stored === 'midday' || stored === 'evening') return stored;
  return slotForInstant(finishedAt);
}

export function slotCaption(slot: SlotId | 'unscheduled'): string {
  if (slot === 'unscheduled') return 'Outside a slot';
  return `${SLOT_NAME[slot]} · ${slotLabel(slot)}`;
}

/** `YYYY-MM-DD` plus calendar days, staying on the calendar rather than adding 24 hours. */
export function addCalendarDays(nyDate: string, days: number): string {
  const [year, month, day] = nyDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/** The instant of one minute inside a slot. `offset` is 0 for the first minute. */
export function slotMinuteInstant(nyDate: string, slot: SlotId, offset: number, timeZone = POSTING_TIME_ZONE): Date {
  const window = SLOT_BY_ID.get(slot);
  if (!window) throw new Error(`Unknown posting slot: ${slot}`);
  const count = slotMinuteCount(slot);
  if (offset < 0 || offset >= count) throw new Error(`Minute ${offset} is outside ${slot}.`);
  const minuteOfDay = window.startMinute + offset;
  const [year, month, day] = nyDate.split('-').map(Number);
  return zonedTime(year, month, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, timeZone);
}

/**
 * True when the slot has not started yet. A slot that has started can still
 * take one reel; see `openMinuteRange`.
 */
export function slotFullyAhead(nyDate: string, slot: SlotId, now: Date, timeZone = POSTING_TIME_ZONE): boolean {
  return slotMinuteInstant(nyDate, slot, 0, timeZone).getTime() > now.getTime();
}

/**
 * Minutes still strictly after `now`, including a window that has already
 * started. Null once the last minute of the window has arrived. The draw is
 * uniform over that remainder, so the post is never placed in the past.
 */
export function openMinuteRange(
  nyDate: string,
  slot: SlotId,
  now: Date,
  timeZone = POSTING_TIME_ZONE,
): { startOffset: number; count: number } | null {
  const total = slotMinuteCount(slot);
  const nowMs = now.getTime();
  if (slotMinuteInstant(nyDate, slot, total - 1, timeZone).getTime() <= nowMs) return null;
  if (slotMinuteInstant(nyDate, slot, 0, timeZone).getTime() > nowMs) {
    return { startOffset: 0, count: total };
  }
  let lo = 0;
  let hi = total - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (slotMinuteInstant(nyDate, slot, mid, timeZone).getTime() > nowMs) hi = mid - 1;
    else lo = mid;
  }
  const startOffset = lo + 1;
  if (startOffset >= total) return null;
  return { startOffset, count: total - startOffset };
}

export function slotKey(nyDate: string, slot: SlotId): string {
  return `${nyDate}:${slot}`;
}

/** Uniform index in `0 .. count-1`. `crypto.randomInt` is the unbiased integer draw. */
export function uniformIndex(count: number): number {
  if (count < 1) throw new Error('A slot has no minutes.');
  return randomInt(0, count);
}

/**
 * The earliest window that has not ended. A window that has started still
 * counts, and the minute is drawn from the minutes still ahead. `taken` holds
 * `nyDate:slot` keys. `rng` receives how many minutes are still open and
 * returns an index into that remainder. `throughDate` stops the search on
 * that calendar day, so turning Live on late does not fill tomorrow.
 */
export function chooseSlot(
  now: Date,
  taken: ReadonlySet<string>,
  rng: (count: number) => number = uniformIndex,
  timeZone = POSTING_TIME_ZONE,
  throughDate?: string,
): SlotChoice | null {
  const start = calendarDateKey(now, timeZone);
  const last = throughDate ?? addCalendarDays(start, 13);
  for (let day = 0; day < 14; day += 1) {
    const nyDate = addCalendarDays(start, day);
    if (nyDate > last) break;
    for (const slot of POSTING_SLOTS) {
      if (taken.has(slotKey(nyDate, slot.id))) continue;
      const open = openMinuteRange(nyDate, slot.id, now, timeZone);
      if (!open) continue;
      const drawn = rng(open.count);
      if (!Number.isInteger(drawn) || drawn < 0 || drawn >= open.count) {
        throw new Error(`Slot draw returned ${drawn} for a window of ${open.count} minutes.`);
      }
      const offset = open.startOffset + drawn;
      return { nyDate, slot: slot.id, publishAt: slotMinuteInstant(nyDate, slot.id, offset, timeZone) };
    }
  }
  return null;
}
