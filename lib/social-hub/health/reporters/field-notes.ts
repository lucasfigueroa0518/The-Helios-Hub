import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { cycleBounds } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

type RunRow = { id: string; status: string; stop_reason: string | null; error: string | null; total_usd: number; cap_usd: number; at: string };

/**
 * Field Notes' night. Its 12:00 PM run and its 2:30–3:30 PM post both fall in the next
 * night's cycle (night N runs 08:00 on N−1 to 07:30 on N), so that night reports them: the
 * scheduled builds in the cycle, and the slot as "yesterday" (publishingFor reads N−1).
 * quotaFor maps the same way (the AI Events shape). A manual Generate or Rebuild post is a
 * person's, not the night's. A scheduled run skipped because a post already waits (a person
 * made it, or the cap on pending drafts) counts as made; one skipped for want of a tip or a
 * photo is a warning, not a fault.
 */
export const reportFieldNotes: Reporter = async (q: HubQuery, { night, posting }) => {
  const { start, end } = cycleBounds(night);
  const runs = (await q<RunRow>(
    `SELECT id::text, status, stop_reason, error, total_usd::float8 AS total_usd, cap_usd::float8 AS cap_usd,
            COALESCE(started_at, requested_at)::text AS at
       FROM field_notes.runs
      WHERE trigger = 'scheduled' AND kind = 'build'
        AND COALESCE(started_at, requested_at) >= $1 AND COALESCE(started_at, requested_at) < $2
      ORDER BY requested_at`,
    [start.toISOString(), end.toISOString()],
  )).rows;
  const failures: FailureEvent[] = [];
  const postExists = (r: RunRow) => r.status === 'skipped' && /^(post-exists|draft-cap|pending)/.test(r.stop_reason ?? '');
  for (const run of runs) {
    const at = new Date(run.at).toISOString();
    if (run.status === 'failed') {
      failures.push({ vertical: 'field_notes', night, at, stage: 'run', reason: reasonFor('run', run.error ?? run.stop_reason), severity: 'failed', rawError: run.error ?? run.stop_reason ?? undefined, runId: run.id, spentUsd: run.total_usd });
    } else if (run.status === 'skipped' && !postExists(run)) {
      // No tip or no usable photo: no post today. Worth a look, not a fault.
      failures.push({ vertical: 'field_notes', night, at, stage: 'run', reason: 'no_tip', severity: 'warning', rawError: run.stop_reason ?? undefined, runId: run.id, spentUsd: run.total_usd });
    } else if (run.status === 'partial') {
      failures.push({ vertical: 'field_notes', night, at, stage: 'run', reason: reasonFor('run', run.stop_reason), severity: 'warning', rawError: run.stop_reason ?? undefined, runId: run.id, spentUsd: run.total_usd });
    }
  }
  const made = runs.filter((r) => r.status === 'ok' || r.status === 'partial' || postExists(r)).length;
  const base = {
    ...emptyReport('field_notes', night),
    ran: runs.some((r) => ['ok', 'partial', 'failed', 'skipped'].includes(r.status)),
    made,
    funnel: funnelFrom(runs.length, [['run', runs.filter((r) => r.status === 'failed').length]]),
    failures,
    spendUsd: runs.reduce((n, r) => n + r.total_usd, 0),
    nearCap: runs.some((r) => r.cap_usd > 0 && r.total_usd >= 0.9 * r.cap_usd),
  };
  return withPublishing(base, posting, await publishingFor(q, 'field_notes', night));
};
