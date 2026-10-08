import type { HubQuery } from '@/lib/social-hub/db';

/**
 * Account-level reads from the hub's own schema (SELECT only). The tables
 * are written but not applied in Phase 1, so the first question is whether
 * they exist; when they don't, the Profile tab says "No account data yet".
 */

export type AccountDayRow = {
  ny_date: string;
  reach: number | null;
  reach_followers: number | null;
  reach_non_followers: number | null;
  views: number | null;
  accounts_engaged: number | null;
  total_interactions: number | null;
  profile_links_taps: number | null;
  follows: number | null;
  unfollows: number | null;
  follower_count: number | null;
};

export type DemographicRow = { ny_date: string; metric: string; timeframe: string; breakdown: string; key: string; value: number };
export type OnlineRow = { ny_date: string; hour: number; value: number };

export type AccountRead =
  | { present: false; error?: string }
  | { present: true; days: AccountDayRow[]; demographics: DemographicRow[]; online: OnlineRow[]; lastRefresh: string | null };

export const ACCOUNT_SQL = {
  exists: `SELECT to_regclass('social_hub.account_insights_daily') IS NOT NULL AS ok`,
  days: `SELECT ny_date::text AS ny_date, reach, reach_followers, reach_non_followers, views, accounts_engaged,
                total_interactions, profile_links_taps, follows, unfollows, follower_count
           FROM social_hub.account_insights_daily ORDER BY ny_date`,
  demographics: `SELECT d.ny_date::text AS ny_date, d.metric, d.timeframe, d.breakdown, d.key, d.value
                   FROM social_hub.account_demographics_daily d
                   JOIN (SELECT metric, breakdown, max(ny_date) AS ny_date
                           FROM social_hub.account_demographics_daily GROUP BY metric, breakdown) last
                     ON last.metric = d.metric AND last.breakdown = d.breakdown AND last.ny_date = d.ny_date
                  ORDER BY d.metric, d.breakdown, d.value DESC`,
  online: `SELECT ny_date::text AS ny_date, hour, value FROM social_hub.online_followers_daily
            WHERE ny_date >= (SELECT max(ny_date) FROM social_hub.online_followers_daily) - 29
            ORDER BY ny_date, hour`,
  lastRefresh: `SELECT max(finished_at)::text AS at FROM social_hub.refreshes WHERE status IN ('ok', 'partial')`,
} as const;

export async function readAccount(q: HubQuery): Promise<AccountRead> {
  const exists = await q<{ ok: boolean }>(ACCOUNT_SQL.exists);
  if (!exists.rows[0]?.ok) return { present: false };
  const [days, demographics, online, refresh] = await Promise.all([
    q<AccountDayRow>(ACCOUNT_SQL.days),
    q<DemographicRow>(ACCOUNT_SQL.demographics),
    q<OnlineRow>(ACCOUNT_SQL.online),
    q<{ at: string | null }>(ACCOUNT_SQL.lastRefresh),
  ]);
  return { present: true, days: days.rows, demographics: demographics.rows, online: online.rows, lastRefresh: refresh.rows[0]?.at ?? null };
}
