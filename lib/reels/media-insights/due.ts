/** The due/settle rules are the shared ones (lib/instagram/insights-rules.ts). */
export { INSIGHTS_COOLDOWN_MS, INSIGHTS_FRESH_MS, INSIGHTS_WARM_MS, insightIsDue } from '@/lib/instagram/insights-rules';

/** A refresh that never finished does not block the next one forever. */
export const INSIGHTS_STALE_LOCK_MS = 10 * 60_000;

/** Trial Reels page open. Enough for the reels posted since the previous open. */
export const INSIGHTS_PAGE_BATCH = 24;

/** The Refresh button. Larger than a page open, still bounded. */
export const INSIGHTS_REFRESH_BATCH = 80;

/** Nightly drain. A few months of daily posts fit in one pass. */
export const INSIGHTS_NIGHTLY_BATCH = 200;
