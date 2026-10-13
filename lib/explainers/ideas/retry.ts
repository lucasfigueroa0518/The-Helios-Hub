import type { Queryable } from '@/lib/explainers/db';

/** A day's 2 AM idea cycle may run twice: the first try and one retry after a failure. */
export const MAX_CYCLE_ATTEMPTS = 2;
/** The retry waits this long after the failure, so a persistent outage cannot spin (the worker polls every 15 s). */
export const CYCLE_RETRY_DELAY_MS = 10 * 60_000;

export type RetryGate = { run: true } | { run: false; reason: 'retry_wait' | 'retry_exhausted' | 'render_already_requested' };

const NY_TZ = 'America/New_York';

/**
 * Whether the day may start another idea cycle. Only a `failed` row on the
 * day matters (the unique index covers running/ok rows, so a failed row never
 * blocks a new one). Counted from the table itself, so a worker restart cannot
 * reset it: at most MAX_CYCLE_ATTEMPTS rows a day, the next try no sooner than
 * CYCLE_RETRY_DELAY_MS after the last failure, and never once the failed night
 * already has an auto render requested. Failed rows stay as history. Needs no
 * schema change.
 */
export async function cycleRetryGate(db: Queryable, day: string, now: Date = new Date()): Promise<RetryGate> {
  const { rows } = await db.query<{ failed: unknown; live: unknown; last_end: Date | string | null; auto_jobs: unknown }>(
    `SELECT (SELECT count(*) FROM explainers.idea_cycles WHERE ny_date = $1::date AND status = 'failed') AS failed,
            (SELECT count(*) FROM explainers.idea_cycles WHERE ny_date = $1::date AND status <> 'failed') AS live,
            (SELECT max(COALESCE(finished_at, started_at)) FROM explainers.idea_cycles
              WHERE ny_date = $1::date AND status = 'failed') AS last_end,
            (SELECT count(*) FROM explainers.jobs
              WHERE trigger = 'auto' AND (requested_at AT TIME ZONE '${NY_TZ}')::date = $1::date) AS auto_jobs`,
    [day],
  );
  const attempts = Number(rows[0]?.failed ?? 0);
  // Nothing failed, or the day already has a running/ok cycle (the unique index turns that into already_ran_today).
  if (attempts === 0 || Number(rows[0]?.live ?? 0) > 0) return { run: true };
  if (attempts >= MAX_CYCLE_ATTEMPTS) return { run: false, reason: 'retry_exhausted' };
  if (Number(rows[0]?.auto_jobs ?? 0) > 0) return { run: false, reason: 'render_already_requested' };
  const lastEnd = rows[0]?.last_end ? new Date(rows[0].last_end) : null;
  if (lastEnd && now.getTime() - lastEnd.getTime() < CYCLE_RETRY_DELAY_MS) return { run: false, reason: 'retry_wait' };
  return { run: true };
}

/**
 * The worker's side: after a try that failed (or threw), when may it try
 * again? null means done for the day. `attemptsToday` counts tries the worker
 * itself made, which also bounds a failure that never reaches the table.
 */
export function nextCycleTry(
  outcome: { status: string; reason?: string } | 'threw',
  attemptsToday: number,
  nowMs: number,
): number | null {
  const retryable = outcome === 'threw' || outcome.status === 'failed' || outcome.reason === 'retry_wait';
  if (!retryable) return null;
  if (outcome !== 'threw' && outcome.reason === 'retry_wait') return nowMs + CYCLE_RETRY_DELAY_MS;
  if (attemptsToday >= MAX_CYCLE_ATTEMPTS) return null;
  return nowMs + CYCLE_RETRY_DELAY_MS;
}
