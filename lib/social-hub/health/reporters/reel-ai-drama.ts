import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type ReportContext } from '@/lib/social-hub/health/reporters/shared';
import { cycleBounds } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';
import { readDramaNightHealth } from '@/lib/reel-ai-drama/hub-read';

/**
 * AI Drama Reels' night, the Explainers reporter's shape: the 12:00 AM fill
 * (reel_ai_drama.nights) stands in for the idea cycle, the jobs it and people
 * requested are the renders, and a person's queued develop / calibrate click
 * that failed is a failure too. `q` reads the drama schema (the explainers
 * handle); `hubQ` reads social_hub (publishing). They are the same handle in
 * tests and when Explainers share Supabase.
 */
export function makeReelAiDramaReporter(hubQ?: HubQuery) {
  return async (q: HubQuery, { night, posting }: ReportContext) => {
    const { start, end } = cycleBounds(night);
    const health = await readDramaNightHealth(q, { nyDate: night, start: start.toISOString(), end: end.toISOString() });

    const failures: FailureEvent[] = [];
    for (const n of health.nights.filter((x) => x.status === 'failed')) {
      failures.push({ vertical: 'reel_ai_drama', night, at: new Date(n.at).toISOString(), stage: 'ideas', reason: reasonFor('ideas', n.error), severity: 'failed', rawError: n.error ?? undefined });
    }
    for (const j of health.jobs.filter((x) => x.status === 'failed' || x.capped)) {
      failures.push({
        vertical: 'reel_ai_drama', night, at: new Date(j.at).toISOString(), stage: j.stage ?? 'render', reason: j.capped ? 'cap_hit' : reasonFor(j.stage ?? 'render', j.error),
        severity: 'failed', rawError: j.error ?? undefined, spentUsd: j.spend, item: { kind: 'job', id: j.id, label: `Reel ${j.id.slice(0, 8)}` },
      });
    }
    for (const r of health.requests.filter((x) => x.status === 'failed')) {
      failures.push({ vertical: 'reel_ai_drama', night, at: new Date(r.at).toISOString(), stage: r.kind === 'develop' ? 'ideas' : 'calibration', reason: reasonFor('ideas', r.error), severity: 'warning', rawError: r.error ?? undefined });
    }
    const made = health.jobs.filter((j) => j.status === 'ok').length;
    const requested = health.nights.reduce((n, x) => n + x.requested, 0) || health.jobs.length;
    const base = {
      ...emptyReport('reel_ai_drama', night),
      ran: health.nights.length > 0 || health.jobs.length > 0,
      made,
      funnel: funnelFrom(requested, [['render', Math.max(0, requested - made)]]),
      failures,
      spendUsd: health.cost.usd,
      unknownCostCalls: health.cost.unknown,
    };
    return withPublishing(base, posting, await publishingFor(hubQ ?? q, 'reel_ai_drama', night));
  };
}
