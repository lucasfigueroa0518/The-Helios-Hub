import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type ReportContext, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { cycleBounds } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

type Cycle = { id: string; status: string; error: string | null; generated: number; pool: number; at: string };
type Job = { id: string; status: string; stage: string | null; error: string | null; capped: boolean; spend: number; at: string };

/**
 * `q` here reads the Explainers database; `hubQ` reads social_hub (publishing).
 * They are the same handle in tests and when Explainers share Supabase.
 */
export function makeExplainersReporter(hubQ?: HubQuery) {
  return async (q: HubQuery, { night, posting }: ReportContext) => {
    const { start, end } = cycleBounds(night);
    const range = [start.toISOString(), end.toISOString()];
    const cycles = (await q<Cycle>(
      `SELECT id::text, status, error, ideas_generated AS generated, ideas_entering_pool AS pool, started_at::text AS at
         FROM explainers.idea_cycles WHERE ny_date = $1::date AND mode = 'production'`,
      [night],
    )).rows;
    const jobs = (await q<Job>(
      `SELECT id::text, status, stage, error, capped, spend_usd::float8 AS spend, COALESCE(finished_at, requested_at)::text AS at
         FROM explainers.jobs WHERE mode = 'production' AND requested_at >= $1 AND requested_at < $2`,
      range,
    )).rows;
    const cost = (await q<{ usd: number; unknown: number }>(
      `SELECT COALESCE(sum(usd) FILTER (WHERE usd_known), 0)::float8 AS usd, count(*) FILTER (WHERE NOT usd_known)::int AS unknown
         FROM explainers.cost_events WHERE mode = 'production' AND created_at >= $1 AND created_at < $2`,
      range,
    )).rows[0] ?? { usd: 0, unknown: 0 };

    const failures: FailureEvent[] = [];
    for (const c of cycles.filter((x) => x.status === 'failed')) {
      failures.push({ vertical: 'explainers', night, at: new Date(c.at).toISOString(), stage: 'ideas', reason: reasonFor('ideas', c.error), severity: 'failed', rawError: c.error ?? undefined });
    }
    for (const j of jobs.filter((x) => x.status === 'failed' || x.capped)) {
      failures.push({
        vertical: 'explainers', night, at: new Date(j.at).toISOString(), stage: j.stage ?? 'render', reason: j.capped ? 'cap_hit' : reasonFor(j.stage ?? 'render', j.error),
        severity: 'failed', rawError: j.error ?? undefined, spentUsd: j.spend, item: { kind: 'job', id: j.id, label: `Render ${j.id.slice(0, 8)}` },
      });
    }
    const made = jobs.filter((j) => j.status === 'ok').length;
    const generated = cycles.reduce((n, c) => n + c.generated, 0);
    const pool = cycles.reduce((n, c) => n + c.pool, 0);
    const base = {
      ...emptyReport('explainers', night),
      ran: cycles.length > 0 || jobs.length > 0,
      made,
      funnel: funnelFrom(generated, [['ideas', generated - pool], ['render', Math.max(0, pool - made)]]),
      failures,
      spendUsd: cost.usd,
      unknownCostCalls: cost.unknown,
    };
    return withPublishing(base, posting, await publishingFor(hubQ ?? q, 'explainers', night));
  };
}

export const reportExplainers: Reporter = (q, ctx) => makeExplainersReporter()(q, ctx);
