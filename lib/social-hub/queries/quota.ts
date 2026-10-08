import type { HubQuery } from '@/lib/social-hub/db';

/**
 * The account's 24 h quota as the publishers last saw it (SELECT only).
 * Publishers write the quota only into an error when they refuse to post,
 * so this is the newest such message, if any (OUT_OF_SCOPE #4).
 */
export type QuotaRow = { text: string | null; at: string | null };

const FEED_SQL = (table: string) => `
SELECT error AS text, COALESCE(finished_at, requested_at)::text AS at
  FROM ${table}
 WHERE error ILIKE '%24-hour quota%'
 ORDER BY COALESCE(finished_at, requested_at) DESC
 LIMIT 1`;

const STORIES_SQL = `
SELECT error AS text, updated_at::text AS at
  FROM stories.sets
 WHERE error ILIKE 'publishing quota%'
 ORDER BY updated_at DESC
 LIMIT 1`;

export async function readLatestQuota(q: HubQuery, explainersQ: Promise<HubQuery>): Promise<QuotaRow | null> {
  const reads = await Promise.all([
    q<QuotaRow>(FEED_SQL('reels.publish_attempts')).catch(() => ({ rows: [] as QuotaRow[] })),
    // Carousels and every type that has joined the lifecycle spine (D36).
    q<QuotaRow>(FEED_SQL('social_hub.publish_attempts')).catch(() => ({ rows: [] as QuotaRow[] })),
    q<QuotaRow>(STORIES_SQL).catch(() => ({ rows: [] as QuotaRow[] })),
    explainersQ.then((eq) => eq<QuotaRow>(FEED_SQL('explainers.publish_attempts'))).catch(() => ({ rows: [] as QuotaRow[] })),
  ]);
  const rows = reads.flatMap((r) => r.rows).filter((r) => r.at);
  rows.sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!));
  return rows[0] ?? null;
}
