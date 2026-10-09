import { formatMetricKey, metricSpec, postMetric } from '@/lib/social-hub/metrics';
import { addDays, inRange, nyDateOf } from '@/lib/social-hub/time';
import type { HubPost, MetricKey, Vertical } from '@/lib/social-hub/types';

/**
 * "Numbers earn their place" (PRODUCT.md): a post's number is shown against
 * what's typical for its type, the median of the type's published posts over
 * the last 30 days. Medians, not means, so one viral post doesn't move it.
 */

export function median(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
}

export type Typicals = (vertical: Vertical, metric: MetricKey) => number | null;

export function typicals(posts: readonly HubPost[], now: Date, days = 30): Typicals {
  const today = nyDateOf(now)!;
  const range = { id: 'custom' as const, from: addDays(today, -(days - 1)), to: today };
  const cache = new Map<string, number | null>();
  return (vertical, metric) => {
    const key = `${vertical}:${metric}`;
    if (!cache.has(key)) {
      const mine = posts.filter((p) => p.vertical === vertical && p.status === 'published' && inRange(p.nyDate, range));
      cache.set(key, mine.length >= 3 ? median(mine.map((p) => postMetric(p, metric))) : null);
    }
    return cache.get(key) ?? null;
  };
}

/** "2.1× typical", "about typical", "0.6× typical"; null when there's nothing to compare. */
export function vsTypical(value: number | null, typical: number | null, metric: MetricKey): string | null {
  if (value == null || typical == null || typical === 0) return null;
  const ratio = value / typical;
  const better = metricSpec(metric).higherIsBetter ? ratio : 1 / ratio;
  if (better > 0.85 && better < 1.15) return 'about typical';
  return `${(metricSpec(metric).higherIsBetter ? ratio : ratio).toFixed(1)}× typical`;
}

/** Signed share change, "+12%" / "−8%", null when either side is missing. */
export function change(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function changeLabel(delta: number | null): string {
  if (delta == null) return '';
  const pct = Math.round(delta * 100);
  if (pct === 0) return '0%';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

/** "13.6K views · 2.1× typical" */
export function metricWithTypical(post: HubPost, metric: MetricKey, typical: Typicals): string | null {
  const value = postMetric(post, metric);
  if (value == null) return null;
  const vs = vsTypical(value, typical(post.vertical, metric), metric);
  return `${formatMetricKey(value, metric)} ${metricSpec(metric).label.toLowerCase()}${vs ? ` · ${vs}` : ''}`;
}

/**
 * The type's typical path for a metric by days since posting (index 0 = the
 * day it posted): the median of the type's published posts over the last 30
 * days at the same age. Drawn as a dashed reference under a post's own line.
 */
export function typicalCurve(posts: readonly HubPost[], vertical: Vertical, metric: MetricKey, now: Date, length: number, days = 30): Array<number | null> {
  const today = nyDateOf(now)!;
  const range = { id: 'custom' as const, from: addDays(today, -(days - 1)), to: today };
  const mine = posts.filter((p) => p.vertical === vertical && p.status === 'published' && inRange(p.nyDate, range) && p.history.length > 0);
  if (mine.length < 3) return Array.from({ length }, () => null);
  return Array.from({ length }, (_, i) => median(mine.map((p) => {
    const snap = p.history[i];
    const v = snap?.metrics[metric];
    return typeof v === 'number' ? v : null;
  })));
}
