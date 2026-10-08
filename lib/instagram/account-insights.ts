import { zonedTime } from './clock';
import type { GraphCall } from './graph';

/**
 * Account-level Instagram insights for the Social Hub (PRODUCT_SPEC §5.1,
 * planning/Social Hub/META_API_CHECK.md), written to the `social_hub`
 * tables. Pure over an injected Graph call; each metric group is asked on
 * its own so one rejected metric never loses the rest. Blanks stay null.
 */

export type AccountDay = {
  nyDate: string;
  reach: number | null;
  reachFollowers: number | null;
  reachNonFollowers: number | null;
  views: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  replies: number | null;
  reposts: number | null;
  profileLinksTaps: number | null;
  follows: number | null;
  unfollows: number | null;
  followerCount: number | null;
  raw: Record<string, unknown>;
  errors: string[];
};

type TotalValue = { value?: number; breakdowns?: Array<{ dimension_keys?: string[]; results?: Array<{ dimension_values?: string[]; value?: number }> }> };
type InsightsBody = { data?: Array<{ name?: string; total_value?: TotalValue; values?: Array<{ value?: unknown; end_time?: string }> }> };

const TOTAL_METRICS = [
  'reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'saves', 'shares', 'replies', 'reposts', 'profile_links_taps',
] as const;

/** Unix seconds bounding a New York day. */
export function dayBounds(nyDate: string): { since: string; until: string } {
  const [y, m, d] = nyDate.split('-').map(Number);
  const start = zonedTime(y!, m!, d!, 0, 0);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  const end = zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0);
  return { since: String(Math.floor(start.getTime() / 1000)), until: String(Math.floor(end.getTime() / 1000)) };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** total_value per metric name, plus per-dimension values when a breakdown was asked. */
export function readTotals(body: InsightsBody): Map<string, { value: number | null; byDimension: Map<string, number> }> {
  const out = new Map<string, { value: number | null; byDimension: Map<string, number> }>();
  for (const item of body.data ?? []) {
    if (!item.name) continue;
    const byDimension = new Map<string, number>();
    for (const breakdown of item.total_value?.breakdowns ?? []) {
      for (const result of breakdown.results ?? []) {
        const key = result.dimension_values?.join('|');
        const value = finite(result.value);
        if (key && value != null) byDimension.set(key, value);
      }
    }
    out.set(item.name, { value: finite(item.total_value?.value), byDimension });
  }
  return out;
}

async function attempt<T>(errors: string[], label: string, work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** One New York day of account numbers. */
export async function fetchAccountDay(call: GraphCall, igUserId: string, nyDate: string): Promise<AccountDay> {
  const errors: string[] = [];
  const raw: Record<string, unknown> = {};
  const range = dayBounds(nyDate);
  const base = { period: 'day', metric_type: 'total_value', ...range };

  // Each metric separately: Meta rejects the whole call when one metric is not allowed.
  const totals = new Map<string, number | null>();
  for (const metric of TOTAL_METRICS) {
    const body = await attempt(errors, metric, () => call<InsightsBody>('GET', `/${igUserId}/insights`, { ...base, metric }));
    if (body) {
      raw[metric] = body;
      totals.set(metric, readTotals(body).get(metric)?.value ?? null);
    }
  }
  const reachSplit = await attempt(errors, 'reach by follow_type', () =>
    call<InsightsBody>('GET', `/${igUserId}/insights`, { ...base, metric: 'reach', breakdown: 'follow_type' }));
  const split = reachSplit ? readTotals(reachSplit).get('reach')?.byDimension : undefined;
  if (reachSplit) raw.reach_follow_type = reachSplit;
  const follows = await attempt(errors, 'follows_and_unfollows', () =>
    call<InsightsBody>('GET', `/${igUserId}/insights`, { ...base, metric: 'follows_and_unfollows', breakdown: 'follow_type' }));
  // follow_type on follows_and_unfollows: FOLLOWER = new follows, NON_FOLLOWER = unfollows.
  const followSplit = follows ? readTotals(follows).get('follows_and_unfollows')?.byDimension : undefined;
  if (follows) raw.follows_and_unfollows = follows;
  // follower_count is a daily time series (unverified in Meta's table, D3): stored when returned.
  const fc = await attempt(errors, 'follower_count', () =>
    call<InsightsBody>('GET', `/${igUserId}/insights`, { metric: 'follower_count', period: 'day', ...range }));
  if (fc) raw.follower_count = fc;
  const fcValues = fc?.data?.find((d) => d.name === 'follower_count')?.values ?? [];

  return {
    nyDate,
    reach: totals.get('reach') ?? null,
    reachFollowers: split?.get('FOLLOWER') ?? null,
    reachNonFollowers: split?.get('NON_FOLLOWER') ?? null,
    views: totals.get('views') ?? null,
    accountsEngaged: totals.get('accounts_engaged') ?? null,
    totalInteractions: totals.get('total_interactions') ?? null,
    likes: totals.get('likes') ?? null,
    comments: totals.get('comments') ?? null,
    saves: totals.get('saves') ?? null,
    shares: totals.get('shares') ?? null,
    replies: totals.get('replies') ?? null,
    reposts: totals.get('reposts') ?? null,
    profileLinksTaps: totals.get('profile_links_taps') ?? null,
    follows: followSplit?.get('FOLLOWER') ?? null,
    unfollows: followSplit?.get('NON_FOLLOWER') ?? null,
    followerCount: finite(fcValues[fcValues.length - 1]?.value),
    raw,
    errors,
  };
}

export type DemographicRow = { metric: string; timeframe: string; breakdown: string; key: string; value: number };

/** follower_demographics for this_month by age, gender, country, city (top 45 each, per Meta). */
export async function fetchDemographics(call: GraphCall, igUserId: string): Promise<{ rows: DemographicRow[]; errors: string[] }> {
  const errors: string[] = [];
  const rows: DemographicRow[] = [];
  for (const breakdown of ['age', 'gender', 'country', 'city'] as const) {
    const body = await attempt(errors, `follower_demographics ${breakdown}`, () =>
      call<InsightsBody>('GET', `/${igUserId}/insights`, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', timeframe: 'this_month', breakdown }));
    const values = body ? readTotals(body).get('follower_demographics')?.byDimension : undefined;
    for (const [key, value] of values ?? []) rows.push({ metric: 'follower_demographics', timeframe: 'this_month', breakdown, key, value });
  }
  return { rows, errors };
}

/** online_followers for a New York day: hour → followers online (Meta keeps 30 days; unverified, D3). */
export async function fetchOnlineFollowers(call: GraphCall, igUserId: string, nyDate: string): Promise<{ hours: Array<{ hour: number; value: number }>; error: string | null }> {
  const errors: string[] = [];
  const body = await attempt(errors, 'online_followers', () =>
    call<InsightsBody>('GET', `/${igUserId}/insights`, { metric: 'online_followers', period: 'lifetime', ...dayBounds(nyDate) }));
  const value = body?.data?.find((d) => d.name === 'online_followers')?.values?.[0]?.value;
  const hours: Array<{ hour: number; value: number }> = [];
  if (value && typeof value === 'object') {
    for (const [hour, count] of Object.entries(value as Record<string, unknown>)) {
      const h = Number(hour);
      const v = finite(count);
      if (Number.isInteger(h) && h >= 0 && h <= 23 && v != null) hours.push({ hour: h, value: v });
    }
  }
  return { hours, error: errors[0] ?? null };
}
