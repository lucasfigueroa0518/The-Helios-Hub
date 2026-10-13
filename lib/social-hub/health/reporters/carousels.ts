import type { HubQuery } from '@/lib/social-hub/db';
import { carouselReason, reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { cycleBounds } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

const STAGE_ORDER = ['jev-scoring', 'reporter', 'writer', 'editor', 'fact-checker', 'mechanical', 'design'];

type RunRow = { id: string; status: string; stop_reason: string | null; error: string | null; total_usd: number; cap_usd: number; posts: number; at: string };
type SetAside = { story_id: string; stage: string; reason_code: string; kind: string; detail: string; at: string };

export const reportCarousels: Reporter = async (q: HubQuery, { night, posting }) => {
  const { start, end } = cycleBounds(night);
  const range = [start.toISOString(), end.toISOString()];
  const runs = (await q<RunRow>(
    `SELECT id::text, status, stop_reason, error, total_usd::float8 AS total_usd, cap_usd::float8 AS cap_usd,
            CASE WHEN jsonb_typeof(record->'result'->'posts') = 'array' THEN jsonb_array_length(record->'result'->'posts') ELSE 0 END AS posts,
            COALESCE(started_at, requested_at)::text AS at
       FROM social.runs
      WHERE kind = 'daily' AND trigger = 'scheduled'
        AND COALESCE(started_at, requested_at) >= $1 AND COALESCE(started_at, requested_at) < $2
      ORDER BY requested_at`,
    range,
  )).rows;
  const asides = (await q<SetAside>(
    `SELECT story_id, stage, reason_code, kind, detail, at::text FROM social.set_asides WHERE at >= $1 AND at < $2`,
    range,
  )).rows;
  const stale = (await q<{ name: string }>(
    `SELECT name FROM social.feed_health WHERE day > $1::date - 3 AND day <= $1::date
      GROUP BY slug, name HAVING max(in_window) = 0 AND count(*) >= 3 ORDER BY name`,
    [night],
  )).rows.map((r) => r.name);

  const failures: FailureEvent[] = [];
  for (const run of runs) {
    if (run.status === 'failed' || run.stop_reason === 'cost-cap') {
      const reason = run.stop_reason === 'cost-cap' ? 'cap_hit' : reasonFor('run', run.error ?? run.stop_reason);
      failures.push({ vertical: 'carousels', night, at: new Date(run.at).toISOString(), stage: 'run', reason, severity: 'failed', rawError: run.error ?? run.stop_reason ?? undefined, runId: run.id, spentUsd: run.total_usd });
    }
  }
  for (const a of asides.filter((x) => x.kind === 'pipeline-fault')) {
    failures.push({
      vertical: 'carousels', night, at: new Date(a.at).toISOString(), stage: a.stage, reason: carouselReason(a.reason_code), severity: 'failed',
      rawError: a.detail, item: { kind: 'story', id: a.story_id, label: a.story_id },
    });
  }
  const made = runs.filter((r) => r.status === 'ok' || r.status === 'partial').reduce((n, r) => n + r.posts, 0);
  const drops = STAGE_ORDER.map((stage) => [stage, asides.filter((a) => a.stage === stage).length] as [string, number]).filter(([, n]) => n > 0);
  const base = {
    ...emptyReport('carousels', night),
    ran: runs.some((r) => ['ok', 'partial', 'failed', 'skipped'].includes(r.status)),
    made,
    funnel: funnelFrom(made + asides.length, drops),
    failures,
    spendUsd: runs.reduce((n, r) => n + r.total_usd, 0),
    feedsStale: stale,
    nearCap: runs.some((r) => r.cap_usd > 0 && r.total_usd >= 0.9 * r.cap_usd),
  };
  return withPublishing(base, posting, await publishingFor(q, 'carousels', night));
};
