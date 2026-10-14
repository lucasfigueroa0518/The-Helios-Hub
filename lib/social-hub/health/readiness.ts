import type { HubQuery } from '@/lib/social-hub/db';
import type { Vertical } from '@/lib/social-hub/types';
import { VERTICAL_IDS, verticalInfo } from '@/lib/social-hub/verticals';

type Window = { approved: number; rejected: number; rate: number | null };
export type Readiness = { vertical: Vertical; approved: number; rejected: number; rate: number | null; previous?: Window };

/** The approved-as-is rate a type has to hold before it could post without review. Shown on the readiness hover only. */
export const AUTO_PUBLISH_BAR = 0.95;

const DAY_MS = 86_400_000;
const rateOf = (approved: number, rejected: number) => (approved + rejected ? approved / (approved + rejected) : null);

/**
 * Approved-as-is rate over 30 days: a person's approve ÷ (approve + reject). Rejection rate = 1 − rate.
 * `previous` is the 30 days before that, for the trend on the hover card.
 */
export async function readinessFor(q: HubQuery, now: Date): Promise<Readiness[]> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const before = new Date(now.getTime() - 60 * DAY_MS).toISOString();
  const { rows } = await q<{ vertical: Vertical; approved: number; rejected: number; prev_approved: number; prev_rejected: number }>(
    `SELECT ci.vertical,
            count(*) FILTER (WHERE a.decided_at >= $1 AND a.decision = 'approved' AND a.via = 'user')::int AS approved,
            count(*) FILTER (WHERE a.decided_at >= $1 AND a.decision = 'rejected')::int AS rejected,
            count(*) FILTER (WHERE a.decided_at < $1 AND a.decision = 'approved' AND a.via = 'user')::int AS prev_approved,
            count(*) FILTER (WHERE a.decided_at < $1 AND a.decision = 'rejected')::int AS prev_rejected
       FROM social_hub.approvals a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
      WHERE a.decided_at >= $2 GROUP BY ci.vertical`,
    [since, before],
  );
  return VERTICAL_IDS.map((vertical) => {
    const r = rows.find((x) => x.vertical === vertical) ?? { approved: 0, rejected: 0, prev_approved: 0, prev_rejected: 0 };
    return {
      vertical,
      approved: r.approved,
      rejected: r.rejected,
      rate: rateOf(r.approved, r.rejected),
      previous: { approved: r.prev_approved, rejected: r.prev_rejected, rate: rateOf(r.prev_approved, r.prev_rejected) },
    };
  });
}

export type ReadinessCard = { title: string; rate: string; lines: Array<[string, string]>; note: string; meets: boolean };

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

/** The hover card for one readiness ring. Templated from the counts; no model involved. */
export function readinessCard(r: Readiness): ReadinessCard {
  const rate = r.rate ?? 0;
  const prev = r.previous?.rate ?? null;
  let trend = 'No decisions';
  if (prev !== null) {
    const diff = Math.round(rate * 100) - Math.round(prev * 100);
    trend = diff === 0 ? `${pct(prev)} · no change` : `${pct(prev)} ${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} pts`;
  }
  const meets = rate >= AUTO_PUBLISH_BAR;
  const gap = Math.round(AUTO_PUBLISH_BAR * 100) - Math.round(rate * 100);
  return {
    title: `${verticalInfo(r.vertical).label} · last 30 days`,
    rate: pct(rate),
    lines: [['Approved as-is', String(r.approved)], ['Rejected', String(r.rejected)], ['Previous 30 days', trend]],
    note: meets
      ? `At or above the ${pct(AUTO_PUBLISH_BAR)} auto-publish bar`
      : gap > 0 ? `${gap} pts below the ${pct(AUTO_PUBLISH_BAR)} auto-publish bar` : `Just under the ${pct(AUTO_PUBLISH_BAR)} auto-publish bar`,
    meets,
  };
}
