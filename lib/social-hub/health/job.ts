import { buildNight, publisherTone, type Handles } from '@/lib/social-hub/health/night';
import { saveReport, storedNights } from '@/lib/social-hub/health/store';
import { nightsEnding, reportNightFor } from '@/lib/social-hub/health/time';

/**
 * The 07:30 morning report (spec §4.3). It replaces tonight's row, then fills
 * any missing night in the last `backfill` from the source tables. This is a
 * read-only report, not an enrichment sweep. Backfilled nights have no
 * heartbeat, so their publisher tone is 'none'.
 */
export async function runMorningReport(h: Handles, now: Date, backfill = 30): Promise<{ night: string; backfilled: number }> {
  const night = reportNightFor(now);
  await saveReport(h.q, await buildNight(h, night, now, await publisherTone(h.q, now)), 'replace');
  const window = nightsEnding(night, backfill).slice(0, -1);
  const have = await storedNights(h.q, window[0] ?? night, night);
  let backfilled = 0;
  for (const n of window) {
    if (have.has(n)) continue;
    await saveReport(h.q, await buildNight(h, n, now, 'none'), 'missing-only');
    backfilled++;
  }
  return { night, backfilled };
}

/** The worker's cap on one morning report, so a hung query can't stall its loop. */
export const MORNING_REPORT_TIMEOUT_MS = 10 * 60_000;

/**
 * Rejects with a timeout error when `work` hasn't settled in `ms`. The work
 * itself is not cancelled (a stuck query finishes or fails on its own); the
 * caller just stops waiting for it.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
