/**
 * Trial Reels' reading of the Instagram media insights payload. Lifetime
 * metrics. `reels_skip_rate` is stored as a 0–1 share of plays. Watch time
 * stays in milliseconds, which is the unit Meta documents for
 * `ig_reels_avg_watch_time`. The payload readers and Graph error rules are the
 * shared ones (lib/instagram/insights-rules.ts).
 */
export {
  graphErrorIsPermission,
  graphErrorIsToken,
  metricsNamedIn,
  normalizeSkipRate,
  readInsightData,
  readMetricNumber,
} from '@/lib/instagram/insights-rules';

export const INSIGHT_METRICS = [
  'views',
  'reach',
  'likes',
  'comments',
  'saved',
  'shares',
  'reposts',
  'total_interactions',
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
  'reels_skip_rate',
] as const;

export type InsightMetricName = (typeof INSIGHT_METRICS)[number];

export type ReelInsightReading = {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  reposts: number | null;
  totalInteractions: number | null;
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
  skipRate: number | null;
  sharedToFeed: boolean | null;
  raw: unknown;
};

export function readSharedToFeed(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function readingFromMetrics(
  metrics: Record<string, number | null>,
  sharedToFeed: boolean | null,
  raw: unknown,
): ReelInsightReading {
  return {
    views: metrics.views ?? null,
    reach: metrics.reach ?? null,
    likes: metrics.likes ?? null,
    comments: metrics.comments ?? null,
    saved: metrics.saved ?? null,
    shares: metrics.shares ?? null,
    reposts: metrics.reposts ?? null,
    totalInteractions: metrics.total_interactions ?? null,
    avgWatchTimeMs: metrics.ig_reels_avg_watch_time ?? null,
    totalWatchTimeMs: metrics.ig_reels_video_view_total_time ?? null,
    skipRate: metrics.reels_skip_rate ?? null,
    sharedToFeed,
    raw,
  };
}

/** A row of blanks would become the latest snapshot and hide an earlier good day. */
export function readingHasSignal(reading: Pick<ReelInsightReading, 'views' | 'reach' | 'likes' | 'comments' | 'saved' | 'shares' | 'reposts' | 'totalInteractions' | 'avgWatchTimeMs' | 'totalWatchTimeMs' | 'skipRate' | 'sharedToFeed'>): boolean {
  const numbers = [
    reading.views,
    reading.reach,
    reading.likes,
    reading.comments,
    reading.saved,
    reading.shares,
    reading.reposts,
    reading.totalInteractions,
    reading.avgWatchTimeMs,
    reading.totalWatchTimeMs,
    reading.skipRate,
  ];
  if (numbers.some((value) => value != null && Number.isFinite(value))) return true;
  return reading.sharedToFeed != null;
}
