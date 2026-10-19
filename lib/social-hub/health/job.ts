import { buildNight, publisherTone, type Handles } from '@/lib/social-hub/health/night';
import { saveReport, storedNights } from '@/lib/social-hub/health/store';
import { nightsEnding, reportNightFor } from '@/lib/social-hub/health/time';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * The 07:30 morning report (spec §4.3). It replaces tonight's row, then fills
 * any missing night in the last `backfill` from the source tables. This is a
 * read-only report, not an enrichment sweep. Backfilled nights have no
 * heartbeat, so their publisher tone is 'none'.
 */
export async function runMorningReport(handles: Handles, now: Date, backfill = 30): Promise<{ night: string; backfilled: number }> {
  const h = { ...handles, posting: oncePerRun(handles.posting) };
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

/**
 * A type's posting state doesn't depend on the night, so one run reads it
 * once per type (its calendar read covers every night the run builds). A
 * failed read isn't kept, so the next night tries again.
 */
function oncePerRun(read: Handles['posting']): Handles['posting'] {
  const seen = new Map<Vertical, ReturnType<Handles['posting']>>();
  return (v) => {
    let p = seen.get(v);
    if (!p) {
      p = read(v);
      seen.set(v, p);
      p.catch(() => seen.delete(v));
    }
    return p;
  };
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
