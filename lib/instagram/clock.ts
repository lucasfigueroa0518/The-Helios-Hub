/**
 * New York wall-clock maths shared by the social content types' overnight
 * workers (docs/social-overnight.md). Same logic as lib/reels/schedule.ts:
 * offsets come from Intl, so 3:00 AM stays 3:00 AM across both DST changes.
 */

export const SOCIAL_TIMEZONE = 'America/New_York';

export function zoneOffsetMinutes(at: Date, timeZone: string = SOCIAL_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const field = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(field('year'), field('month') - 1, field('day'), field('hour'), field('minute'), field('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

export function zoneDateParts(at: Date, timeZone: string = SOCIAL_TIMEZONE): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const field = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: field('year'), month: field('month'), day: field('day') };
}

/** `YYYY-MM-DD` in the zone. */
export function calendarDateKey(at: Date, timeZone: string = SOCIAL_TIMEZONE): string {
  const { year, month, day } = zoneDateParts(at, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The instant when the given wall-clock time occurs in the zone. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute = 0, timeZone: string = SOCIAL_TIMEZONE): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Resolve twice: the first pass lands close enough that the second uses the right side of a DST change.
  let guess = new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - zoneOffsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/** The next given wall-clock time in the zone, strictly after `from`. */
export function nextRunAt(from: Date, hour: number, minute = 0, timeZone: string = SOCIAL_TIMEZONE): Date {
  const { year, month, day } = zoneDateParts(from, timeZone);
  const today = zonedTime(year, month, day, hour, minute, timeZone);
  if (today.getTime() > from.getTime()) return today;
  // Advance the local calendar date; adding 24 hours would drift across DST.
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hour, minute, timeZone);
}
