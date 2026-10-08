import { costOfPosts, perDollar } from '@/lib/social-hub/cost';
import { factorKeys, factorsFor, groupPosts, type FactorDef, type FactorGroup } from '@/lib/social-hub/factors';
import { aggregate, byMetric, DEFAULT_METRIC, isMetricKey, metricsFor, postMetric, topPerformers, type MetricSpec } from '@/lib/social-hub/metrics';
import { inRange, parseRange } from '@/lib/social-hub/time';
import { FORMAT_PLURAL, isVertical, verticalInfo } from '@/lib/social-hub/verticals';
import type { DateRange, Format, HubPost, MetricKey, Vertical } from '@/lib/social-hub/types';

/**
 * Analytics (spec §5): pure functions over posts. Global controls on every
 * tab: date range (SH-29), vertical first (SH-05), selectable success metric
 * (SH-08), native filters only when one vertical is picked. Descriptive only (SH-07).
 */

export type AnalyticsTab = 'profile' | 'content' | 'compare';
export type CompareMode = 'side' | 'groups';

export const MAX_COMPARE = 6;
export const MIN_COMPARE = 2;
const FILTER_PREFIX = 'f.';

export type AnalyticsQuery = {
  tab: AnalyticsTab;
  range: DateRange;
  vertical: Vertical | null;
  metric: MetricKey;
  /** Native filters `f.<factor>=<key>`, honored only with one vertical (SH-05). */
  filters: Record<string, string>;
  mode: CompareMode;
  factor: string;
  compare: string[];
  /** Posts table page, 1-based (25 a page, as Trial Reels). */
  page: number;
};

export const TABLE_PAGE_SIZE = 25;

export function pageOf<T>(items: readonly T[], page: number, size = TABLE_PAGE_SIZE): { page: number; pageCount: number; items: T[] } {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const safe = Math.min(Math.max(page, 1), pageCount);
  return { page: safe, pageCount, items: items.slice((safe - 1) * size, safe * size) };
}

export function parseAnalyticsQuery(params: Record<string, string | undefined>, compare: string[] = [], now = new Date()): AnalyticsQuery {
  const vertical = isVertical(params.v) ? params.v : null;
  const tab: AnalyticsTab = params.tab === 'profile' || params.tab === 'compare' ? params.tab : 'content';
  // Shared filters (format, slot) always work; native ones only with one vertical (SH-05).
  const filters: Record<string, string> = {};
  const allowed = new Set(filterFactors(vertical).map((f) => f.id));
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(FILTER_PREFIX) || !value) continue;
    const factor = key.slice(FILTER_PREFIX.length);
    if (allowed.has(factor)) filters[factor] = value;
  }
  const factors = factorsFor(vertical);
  const factor = factors.some((f) => f.id === params.factor) ? params.factor! : factors[0]!.id;
  const valid = metricChoices({ vertical }).map((m) => m.key);
  const metric = isMetricKey(params.metric) && valid.includes(params.metric) ? params.metric : DEFAULT_METRIC;
  const ids = [...new Set(compare.flatMap((c) => c.split(',')).map((c) => c.trim()).filter(Boolean))].slice(0, MAX_COMPARE);
  return {
    tab,
    range: parseRange({ range: params.range, from: params.from, to: params.to }, now),
    vertical,
    metric,
    filters,
    mode: params.mode === 'groups' ? 'groups' : 'side',
    factor,
    compare: ids,
    page: Number.isInteger(Number(params.page)) && Number(params.page) > 0 ? Number(params.page) : 1,
  };
}

/** Factors offered as filters: shared ones minus `vertical` (it has its own control), plus native ones for one vertical. */
export function filterFactors(vertical: Vertical | null): FactorDef[] {
  return factorsFor(vertical).filter((f) => f.id !== 'vertical');
}

/** Every param that reproduces a query, except the page (any change starts at page 1). */
export function queryParams(q: AnalyticsQuery): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {
    tab: q.tab === 'content' ? undefined : q.tab,
    range: q.range.id === '30d' ? undefined : q.range.id,
    from: q.range.id === 'custom' ? q.range.from ?? undefined : undefined,
    to: q.range.id === 'custom' ? q.range.to : undefined,
    v: q.vertical ?? undefined,
    metric: q.metric === DEFAULT_METRIC ? undefined : q.metric,
    mode: q.mode === 'groups' ? 'groups' : undefined,
    factor: q.mode === 'groups' ? q.factor : undefined,
    cmp: q.compare.length ? q.compare.join(',') : undefined,
  };
  for (const [factor, key] of Object.entries(q.filters)) out[`${FILTER_PREFIX}${factor}`] = key;
  return out;
}

export type StateChange = Partial<Record<string, string | null>>;

/**
 * One place that says what each control keeps and clears. A vertical change
 * clears filters and the factor (they belong to the old vertical); a range
 * change clears from/to; every change resets the page.
 */
export function hrefWith(action: string, q: AnalyticsQuery, changes: StateChange): string {
  const next: Record<string, string | undefined> = { ...queryParams(q) };
  if ('v' in changes) {
    for (const key of Object.keys(next)) if (key.startsWith(FILTER_PREFIX)) delete next[key];
    delete next.factor;
  }
  if ('range' in changes && changes.range !== 'custom') {
    delete next.from;
    delete next.to;
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value == null) delete next[key];
    else next[key] = value;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `${action}?${text}` : action;
}

/**
 * Posts that count for analytics: published, with a media id behind their
 * numbers (Trial Reels' own rule), posted inside the range.
 */
export function postsInView(posts: readonly HubPost[], q: Pick<AnalyticsQuery, 'range' | 'vertical' | 'filters'>): HubPost[] {
  const mixed = !q.vertical;
  return posts.filter((p) => {
    if (p.status !== 'published' || !inRange(p.nyDate, q.range)) return false;
    if (q.vertical && p.vertical !== q.vertical) return false;
    for (const [factor, key] of Object.entries(q.filters)) {
      if (!factorKeys(p, factor, mixed).some((k) => k.key === key)) return false;
    }
    return true;
  });
}

/** Metric choices for what's in view: shared metrics only when formats mix (SH-05). */
export function metricChoices(q: Pick<AnalyticsQuery, 'vertical'>): MetricSpec[] {
  return metricsFor(q.vertical ? [verticalInfo(q.vertical).format] : ALL_FORMATS);
}

const ALL_FORMATS: Format[] = ['reel', 'feed', 'story'];

/**
 * Filter options with the values present in the range: shared ones (format,
 * slot) in any view, native ones only with one vertical. A factor with a
 * single value is still offered when it is the active filter, so it can be cleared.
 */
export function filterOptions(
  posts: readonly HubPost[],
  q: Pick<AnalyticsQuery, 'vertical' | 'range' | 'filters'>,
): Array<{ factor: FactorDef; values: Array<{ key: string; label: string; count: number }> }> {
  const mixed = !q.vertical;
  const mine = posts.filter((p) => p.status === 'published' && inRange(p.nyDate, q.range) && (!q.vertical || p.vertical === q.vertical));
  return filterFactors(q.vertical)
    .map((factor) => {
      const counts = new Map<string, { label: string; count: number }>();
      for (const post of mine) {
        for (const e of factorKeys(post, factor.id, mixed)) {
          const seen = counts.get(e.key);
          counts.set(e.key, { label: e.label, count: (seen?.count ?? 0) + 1 });
        }
      }
      const active = q.filters[factor.id];
      if (active && !counts.has(active)) counts.set(active, { label: active, count: 0 });
      return { factor, values: [...counts.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)) };
    })
    .filter((o) => o.values.length > 1 || q.filters[o.factor.id]);
}

export type Headline = { key: MetricKey; label: string; value: number | null; reported: number; total: number; display: MetricSpec['display'] };

export function headlines(posts: readonly HubPost[], metrics: readonly MetricSpec[]): Headline[] {
  return metrics.map((m) => ({ key: m.key, label: m.label, display: m.display, ...aggregate(posts, m.key) }));
}

export type FormatBlock = { format: Format; label: string; count: number; costMicros: number; headlines: Headline[] };

/** Content analytics per format (spec §5.2): each format with its own metric set. */
export function formatBlocks(posts: readonly HubPost[]): FormatBlock[] {
  const formats: Format[] = ['reel', 'feed', 'story'];
  return formats
    .map((format) => {
      const mine = posts.filter((p) => p.format === format);
      return { format, label: FORMAT_PLURAL[format], count: mine.length, costMicros: costOfPosts(mine).micros, headlines: headlines(mine, metricsFor([format])) };
    })
    .filter((b) => b.count > 0);
}

export function rankPosts(posts: readonly HubPost[], metric: MetricKey): HubPost[] {
  return [...posts].sort(byMetric(metric));
}

export { topPerformers };

// ── Compare: side by side ────────────────────────────────────────────────────

export type CompareRow = { label: string; group: 'metric' | 'cost' | 'meta'; values: string[]; differs: boolean };

/**
 * Side by side (spec §5.4): rows = metrics, cost, then metadata. Mixed
 * verticals show shared metric rows plus each post's native fields (blank
 * where a field doesn't apply). Rows where posts differ are flagged.
 */
export function sideBySide(posts: readonly HubPost[], format: (value: number | null, key: MetricKey) => string, money: (micros: number | null) => string): CompareRow[] {
  const formats = [...new Set(posts.map((p) => p.format))];
  const rows: CompareRow[] = [];
  const push = (label: string, group: CompareRow['group'], values: string[]) => {
    rows.push({ label, group, values, differs: new Set(values).size > 1 });
  };
  for (const m of metricsFor(formats)) push(m.label, 'metric', posts.map((p) => format(postMetric(p, m.key), m.key)));
  push('Cost to make', 'cost', posts.map((p) => money(p.costMicros)));
  push('Views per $', 'cost', posts.map((p) => format(perDollar(postMetric(p, 'views'), p.costMicros), 'views')));
  push('Vertical', 'meta', posts.map((p) => verticalInfo(p.vertical).label));
  push('Posted', 'meta', posts.map((p) => p.nyDate ?? '—'));
  push('Slot', 'meta', posts.map((p) => p.slot?.label ?? '—'));
  const labels: string[] = [];
  for (const p of posts) for (const f of p.native) if (!labels.includes(f.label)) labels.push(f.label);
  for (const label of labels) {
    push(label, 'meta', posts.map((p) => p.native.find((f) => f.label === label)?.value ?? ''));
  }
  return rows;
}

/** Published posts only (the analytics rule); unknown or unpublished ids are dropped. */
export function comparePosts(all: readonly HubPost[], ids: readonly string[]): HubPost[] {
  return ids.map((id) => all.find((p) => p.id === id && p.status === 'published')).filter((p): p is HubPost => Boolean(p));
}

// ── Compare: group vs group ──────────────────────────────────────────────────

export function groupsFor(posts: readonly HubPost[], q: Pick<AnalyticsQuery, 'factor' | 'metric'>): FactorGroup[] {
  return groupPosts(posts, q.factor, q.metric);
}
