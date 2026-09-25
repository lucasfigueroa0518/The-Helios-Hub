import { RUN_HOUR_LOCAL, RUN_TIMEZONE } from '@/lib/reels/config';

/**
 * Minutes that the zone is ahead of UTC at `at`. Derived from Intl rather than
 * a fixed offset so the 1 AM run does not drift an hour twice a year.
 */
export function zoneOffsetMinutes(at: Date, timeZone: string = RUN_TIMEZONE): number {
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

  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };

  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Wall-clock calendar date in the zone. */
export function zoneDateParts(
  at: Date,
  timeZone: string = RUN_TIMEZONE,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };
  return { year: field('year'), month: field('month'), day: field('day') };
}

/** The instant when the given wall-clock time occurs in the zone. */
function instantForLocalTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, 0, 0);
  // Offsets are themselves instant-dependent, so resolve twice: the first pass
  // lands close enough that the second uses the correct side of a DST change.
  let guess = new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - zoneOffsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/** Next 1 AM in the run timezone, strictly after `from`. */
export function nextRunAt(
  from: Date,
  timeZone: string = RUN_TIMEZONE,
  hour: number = RUN_HOUR_LOCAL,
): Date {
  const { year, month, day } = zoneDateParts(from, timeZone);
  const today = instantForLocalTime(year, month, day, hour, timeZone);
  if (today.getTime() > from.getTime()) return today;

  // Advance the local calendar date itself. Adding 24 hours to a UTC instant
  // would land on the previous local day for any zone behind UTC.
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return instantForLocalTime(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    hour,
    timeZone,
  );
}

/** First instant of the current month in the run timezone (for the spend watch). */
export function monthStart(at: Date, timeZone: string = RUN_TIMEZONE): Date {
  const { year, month } = zoneDateParts(at, timeZone);
  return instantForLocalTime(year, month, 1, 0, timeZone);
}
