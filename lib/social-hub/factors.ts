import { mean, METRICS, metricSpec, postMetric } from '@/lib/social-hub/metrics';
import { FORMAT_LABEL, verticalInfo } from '@/lib/social-hub/verticals';
import type { FactorValue, HubPost, MetricKey, Vertical } from '@/lib/social-hub/types';

/**
 * Group vs group (spec §5.4), generalized from `factorGroups` in
 * lib/reels/analytics/performance.ts (copied, not edited). Descriptive only
 * (SH-07): counts and means side by side.
 */

/** A group smaller than this stays visible and is marked thin (SH-09, Trial Reels rule). */
export const THIN_SAMPLE = 3;

export type FactorDef = { id: string; label: string };

/** Shared factors work in any mix of verticals (SH-05). */
export const SHARED_FACTORS: FactorDef[] = [
  { id: 'vertical', label: 'Vertical' },
  { id: 'format', label: 'Format' },
  { id: 'slot', label: 'Posting slot' },
];

/** Native factors unlock when one vertical is picked (SH-04, SH-05). Spec §5.4 lists. */
export const VERTICAL_FACTORS: Record<Vertical, FactorDef[]> = {
  reels: [
    { id: 'psychology', label: 'Psychology' },
    { id: 'bucket', label: 'Content bucket' },
    { id: 'blockbuster', label: 'Blockbuster' },
    { id: 'slot', label: 'Posting slot' },
    { id: 'audio', label: 'Audio type' },
    { id: 'genre', label: 'Song genre' },
    { id: 'color', label: 'Color grade' },
    { id: 'hook', label: 'Hook' },
    { id: 'sound', label: 'Hook sound' },
    { id: 'story', label: 'Full story cue' },
    { id: 'origin', label: 'Timely or carryover' },
    { id: 'score', label: 'Our score' },
    { id: 'lane', label: 'Knowledge lane (eligible)' },
  ],
  explainers: [
    { id: 'origin', label: 'Origin' },
    { id: 'weighted', label: 'Weighted score' },
    { id: 'jevAudience', label: 'Jev: audience fit' },
    { id: 'jevTeach', label: 'Jev: teachability' },
    { id: 'jevAnalogy', label: 'Jev: analogy' },
    { id: 'jevVisual', label: 'Jev: visual' },
    { id: 'jevAccuracy', label: 'Jev: accuracy under simplification' },
    { id: 'jevHook', label: 'Jev: hook strength' },
    { id: 'slot', label: 'Posting slot' },
    { id: 'reviewTags', label: 'Review tags' },
    { id: 'spend', label: 'Render spend' },
  ],
  carousels: [
    { id: 'hook', label: 'Hook pass' },
    { id: 'slides', label: 'Slide count' },
    { id: 'photos', label: 'Photo sources' },
    { id: 'source', label: 'Story source' },
    { id: 'slot', label: 'Posting slot' },
    { id: 'approval', label: 'Approval' },
  ],
  stories: [
    { id: 'series', label: 'Series' },
    { id: 'style', label: 'Style' },
    { id: 'frames', label: 'Frame count' },
    { id: 'backdrop', label: 'Backdrop of frame 1' },
    { id: 'origins', label: 'Candidate origin' },
    { id: 'weekday', label: 'Weekday' },
    { id: 'flagged', label: 'Flagged by review' },
    { id: 'trigger', label: 'Trigger' },
  ],
};

/** Factors on offer: shared ones always; a vertical's native ones only when it alone is in view. */
export function factorsFor(vertical: Vertical | null): FactorDef[] {
  if (!vertical) return SHARED_FACTORS;
  const native = VERTICAL_FACTORS[vertical];
  const nativeIds = new Set(native.map((f) => f.id));
  return [...SHARED_FACTORS.filter((f) => !nativeIds.has(f.id)), ...native];
}

export type FactorGroup = {
  key: string;
  label: string;
  count: number;
  thin: boolean;
  /** Mean of each metric over the group's posts that reported it. */
  means: Partial<Record<MetricKey, number | null>>;
  /** Mean cost to make, micro-dollars (SH-21). */
  costMicros: number | null;
  postIds: string[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function sharedValue(post: HubPost, factor: string, mixed: boolean): FactorValue | null {
  if (factor === 'vertical') return { kind: 'category', key: post.vertical, label: verticalInfo(post.vertical).label };
  if (factor === 'format') return { kind: 'category', key: post.format, label: FORMAT_LABEL[post.format] };
  if (factor === 'slot') {
    const own = post.factorValues.slot;
    const base: { key: string; label: string } = own?.kind === 'category'
      ? own
      : post.slot ? { key: post.slot.id, label: post.slot.label } : { key: 'unknown', label: 'Outside a slot' };
    // Slots are per vertical: Trial Reels' "morning" is not Carousels' "morning".
    if (!mixed) return { kind: 'category', ...base };
    return { kind: 'category', key: `${post.vertical}:${base.key}`, label: `${verticalInfo(post.vertical).short} · ${base.label}` };
  }
  return null;
}

/** Group keys for one post (a tags factor can give several). */
function seeds(post: HubPost, factor: string, bandMedian: number | null, mixed: boolean): Array<{ key: string; label: string }> {
  const shared = SHARED_FACTORS.some((f) => f.id === factor);
  const value = (shared ? sharedValue(post, factor, mixed) : post.factorValues[factor])
    ?? { kind: 'category', key: 'unknown', label: 'Unknown' };
  if (value.kind === 'category') return [{ key: value.key, label: value.label }];
  if (value.kind === 'tags') return value.values.length ? value.values : [{ key: '__none', label: value.empty }];
  // Score bands: above/below the median of the posts in view (same rule as Trial Reels' "our score").
  if (value.value == null || bandMedian == null) return [{ key: 'unscored', label: 'Unscored' }];
  return value.value >= bandMedian
    ? [{ key: 'above', label: 'At or above the median' }]
    : [{ key: 'below', label: 'Below the median' }];
}

function numericValue(post: HubPost, factor: string): number | null {
  const value = post.factorValues[factor];
  return value?.kind === 'number' && value.value != null && Number.isFinite(value.value) ? value.value : null;
}

function compareBy(metric: MetricKey) {
  const lowerBetter = !metricSpec(metric).higherIsBetter;
  return (a: FactorGroup, b: FactorGroup): number => {
    const x = a.means[metric] ?? null;
    const y = b.means[metric] ?? null;
    if (x == null && y == null) return a.label.localeCompare(b.label);
    if (x == null) return 1;
    if (y == null) return -1;
    if (x !== y) return lowerBetter ? x - y : y - x;
    return a.label.localeCompare(b.label);
  };
}

/** One row per group, sorted by the selected metric (SH-08), blanks last. */
export function groupPosts(posts: readonly HubPost[], factor: string, metric: MetricKey): FactorGroup[] {
  const bandMedian = median(posts.map((p) => numericValue(p, factor)).filter((v): v is number => v != null));
  const mixed = new Set(posts.map((p) => p.vertical)).size > 1;
  const buckets = new Map<string, { label: string; posts: HubPost[] }>();
  for (const post of posts) {
    for (const seed of seeds(post, factor, bandMedian, mixed)) {
      const bucket = buckets.get(seed.key);
      if (bucket) bucket.posts.push(post);
      else buckets.set(seed.key, { label: seed.label, posts: [post] });
    }
  }
  const groups: FactorGroup[] = [...buckets.entries()].map(([key, group]) => ({
    key,
    label: group.label,
    count: group.posts.length,
    thin: group.posts.length < THIN_SAMPLE,
    means: Object.fromEntries(METRICS.map((m) => [m.key, mean(group.posts.map((p) => postMetric(p, m.key)))])),
    costMicros: mean(group.posts.map((p) => p.costMicros)),
    postIds: group.posts.map((p) => p.id),
  }));
  groups.sort(compareBy(metric));
  return groups;
}

/**
 * The filterable keys a post has for a factor (category or tags; shared
 * factors namespaced by vertical in a mixed view). Score bands aren't filters.
 */
export function factorKeys(post: HubPost, factor: string, mixed: boolean): Array<{ key: string; label: string }> {
  const shared = SHARED_FACTORS.some((f) => f.id === factor);
  const value = shared ? sharedValue(post, factor, mixed) : post.factorValues[factor];
  if (!value) return [{ key: 'unknown', label: 'Unknown' }];
  if (value.kind === 'category') return [{ key: value.key, label: value.label }];
  if (value.kind === 'tags') return value.values.length ? value.values : [{ key: '__none', label: value.empty }];
  return [];
}
