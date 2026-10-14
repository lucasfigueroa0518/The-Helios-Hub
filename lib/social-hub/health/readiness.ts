import type { HubQuery } from '@/lib/social-hub/db';
import type { Vertical } from '@/lib/social-hub/types';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

export type Readiness = { vertical: Vertical; approved: number; rejected: number; rate: number | null };

/** Approved-as-is rate over 30 days: a person's approve ÷ (approve + reject). Rejection rate = 1 − rate. */
export async function readinessFor(q: HubQuery, now: Date): Promise<Readiness[]> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { rows } = await q<{ vertical: Vertical; approved: number; rejected: number }>(
    `SELECT ci.vertical,
            count(*) FILTER (WHERE a.decision = 'approved' AND a.via = 'user')::int AS approved,
            count(*) FILTER (WHERE a.decision = 'rejected')::int AS rejected
       FROM social_hub.approvals a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
      WHERE a.decided_at >= $1 GROUP BY ci.vertical`,
    [since],
  );
  return VERTICAL_IDS.map((vertical) => {
    const r = rows.find((x) => x.vertical === vertical) ?? { approved: 0, rejected: 0 };
    const total = r.approved + r.rejected;
    return { vertical, approved: r.approved, rejected: r.rejected, rate: total ? r.approved / total : null };
  });
}
