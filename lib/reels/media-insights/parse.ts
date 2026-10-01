/**
 * Pure readers for the Instagram media insights payload. Lifetime metrics.
 * `reels_skip_rate` is stored as a 0–1 share of plays. Watch time stays in
 * milliseconds, which is the unit Meta documents for `ig_reels_avg_watch_time`.
 */

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

export function readMetricNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === 'object' && 'value' in value) {
    return readMetricNumber((value as { value: unknown }).value);
  }
  return null;
}

/** Meta documents a fraction of plays. A 0–100 payload is folded into that fraction. */
export function normalizeSkipRate(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return value;
  if (value <= 100) return value / 100;
  return null;
}

export function readInsightData(body: unknown): Record<string, number | null> {
  const data = body && typeof body === 'object' && 'data' in body ? (body as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return {};
  const out: Record<string, number | null> = {};
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const name = (row as { name?: unknown }).name;
    if (typeof name !== 'string') continue;
    const values = (row as { values?: unknown }).values;
    const first = Array.isArray(values) ? values[0] : null;
    const raw = first && typeof first === 'object' && first ? (first as { value?: unknown }).value : null;
    const number = readMetricNumber(raw);
    out[name] = name === 'reels_skip_rate' ? normalizeSkipRate(number) : number;
  }
  return out;
}

export function metricsNamedIn(message: string, requested: readonly string[]): string[] {
  return requested.filter((metric) => message.includes(metric));
}

export function graphErrorIsPermission(status: number, code: number | null, message: string): boolean {
  if (code === 10 || code === 200) return true;
  if (/instagram_manage_insights/i.test(message)) return true;
  if (status === 403 && /permission|insight/i.test(message)) return true;
  return false;
}

export function graphErrorIsToken(code: number | null, message: string): boolean {
  if (code === 190) return true;
  return /invalid oauth|session has expired|error validating access token/i.test(message);
}

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
