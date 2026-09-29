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
 * True when every minute of the slot is still ahead of `now`. A slot that has
 * already started is not used, so the draw stays uniform over the whole window
 * instead of only the minutes that remain.
 */
export function slotFullyAhead(nyDate: string, slot: SlotId, now: Date, timeZone = POSTING_TIME_ZONE): boolean {
  return slotMinuteInstant(nyDate, slot, 0, timeZone).getTime() > now.getTime();
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
 * The earliest open slot whose whole window is still ahead. `taken` holds
 * `nyDate:slot` keys. `rng` receives the minute count and returns an index
 * into that many minutes; the default is uniform.
 */
export function chooseSlot(
  now: Date,
  taken: ReadonlySet<string>,
  rng: (count: number) => number = uniformIndex,
  timeZone = POSTING_TIME_ZONE,
): SlotChoice | null {
  const start = calendarDateKey(now, timeZone);
  for (let day = 0; day < 14; day += 1) {
    const nyDate = addCalendarDays(start, day);
    for (const slot of POSTING_SLOTS) {
      if (taken.has(slotKey(nyDate, slot.id))) continue;
      if (!slotFullyAhead(nyDate, slot.id, now, timeZone)) continue;
      const count = slotMinuteCount(slot.id);
      const offset = rng(count);
      if (!Number.isInteger(offset) || offset < 0 || offset >= count) {
        throw new Error(`Slot draw returned ${offset} for a window of ${count} minutes.`);
      }
      return { nyDate, slot: slot.id, publishAt: slotMinuteInstant(nyDate, slot.id, offset, timeZone) };
    }
  }
  return null;
}
