import { filterOptions, pageOf, postsInView } from '@/lib/social-hub/analytics';
import { costOfPosts } from '@/lib/social-hub/cost';
import { factorsFor, groupPosts, THIN_SAMPLE, type FactorDef, type FactorGroup } from '@/lib/social-hub/factors';
import { aggregate, byMetric, isMetricKey, metricSpec, metricsFor, postMetric, type MetricSpec } from '@/lib/social-hub/metrics';
import { addDays, parseRange } from '@/lib/social-hub/time';
import { VERTICAL_IDS, verticalInfo } from '@/lib/social-hub/verticals';
import { median } from '@/lib/social-hub/views/typical';
import type { DateRange, HubPost, MetricKey, Vertical } from '@/lib/social-hub/types';

/**
 * Analytics view models (BRIEFS.md §3). Account, then type, then post. Every
 * figure carries a comparison: the same span just before the range. Daily
 * series attribute a post's lifetime numbers to the day it went out.
 */

export type Query = {
  range: DateRange;
  metric: MetricKey;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  filters: Record<string, string>;
  factor: string | null;
};

export const RANGES = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All' },
] as const;

export function parseQuery(params: Record<string, string | undefined>, vertical: Vertical | null, now: Date): Query {
  const allowed = metricsFor(vertical ? [verticalInfo(vertical).format] : ['reel', 'feed', 'story']).map((m) => m.key);
  const metric = isMetricKey(params.metric) && allowed.includes(params.metric) ? params.metric : 'views';
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (k.startsWith('f.') && v) filters[k.slice(2)] = v;
  const factors = factorChoices(vertical);
  return {
    range: parseRange({ range: params.range, from: params.from, to: params.to }, now),
    metric,
    sort: params.sort ?? metric,
    dir: params.dir === 'asc' ? 'asc' : 'desc',
    page: Number(params.page) > 0 ? Math.floor(Number(params.page)) : 1,
    filters,
    factor: factors.some((f) => f.id === params.factor) ? params.factor! : null,
  };
}

/** Factors worth grouping by: a type's own fields first; never "type" or (within one type) "format". */
export function factorChoices(vertical: Vertical | null): FactorDef[] {
  const all = factorsFor(vertical).filter((f) => f.id !== 'vertical' && !(vertical && f.id === 'format'));
  const shared = new Set(['format', 'slot']);
  return [...all.filter((f) => !shared.has(f.id)), ...all.filter((f) => shared.has(f.id))];
}

/** The same span immediately before the range; null for "All". */
export function previousRange(range: DateRange): DateRange | null {
  if (!range.from) return null;
  const days = Math.round((Date.parse(`${range.to}T12:00:00Z`) - Date.parse(`${range.from}T12:00:00Z`)) / 86_400_000) + 1;
  return { id: 'custom', from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

export function daysOf(range: DateRange, posts: readonly HubPost[]): string[] {
  const from = range.from ?? posts.map((p) => p.nyDate).filter((d): d is string => Boolean(d)).sort()[0] ?? range.to;
  const out: string[] = [];
  for (let d = from; d <= range.to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** A metric per day by the day each post went out (sum for counts, mean for rates and durations). */
export function dailySeries(posts: readonly HubPost[], days: readonly string[], metric: MetricKey): Array<number | null> {
  const byDay = new Map<string, HubPost[]>();
  for (const p of posts) if (p.nyDate) byDay.set(p.nyDate, [...(byDay.get(p.nyDate) ?? []), p]);
  return days.map((d) => {
    const list = byDay.get(d);
    return list?.length ? aggregate(list, metric).value : null;
  });
}

export type Kpi = { key: MetricKey | 'costPer1k' | 'posts'; label: string; value: number | null; previous: number | null; display: MetricSpec['display'] | 'money'; spark: Array<number | null>; higherIsBetter: boolean };

function costPer1k(posts: readonly HubPost[]): number | null {
  const views = aggregate(posts, 'views').value;
  const cost = costOfPosts(posts);
  return views && cost.items ? cost.micros / 1_000_000 / (views / 1000) : null;
}

export function overviewKpis(all: readonly HubPost[], q: Query, vertical: Vertical | null): { kpis: Kpi[]; posts: HubPost[]; previous: HubPost[] | null; days: string[] } {
  const scope = { range: q.range, vertical, filters: q.filters };
  const posts = postsInView(all, scope);
  const prevRange = previousRange(q.range);
  const previous = prevRange ? postsInView(all, { ...scope, range: prevRange }) : null;
  const days = daysOf(q.range, posts);
  const keys: MetricKey[] = vertical
    ? ({ reel: ['views', 'avgWatchTimeMs', 'skipRate', 'shares'], feed: ['views', 'reach', 'shares', 'saved'], story: ['reach', 'completion', 'replies', 'exitsFirst3'] } as const)[verticalInfo(vertical).format].slice()
    : ['views', 'reach', 'shares'];
  const kpis: Kpi[] = [
    { key: 'posts', label: 'Posts', value: posts.length, previous: previous?.length ?? null, display: 'count', spark: days.map((d) => posts.filter((p) => p.nyDate === d).length || null), higherIsBetter: true },
    ...keys.map((k): Kpi => ({
      key: k,
      label: metricSpec(k).label,
      value: aggregate(posts, k).value,
      previous: previous ? aggregate(previous, k).value : null,
      display: metricSpec(k).display,
      spark: dailySeries(posts, days, k),
      higherIsBetter: metricSpec(k).higherIsBetter,
    })),
    { key: 'costPer1k', label: 'Cost per 1K views', value: costPer1k(posts), previous: previous ? costPer1k(previous) : null, display: 'money', spark: [], higherIsBetter: false },
  ];
  return { kpis, posts, previous, days };
}

export type TypeRow = {
  vertical: Vertical;
  posts: number;
  median: number | null;
  previousMedian: number | null;
  spark: Array<number | null>;
  sharesPerPost: number | null;
  costPerPost: number | null;
};

export function typeRows(all: readonly HubPost[], q: Query, days: readonly string[]): TypeRow[] {
  const prevRange = previousRange(q.range);
  const applies = (v: Vertical) => metricSpec(q.metric).formats.includes(verticalInfo(v).format);
  return VERTICAL_IDS.map((vertical) => {
    const posts = postsInView(all, { range: q.range, vertical, filters: {} });
    const prev = prevRange ? postsInView(all, { range: prevRange, vertical, filters: {} }) : [];
    const cost = costOfPosts(posts);
    return {
      vertical,
      posts: posts.length,
      median: applies(vertical) ? median(posts.map((p) => postMetric(p, q.metric))) : null,
      previousMedian: applies(vertical) && prevRange ? median(prev.map((p) => postMetric(p, q.metric))) : null,
      spark: applies(vertical) ? dailySeries(posts, days, q.metric) : [],
      sharesPerPost: posts.length ? (aggregate(posts, 'shares').value ?? 0) / posts.length : null,
      costPerPost: cost.items ? cost.micros / cost.items : null,
    };
  });
}

export type Series = { vertical: Vertical; label: string; values: Array<number | null> };

/** Trailing mean over `window` days, skipping blanks; a day with no data in its window stays blank. */
export function rolling(values: Array<number | null>, window: number): Array<number | null> {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

/** One line per type. Past two weeks the daily numbers are smoothed to a 7-day average, so the shape reads instead of the noise. */
export function trendSeries(posts: readonly HubPost[], days: readonly string[], metric: MetricKey): { series: Series[]; smoothed: boolean } {
  const smoothed = days.length > 14;
  const series = VERTICAL_IDS
    .filter((v) => metricSpec(metric).formats.includes(verticalInfo(v).format))
    .map((v) => {
      const daily = dailySeries(posts.filter((p) => p.vertical === v), days, metric);
      return { vertical: v, label: verticalInfo(v).label, values: smoothed ? rolling(daily, 7) : daily };
    })
    .filter((s) => s.values.some((x) => x != null));
  return { series, smoothed };
}

/** Posts table, sorted by a column (metric keys, "posted", "cost"), paged 25 at a time. */
export function sortedPosts(posts: readonly HubPost[], q: Query): { page: number; pageCount: number; items: HubPost[]; total: number } {
  const dir = q.dir === 'asc' ? -1 : 1;
  let sorted: HubPost[];
  if (q.sort === 'posted') sorted = [...posts].sort((a, b) => dir * (b.postedAt ?? '').localeCompare(a.postedAt ?? ''));
  else if (q.sort === 'cost') sorted = [...posts].sort((a, b) => dir * ((b.costMicros ?? -1) - (a.costMicros ?? -1)));
  else if (isMetricKey(q.sort)) {
    const base = [...posts].sort(byMetric(q.sort));
    sorted = q.dir === 'asc' ? base.reverse() : base;
  } else sorted = [...posts].sort(byMetric(q.metric));
  return { ...pageOf(sorted, q.page), total: posts.length };
}

/** Groups by the chosen factor; with none chosen, the first of the type's factors that actually splits the posts. */
export function whatsWorking(posts: readonly HubPost[], vertical: Vertical, q: Query): { factors: FactorDef[]; factor: string | null; groups: FactorGroup[]; typical: number | null } {
  const factors = factorChoices(vertical);
  let factor = q.factor;
  let groups = factor ? groupPosts(posts, factor, q.metric) : [];
  if (!q.factor) {
    for (const f of factors) {
      const g = groupPosts(posts, f.id, q.metric);
      if (g.length > 1) {
        factor = f.id;
        groups = g;
        break;
      }
    }
  }
  return { factors, factor, groups, typical: median(posts.map((p) => postMetric(p, q.metric))) };
}

export { filterOptions };

export type WorkingRow = { key: string; better: number | null };

/**
 * What the factor table says, in one sentence (critique 2026-10-08, P2-E):
 * the group furthest ahead of the type's median among groups big enough to
 * read, or plainly that nothing stands out. `better` is signed so that up is
 * good for every metric (cost-like metrics flip).
 */
export function workingVerdict(groups: readonly FactorGroup[], typical: number | null, metric: MetricKey): { sentence: string; rows: WorkingRow[] } {
  const up = metricSpec(metric).higherIsBetter;
  const rows = groups.map((g): WorkingRow => {
    const value = g.means[metric] ?? null;
    if (value == null || typical == null || typical === 0) return { key: g.key, better: null };
    const delta = (value - typical) / Math.abs(typical);
    return { key: g.key, better: up ? delta : -delta };
  });
  const readable = groups
    .map((g, i) => ({ g, better: rows[i]!.better }))
    .filter((r): r is { g: FactorGroup; better: number } => r.better != null && !r.g.thin);
  const total = groups.reduce((n, g) => n + g.count, 0);
  if (readable.length < 2) return { sentence: `Too few posts in each group to compare yet (${total} in all).`, rows };
  const best = readable.reduce((a, b) => (b.better > a.better ? b : a));
  const worst = readable.reduce((a, b) => (b.better < a.better ? b : a));
  const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
  if (best.better < 0.1 && worst.better > -0.1) {
    return { sentence: `Nothing stands out yet: every group with ${THIN_SAMPLE}+ posts is within 10% of the median (${total} posts).`, rows };
  }
  const lead = best.better >= 0.1 ? `Posts in “${best.g.label}” beat the median by ${pct(best.better)} (${best.g.count} posts)` : null;
  const lag = worst.better <= -0.1 && worst !== best
    ? lead ? `posts in “${worst.g.label}” fall short of it by ${pct(worst.better)} (${worst.g.count})` : `Posts in “${worst.g.label}” fall short of the median by ${pct(worst.better)} (${worst.g.count} posts)`
    : null;
  return { sentence: `${[lead, lag].filter(Boolean).join('; ')}.`, rows };
}
