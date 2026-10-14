import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { cycleBounds } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

type RunRow = { id: string; status: string; stop_reason: string | null; error: string | null; total_usd: number; cap_usd: number; at: string };

/** Last Few Days' night: its scheduled 3:00 runs (spec §7.3). A manual run is a person's, not the night's. */
export const reportLastFewDays: Reporter = async (q: HubQuery, { night, posting }) => {
  const { start, end } = cycleBounds(night);
  const runs = (await q<RunRow>(
    `SELECT id::text, status, stop_reason, error, total_usd::float8 AS total_usd, cap_usd::float8 AS cap_usd,
            COALESCE(started_at, requested_at)::text AS at
       FROM lfd.runs
      WHERE trigger = 'scheduled'
        AND COALESCE(started_at, requested_at) >= $1 AND COALESCE(started_at, requested_at) < $2
      ORDER BY requested_at`,
    [start.toISOString(), end.toISOString()],
  )).rows;
  const failures: FailureEvent[] = [];
  for (const run of runs) {
    const at = new Date(run.at).toISOString();
    if (run.status === 'failed') {
      failures.push({ vertical: 'last_few_days', night, at, stage: 'run', reason: reasonFor('run', run.error ?? run.stop_reason), severity: 'failed', rawError: run.error ?? run.stop_reason ?? undefined, runId: run.id, spentUsd: run.total_usd });
    } else if (run.status === 'partial') {
      // A short post (fewer than 5 stories) still posts; it is worth a look.
      failures.push({ vertical: 'last_few_days', night, at, stage: 'run', reason: reasonFor('run', run.stop_reason), severity: 'warning', rawError: run.stop_reason ?? undefined, runId: run.id, spentUsd: run.total_usd });
    }
  }
  const made = runs.filter((r) => r.status === 'ok' || r.status === 'partial').length;
  const base = {
    ...emptyReport('last_few_days', night),
    ran: runs.some((r) => ['ok', 'partial', 'failed', 'skipped'].includes(r.status)),
    made,
    funnel: funnelFrom(runs.length, [['run', runs.filter((r) => r.status === 'failed').length]]),
    failures,
    spendUsd: runs.reduce((n, r) => n + r.total_usd, 0),
    nearCap: runs.some((r) => r.cap_usd > 0 && r.total_usd >= 0.9 * r.cap_usd),
  };
  return withPublishing(base, posting, await publishingFor(q, 'last_few_days', night));
};
