import { calendarDateKey } from './clock';
import { fetchAccountDay, fetchDemographics, fetchOnlineFollowers, type AccountDay } from './account-insights';
import type { GraphCall, PublishingLimit } from './graph';

/**
 * The Social Hub sweep (PRODUCT_SPEC §8): account insights for the last
 * three New York days (Meta can lag 48 h, so recent days are re-read and
 * overwritten), this month's demographics, yesterday's online followers, and
 * the account's 24 h publishing quota. Writes only the `social_hub` schema.
 */

export type HubQueryFn = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type SweepDeps = {
  query: HubQueryFn;
  call: GraphCall;
  igUserId: string;
  publishingLimit: () => Promise<PublishingLimit>;
  now?: Date;
};

export type SweepStats = { days: number; demographics: number; onlineHours: number; quota: boolean; errors: string[] };

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

async function upsertDay(query: HubQueryFn, day: AccountDay): Promise<void> {
  await query(
    `INSERT INTO social_hub.account_insights_daily
       (ny_date, captured_at, reach, reach_followers, reach_non_followers, views, accounts_engaged, total_interactions,
        likes, comments, saves, shares, replies, reposts, profile_links_taps, follows, unfollows, follower_count, raw)
     VALUES ($1::date, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
     ON CONFLICT (ny_date) DO UPDATE SET
       captured_at = now(),
       reach = COALESCE(EXCLUDED.reach, social_hub.account_insights_daily.reach),
       reach_followers = COALESCE(EXCLUDED.reach_followers, social_hub.account_insights_daily.reach_followers),
       reach_non_followers = COALESCE(EXCLUDED.reach_non_followers, social_hub.account_insights_daily.reach_non_followers),
       views = COALESCE(EXCLUDED.views, social_hub.account_insights_daily.views),
       accounts_engaged = COALESCE(EXCLUDED.accounts_engaged, social_hub.account_insights_daily.accounts_engaged),
       total_interactions = COALESCE(EXCLUDED.total_interactions, social_hub.account_insights_daily.total_interactions),
       likes = COALESCE(EXCLUDED.likes, social_hub.account_insights_daily.likes),
       comments = COALESCE(EXCLUDED.comments, social_hub.account_insights_daily.comments),
       saves = COALESCE(EXCLUDED.saves, social_hub.account_insights_daily.saves),
       shares = COALESCE(EXCLUDED.shares, social_hub.account_insights_daily.shares),
       replies = COALESCE(EXCLUDED.replies, social_hub.account_insights_daily.replies),
       reposts = COALESCE(EXCLUDED.reposts, social_hub.account_insights_daily.reposts),
       profile_links_taps = COALESCE(EXCLUDED.profile_links_taps, social_hub.account_insights_daily.profile_links_taps),
       follows = COALESCE(EXCLUDED.follows, social_hub.account_insights_daily.follows),
       unfollows = COALESCE(EXCLUDED.unfollows, social_hub.account_insights_daily.unfollows),
       follower_count = COALESCE(EXCLUDED.follower_count, social_hub.account_insights_daily.follower_count),
       raw = EXCLUDED.raw`,
    [day.nyDate, day.reach, day.reachFollowers, day.reachNonFollowers, day.views, day.accountsEngaged, day.totalInteractions,
      day.likes, day.comments, day.saves, day.shares, day.replies, day.reposts, day.profileLinksTaps, day.follows, day.unfollows,
      day.followerCount, JSON.stringify({ ...day.raw, errors: day.errors })],
  );
}

export async function runAccountSweep(deps: SweepDeps): Promise<SweepStats> {
  const { query, call, igUserId } = deps;
  const now = deps.now ?? new Date();
  const today = calendarDateKey(now);
  const errors: string[] = [];
  let days = 0;
  for (const day of [addDays(today, -2), addDays(today, -1), today]) {
    const reading = await fetchAccountDay(call, igUserId, day);
    errors.push(...reading.errors.map((e) => `${day} ${e}`));
    await upsertDay(query, reading);
    days += 1;
  }
  const demo = await fetchDemographics(call, igUserId);
  errors.push(...demo.errors);
  for (const row of demo.rows) {
    await query(
      `INSERT INTO social_hub.account_demographics_daily (ny_date, metric, timeframe, breakdown, key, value)
       VALUES ($1::date, $2, $3, $4, $5, $6)
       ON CONFLICT (ny_date, metric, timeframe, breakdown, key) DO UPDATE SET value = EXCLUDED.value, captured_at = now()`,
      [today, row.metric, row.timeframe, row.breakdown, row.key, row.value],
    );
  }
  const yesterday = addDays(today, -1);
  const online = await fetchOnlineFollowers(call, igUserId, yesterday);
  if (online.error) errors.push(online.error);
  for (const h of online.hours) {
    await query(
      `INSERT INTO social_hub.online_followers_daily (ny_date, hour, value) VALUES ($1::date, $2, $3)
       ON CONFLICT (ny_date, hour) DO UPDATE SET value = EXCLUDED.value, captured_at = now()`,
      [yesterday, h.hour, h.value],
    );
  }
  let quota = false;
  try {
    const limit = await deps.publishingLimit();
    await query(`INSERT INTO social_hub.publishing_quota (captured_at, quota_usage, quota_total) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [now.toISOString(), limit.quotaUsage, limit.quotaTotal]);
    quota = true;
  } catch (error) {
    errors.push(`quota: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { days, demographics: demo.rows.length, onlineHours: online.hours.length, quota, errors };
}

/** Hub refresh cooldown (SH-23): the same 30 minutes as the Trial Reels insights claim. */
export const HUB_REFRESH_COOLDOWN_MS = 30 * 60_000;

/** Claim the queued refresh, if any: requested → running (one running at a time, by index). */
export async function claimHubRefresh(query: HubQueryFn): Promise<{ id: string; trigger: string } | null> {
  const { rows } = await query(
    `UPDATE social_hub.refreshes SET status = 'running', started_at = now()
      WHERE id = (SELECT id FROM social_hub.refreshes WHERE status = 'requested' ORDER BY requested_at LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM social_hub.refreshes WHERE status = 'running')
      RETURNING id, trigger`,
  );
  return rows[0] ? { id: rows[0].id, trigger: rows[0].trigger } : null;
}

/** The overnight sweep records itself as a running refresh, so the hub knows when data last moved. */
export async function startOvernightRefresh(query: HubQueryFn): Promise<string | null> {
  const { rows } = await query(
    `INSERT INTO social_hub.refreshes (trigger, status, started_at) VALUES ('overnight', 'running', now())
     ON CONFLICT DO NOTHING RETURNING id`,
  );
  return rows[0]?.id ?? null;
}

export async function finishHubRefresh(query: HubQueryFn, id: string, stats: SweepStats | null, error: string | null): Promise<void> {
  const status = error ? 'failed' : stats && stats.errors.length ? 'partial' : 'ok';
  await query(
    `UPDATE social_hub.refreshes SET status = $2, finished_at = now(), error = $3, stats = $4::jsonb WHERE id = $1`,
    [id, status, error, JSON.stringify(stats ?? {})],
  );
}

/** A refresh left running by a crash is failed after 30 minutes so the queue moves again. */
export async function failStaleRefreshes(query: HubQueryFn): Promise<void> {
  await query(
    `UPDATE social_hub.refreshes SET status = 'failed', finished_at = now(), error = 'worker stopped before finishing'
      WHERE status = 'running' AND started_at < now() - interval '30 minutes'`,
  );
}
