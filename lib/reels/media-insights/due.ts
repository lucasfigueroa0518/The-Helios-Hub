import { calendarDateKey } from '@/lib/reels/schedule';

/** Reels newer than this are asked again on every refresh. */
export const INSIGHTS_FRESH_MS = 2 * 86_400_000;

/** Through this age, one reading per New York day. The next reading after it is the last. */
export const INSIGHTS_WARM_MS = 14 * 86_400_000;

export const INSIGHTS_COOLDOWN_MS = 30 * 60_000;

/** A refresh that never finished does not block the next one forever. */
export const INSIGHTS_STALE_LOCK_MS = 10 * 60_000;

/** Trial Reels page open. Enough for the reels posted since the previous open. */
export const INSIGHTS_PAGE_BATCH = 24;

/** The Refresh button. Larger than a page open, still bounded. */
export const INSIGHTS_REFRESH_BATCH = 80;

/** Nightly drain. A few months of daily posts fit in one pass. */
export const INSIGHTS_NIGHTLY_BATCH = 200;

export function insightIsDue(input: { finishedAt: Date; checkedAt: Date | null; now: Date }): boolean {
  const age = input.now.getTime() - input.finishedAt.getTime();
  if (age < 0) return false;
  if (!input.checkedAt) return true;
  const sinceCheck = input.now.getTime() - input.checkedAt.getTime();
  if (age <= INSIGHTS_FRESH_MS && sinceCheck >= INSIGHTS_COOLDOWN_MS) return true;
  if (age <= INSIGHTS_WARM_MS && calendarDateKey(input.checkedAt) < calendarDateKey(input.now)) return true;
  if (age > INSIGHTS_WARM_MS) return true;
  return false;
}
