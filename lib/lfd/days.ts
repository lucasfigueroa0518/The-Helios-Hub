/** Weekdays over New York calendar dates (pure). */
import { addCalendarDays } from '@/lib/instagram/window';

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD New York date. */
export function weekdayOfDate(nyDate: string): number {
  return new Date(`${nyDate}T12:00:00Z`).getUTCDay();
}

/** The `count` dates from `start` whose weekday is in `days` (`on`), or is not (`!on`). */
export function datesByWeekday(start: string, count: number, days: readonly number[], on: boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = addCalendarDays(start, i);
    if (days.includes(weekdayOfDate(day)) === on) out.push(day);
  }
  return out;
}
