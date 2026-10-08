import { num } from '@/lib/social-hub/adapters/common';
import type { AccountRead } from '@/lib/social-hub/queries/account';
import { inRange, weekdayOf } from '@/lib/social-hub/time';
import type { DateRange } from '@/lib/social-hub/types';

/**
 * Profile analytics (spec §5.1) from `social_hub` rows: pure. Daily account
 * numbers are added across days (labelled "summed daily": a person reached on
 * two days counts twice). A blank day stays out of the sum.
 */

export type AccountSummary = {
  days: number;
  reach: number | null;
  views: number | null;
  accountsEngaged: number | null;
  interactions: number | null;
  linkTaps: number | null;
  netFollows: number | null;
  followerShare: number | null;
  followerCount: number | null;
  series: Array<{ nyDate: string; reach: number | null; views: number | null }>;
  demographics: Array<{ breakdown: string; rows: Array<{ key: string; value: number; share: number }> }>;
  online: number[][] | null;
  lastRefresh: string | null;
};

function sum(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

export function summarizeAccount(read: AccountRead, range: DateRange): AccountSummary | null {
  if (!read.present) return null;
  const days = read.days.filter((d) => inRange(d.ny_date.slice(0, 10), range));
  if (days.length === 0 && read.demographics.length === 0 && read.online.length === 0) return null;
  const n = (k: keyof (typeof days)[number]) => days.map((d) => num(d[k]));
  const follows = sum(n('follows'));
  const unfollows = sum(n('unfollows'));
  const followers = sum(n('reach_followers'));
  const nonFollowers = sum(n('reach_non_followers'));
  const last = [...days].reverse().find((d) => num(d.follower_count) != null);

  // Demographics: Meta's follower breakdowns first, top 5 per breakdown with shares.
  const metric = read.demographics.some((d) => d.metric === 'follower_demographics') ? 'follower_demographics' : 'engaged_audience_demographics';
  // One timeframe so keys never repeat: this_month, else this_week, else prev_month (META_API_CHECK).
  const timeframe = ['this_month', 'this_week', 'prev_month'].find((t) => read.demographics.some((d) => d.metric === metric && d.timeframe === t));
  const breakdowns = ['age', 'gender', 'country', 'city'];
  const demographics = breakdowns
    .map((breakdown) => {
      const rows = read.demographics
        .filter((d) => d.metric === metric && d.breakdown === breakdown && d.timeframe === timeframe)
        .sort((a, b) => Number(b.value) - Number(a.value));
      const total = rows.reduce((s, r) => s + Number(r.value), 0);
      return { breakdown, rows: rows.slice(0, 5).map((r) => ({ key: r.key, value: Number(r.value), share: total ? Number(r.value) / total : 0 })) };
    })
    .filter((d) => d.rows.length > 0);

  // Most active times: mean online followers per weekday × hour.
  let online: number[][] | null = null;
  if (read.online.length) {
    const totals = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    const counts = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (const row of read.online) {
      const w = weekdayOf(row.ny_date.slice(0, 10));
      totals[w]![row.hour]! += Number(row.value);
      counts[w]![row.hour]! += 1;
    }
    online = totals.map((hours, w) => hours.map((t, h) => (counts[w]![h]! ? t / counts[w]![h]! : 0)));
  }

  return {
    days: days.length,
    reach: sum(n('reach')),
    views: sum(n('views')),
    accountsEngaged: sum(n('accounts_engaged')),
    interactions: sum(n('total_interactions')),
    linkTaps: sum(n('profile_links_taps')),
    netFollows: follows == null && unfollows == null ? null : (follows ?? 0) - (unfollows ?? 0),
    followerShare: followers != null && nonFollowers != null && followers + nonFollowers > 0 ? followers / (followers + nonFollowers) : null,
    followerCount: last ? num(last.follower_count) : null,
    series: days.map((d) => ({ nyDate: d.ny_date.slice(0, 10), reach: num(d.reach), views: num(d.views) })),
    demographics,
    online,
    lastRefresh: read.lastRefresh,
  };
}
