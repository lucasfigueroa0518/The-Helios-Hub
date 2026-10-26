/**
 * The week a ranking run covers (plan M2 step 1): the Monday to Sunday after the run date.
 * The dates come from the New York calendar (the post's zone, AE-08); each metro's window runs
 * from its own local midnight on that Monday to its local midnight the Monday after, so a
 * Sunday 11:30 PM event in San Francisco is in the week and a Monday 1 AM one in New York is not.
 *
 * Pure: no database, no network. The hub may import it.
 */
import { calendarDateKey, zoneDateParts, zonedTime } from '@/lib/instagram/clock';
import { METRO_PROFILES } from '@/lib/networking/cities';
import { isoWeekKey } from '@/lib/networking/schedule';
import type { Metro } from '@/lib/networking/types';

/** The zone whose calendar names the week (the post goes out Sunday evening ET). */
export const WEEK_TIMEZONE = 'America/New_York';

export type ComingWeek = {
  /** ISO week of the Monday, e.g. "2026-W44". */
  weekKey: string;
  /** Monday and Sunday, "YYYY-MM-DD". */
  startDate: string;
  endDate: string;
};

export type MetroWindow = ComingWeek & {
  metro: Metro;
  timezone: string;
  /** Local midnight Monday (inclusive) to local midnight the next Monday (exclusive). */
  from: Date;
  to: Date;
};

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday to Sunday strictly after `now`'s New York calendar day. */
export function comingWeek(now: Date): ComingWeek {
  const { year, month, day } = zoneDateParts(now, WEEK_TIMEZONE);
  const today = new Date(Date.UTC(year, month - 1, day));
  const weekday = today.getUTCDay(); // 0 Sunday … 6 Saturday
  const daysToMonday = weekday === 0 ? 1 : 8 - weekday;
  const startDate = shiftDate(today.toISOString().slice(0, 10), daysToMonday);
  const [y, m, d] = startDate.split('-').map(Number);
  return { weekKey: isoWeekKey(new Date(y!, m! - 1, d!, 12)), startDate, endDate: shiftDate(startDate, 6) };
}

/**
 * The week an ISO week key names ("2026-W44"): its Monday to Sunday. A rebuild passes the key of
 * the week it is rebuilding, so the window must come from the key, never from the run date.
 */
export function weekFromKey(weekKey: string): ComingWeek {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  const year = Number(match?.[1]);
  const week = Number(match?.[2]);
  if (!match || week < 1 || week > 53) throw new Error(`not an ISO week key: ${weekKey}`);
  // ISO week 1 is the week holding January 4.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday1 = shiftDate(jan4.toISOString().slice(0, 10), -((jan4.getUTCDay() + 6) % 7));
  const startDate = shiftDate(monday1, 7 * (week - 1));
  const [y, m, d] = startDate.split('-').map(Number);
  const key = isoWeekKey(new Date(y!, m! - 1, d!, 12));
  if (key !== weekKey) throw new Error(`not an ISO week key: ${weekKey}`);
  return { weekKey, startDate, endDate: shiftDate(startDate, 6) };
}

/** Local midnight of `date` in `timeZone`. */
function localMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return zonedTime(y!, m!, d!, 0, 0, timeZone);
}

export function metroWindow(metro: Metro, week: ComingWeek): MetroWindow {
  const timezone = METRO_PROFILES[metro].timezone;
  return {
    ...week,
    metro,
    timezone,
    from: localMidnight(week.startDate, timezone),
    to: localMidnight(shiftDate(week.startDate, 7), timezone),
  };
}

/** The calendar day an instant falls on in `timeZone`, "YYYY-MM-DD". */
export function localDay(at: Date | string, timeZone: string): string {
  return calendarDateKey(typeof at === 'string' ? new Date(at) : at, timeZone);
}
