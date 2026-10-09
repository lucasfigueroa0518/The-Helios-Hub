import type { HubQuery } from '@/lib/social-hub/db';

/**
 * Refresh-on-visit (SH-23): opening a hub page when the last refresh is
 * older than 30 minutes queues one row in social_hub.refreshes. Only the
 * social worker pulls from Meta (Vercel runs no workers); one queued and one
 * running at most (unique indexes), so repeated visits add nothing.
 */
export const REFRESH_STALE_MS = 30 * 60_000;

export type RefreshState = { available: boolean; lastRefresh: string | null; pending: boolean };

export async function refreshState(q: HubQuery): Promise<RefreshState> {
  const exists = await q<{ ok: boolean }>(`SELECT to_regclass('social_hub.refreshes') IS NOT NULL AS ok`);
  if (!exists.rows[0]?.ok) return { available: false, lastRefresh: null, pending: false };
  const { rows } = await q<{ last: string | null; pending: boolean }>(
    `SELECT (SELECT max(finished_at)::text FROM social_hub.refreshes WHERE status IN ('ok', 'partial')) AS last,
            EXISTS (SELECT 1 FROM social_hub.refreshes WHERE status IN ('requested', 'running')) AS pending`,
  );
  return { available: true, lastRefresh: rows[0]?.last ?? null, pending: Boolean(rows[0]?.pending) };
}

export async function queueRefreshIfStale(q: HubQuery, by: string, now = new Date()): Promise<RefreshState> {
  const state = await refreshState(q);
  if (!state.available || state.pending) return state;
  if (state.lastRefresh && now.getTime() - Date.parse(state.lastRefresh) < REFRESH_STALE_MS) return state;
  await q(
    `INSERT INTO social_hub.refreshes (trigger, requested_by) VALUES ('visit', $1) ON CONFLICT DO NOTHING`,
    [by],
  );
  return { ...state, pending: true };
}

/** Newest quota snapshot from the last 24 h, as the hub sweep read it (OUT_OF_SCOPE #4). */
export async function latestQuotaSnapshot(q: HubQuery, now = new Date()): Promise<{ text: string; at: string } | null> {
  const exists = await q<{ ok: boolean }>(`SELECT to_regclass('social_hub.publishing_quota') IS NOT NULL AS ok`);
  if (!exists.rows[0]?.ok) return null;
  const { rows } = await q<{ usage: number; total: number | null; at: string }>(
    `SELECT quota_usage AS usage, quota_total AS total, captured_at::text AS at FROM social_hub.publishing_quota
      WHERE captured_at > $1::timestamptz ORDER BY captured_at DESC LIMIT 1`,
    [new Date(now.getTime() - 86_400_000).toISOString()],
  );
  const row = rows[0];
  if (!row || row.total == null) return null;
  // Same wording the publishers use, so one parser reads both sources.
  return { text: `The Instagram account has ${Number(row.total) - Number(row.usage)} of ${Number(row.total)} posts left`, at: row.at };
}
