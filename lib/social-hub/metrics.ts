import type { Format, HubMetrics, HubPost, MetricKey } from '@/lib/social-hub/types';

/**
 * Metric catalog, trimmed to META_API_CHECK.md (SH-22): only metrics Meta
 * exposes and the verticals store. A blank stays out of every figure.
 */
export type MetricSpec = {
  key: MetricKey;
  label: string;
  display: 'count' | 'duration' | 'rate';
  /** How a set of posts combines: Trial Reels headline shape. */
  aggregate: 'sum' | 'mean';
  /** False for skip rate and exits: lower is better when ranking. */
  higherIsBetter: boolean;
  formats: readonly Format[];
};

export const METRICS: readonly MetricSpec[] = [
  { key: 'views', label: 'Views', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['reel', 'feed', 'story'] },
  { key: 'reach', label: 'Reach', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['reel', 'feed', 'story'] },
  { key: 'shares', label: 'Shares', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['reel', 'feed', 'story'] },
  { key: 'saved', label: 'Saves', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['reel', 'feed'] },
  { key: 'likes', label: 'Likes', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['reel', 'feed'] },
  { key: 'comments', label: 'Comments', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['reel', 'feed'] },
  { key: 'totalInteractions', label: 'Interactions', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['reel', 'feed', 'story'] },
  { key: 'reposts', label: 'Reposts', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['reel'] },
  { key: 'avgWatchTimeMs', label: 'Avg watch time', display: 'duration', aggregate: 'mean', higherIsBetter: true, formats: ['reel'] },
  { key: 'totalWatchTimeMs', label: 'Total watch time', display: 'duration', aggregate: 'sum', higherIsBetter: true, formats: ['reel'] },
  { key: 'skipRate', label: 'Skip rate', display: 'rate', aggregate: 'mean', higherIsBetter: false, formats: ['reel'] },
  // Feed follows / profile visits: collected for carousels since P2-M1 (not available for reels).
  { key: 'follows', label: 'Follows', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['feed', 'story'] },
  { key: 'profileVisits', label: 'Profile visits', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['feed', 'story'] },
  { key: 'replies', label: 'Replies', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['story'] },
  { key: 'tapsForward', label: 'Taps forward', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['story'] },
  { key: 'tapsBack', label: 'Taps back', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['story'] },
  { key: 'exits', label: 'Exits', display: 'count', aggregate: 'sum', higherIsBetter: false, formats: ['story'] },
  { key: 'swipeForward', label: 'Swipe forward', display: 'count', aggregate: 'sum', higherIsBetter: true, formats: ['story'] },
  { key: 'completion', label: 'Completion', display: 'rate', aggregate: 'mean', higherIsBetter: true, formats: ['story'] },
  { key: 'exitsFirst3', label: 'Exits, frames 1–3', display: 'count', aggregate: 'sum', higherIsBetter: false, formats: ['story'] },
];

export const DEFAULT_METRIC: MetricKey = 'views';

const BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

export function metricSpec(key: MetricKey): MetricSpec {
  const spec = BY_KEY.get(key);
  if (!spec) throw new Error(`unknown metric: ${key}`);
  return spec;
}

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === 'string' && BY_KEY.has(value as MetricKey);
}

/** Metrics that make sense for a set of formats: every format must have it (SH-05 shared fields only). */
export function metricsFor(formats: readonly Format[]): MetricSpec[] {
  if (formats.length === 0) return [...METRICS];
  return METRICS.filter((m) => formats.every((f) => m.formats.includes(f)));
}

/** Metrics a single format shows on its post view (§5.2). */
export function formatMetrics(format: Format): MetricSpec[] {
  return METRICS.filter((m) => m.formats.includes(format));
}

export function metricValue(metrics: HubMetrics | null | undefined, key: MetricKey): number | null {
  const value = metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function postMetric(post: HubPost, key: MetricKey): number | null {
  return metricValue(post.metrics, key);
}

export function sumReported(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((sum, v) => sum + v, 0);
}

export function mean(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

export function aggregate(posts: readonly HubPost[], key: MetricKey): { value: number | null; reported: number; total: number } {
  const spec = metricSpec(key);
  const values = posts.map((p) => postMetric(p, key));
  return {
    value: spec.aggregate === 'sum' ? sumReported(values) : mean(values),
    reported: values.filter((v) => v != null).length,
    total: posts.length,
  };
}

/** Rank comparator for the selected metric: best first, blanks last (SH-08). */
export function byMetric(key: MetricKey): (a: HubPost, b: HubPost) => number {
  const better = metricSpec(key).higherIsBetter ? -1 : 1;
  return (a, b) => {
    const x = postMetric(a, key);
    const y = postMetric(b, key);
    if (x == null && y == null) return (b.postedAt ?? '').localeCompare(a.postedAt ?? '') || a.id.localeCompare(b.id);
    if (x == null) return 1;
    if (y == null) return -1;
    if (x !== y) return x < y ? -better : better;
    return (b.postedAt ?? '').localeCompare(a.postedAt ?? '') || a.id.localeCompare(b.id);
  };
}

/** Top N posts by the selected metric, all verticals mixed (SH-30). Posts with no number are left out. */
export function topPerformers(posts: readonly HubPost[], key: MetricKey, n = 5): HubPost[] {
  return posts.filter((p) => postMetric(p, key) != null).sort(byMetric(key)).slice(0, n);
}

export function formatMetric(value: number | null, display: MetricSpec['display']): string {
  if (value == null) return '—';
  // Rates are stored as 0–1 shares (lib/reels/media-insights/parse.ts).
  if (display === 'rate') return `${(value * 100).toFixed(1)}%`;
  if (display === 'duration') {
    const tenths = Math.round(value / 100);
    if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
    const seconds = Math.round(value / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  const abs = Math.abs(value);
  if (abs >= 999_950) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1000).toFixed(1)}K`;
  return Math.round(value).toLocaleString('en-US');
}

export function formatMetricKey(value: number | null, key: MetricKey): string {
  return formatMetric(value, metricSpec(key).display);
}

