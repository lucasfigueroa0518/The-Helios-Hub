import { zonedTime } from '@/lib/instagram/clock';
import { addDays, nyDateOf } from '@/lib/social-hub/time';

export const REPORT_HOUR = 7;
export const REPORT_MINUTE = 30;

const parts = (night: string) => night.split('-').map(Number) as [number, number, number];

/** Night N = 08:00 on N−1 to 07:30 on N, America/New_York. */
export function cycleBounds(night: string): { start: Date; end: Date } {
  const [py, pm, pd] = parts(addDays(night, -1));
  const [y, m, d] = parts(night);
  return { start: zonedTime(py, pm, pd, 8, 0), end: zonedTime(y, m, d, REPORT_HOUR, REPORT_MINUTE) };
}

/** The newest night whose 07:30 report time has passed. */
export function reportNightFor(now: Date): string {
  const today = nyDateOf(now)!;
  return now.getTime() >= cycleBounds(today).end.getTime() ? today : addDays(today, -1);
}

export function nightsEnding(night: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(night, i - (n - 1)));
}

/** 0 = Sunday … 6 = Saturday (the same convention as SeriesState.days in lib/content-type/posting.ts). */
export function weekdayIndex(night: string): number {
  return new Date(`${night}T12:00:00Z`).getUTCDay();
}
