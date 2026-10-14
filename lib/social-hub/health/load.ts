import { liveHubQuery } from '@/lib/social-hub/db';
import { readinessFor, type Readiness } from '@/lib/social-hub/health/readiness';
import { readReports } from '@/lib/social-hub/health/store';
import { historyNights, nightsEnding, reportNightFor } from '@/lib/social-hub/health/time';
import type { StoredReport } from '@/lib/social-hub/health/types';

/**
 * Never throws (like loadForPage). Stored reports for the window and the readiness rates.
 *
 * `live` is always null here: a live rebuild needs `readPosting`, whose module (and the
 * settings modules it reads through) also write, and hub read code may never reach a
 * foreign write (tests/social-hub-scope.test.ts). The 07:30 job stores each night instead.
 */
export async function loadHealthPage(now: Date, windowNights: 14 | 30): Promise<{ stored: StoredReport[]; live: StoredReport | null; readiness: Readiness[] } | { error: string }> {
  try {
    const night = reportNightFor(now);
    // Load the month and streak history, not just the visible window; healthModel
    // slices rows and problems back down to `windowNights`.
    const window = nightsEnding(night, Math.max(windowNights, historyNights(night)));
    const [stored, readiness] = await Promise.all([readReports(liveHubQuery, window[0]!, night), readinessFor(liveHubQuery, now)]);
    return { stored, live: null, readiness };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
