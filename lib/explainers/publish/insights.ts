import type { Queryable } from '@/lib/explainers/db';
import { calendarDateKey } from '@/lib/instagram/clock';
import { InsightsBlockedError, createInsightsClient, safeMessage, type InsightsClient, type InsightsReading } from '@/lib/instagram/insights-client';
import { INSIGHTS_WARM_MS, insightIsDue, normalizeSkipRate } from '@/lib/instagram/insights-rules';

/**
 * Lifetime insights for published explainers, into social_hub.media_insights,
 * on the Trial Reels due/settle rules and reel metrics.
 */

export const EXPLAINER_METRICS = [
  'views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions',
  'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate',
] as const;
export type ExplainerMetric = (typeof EXPLAINER_METRICS)[number];
export type ExplainerInsightsClient = InsightsClient<ExplainerMetric>;

export function createExplainerInsightsClient(options: { token: string; fetchImpl?: typeof fetch }): ExplainerInsightsClient {
  return createInsightsClient({ ...options, metrics: EXPLAINER_METRICS });
}

export type ExplainerInsightsResult = { considered: number; written: number; blocked: 'permission' | 'token' | null; detail: string | null };

export async function pollExplainerInsights(db: Queryable, client: ExplainerInsightsClient, now = new Date(), limit = 200): Promise<ExplainerInsightsResult> {
  const { rows: open } = await db.query<{ id: string; media_id: string; finished_at: string; insights_checked_at: string | null }>(
    `SELECT id, media_id, finished_at, insights_checked_at FROM social_hub.publish_attempts
      WHERE vertical = 'explainers' AND status = 'published' AND media_id IS NOT NULL AND finished_at IS NOT NULL
        AND finished_at <= $1::timestamptz AND insights_settled_at IS NULL
      ORDER BY (insights_checked_at IS NULL) DESC, finished_at DESC`,
    [now.toISOString()],
  );
  const due = open
    .filter((r) => insightIsDue({ finishedAt: new Date(r.finished_at), checkedAt: r.insights_checked_at ? new Date(r.insights_checked_at) : null, now }))
    .slice(0, limit);
  const nyDate = calendarDateKey(now);
  let written = 0;
  let detail: string | null = null;
  for (const row of due) {
    let reading: InsightsReading<ExplainerMetric>;
    try {
      reading = await client.insights(row.media_id);
    } catch (error) {
      if (error instanceof InsightsBlockedError) return { considered: due.length, written, blocked: error.blocked, detail: safeMessage(error) };
      detail ??= safeMessage(error);
      continue;
    }
    if (EXPLAINER_METRICS.some((m) => reading[m] != null)) {
      await db.query(
        `INSERT INTO social_hub.media_insights (media_id, ny_date, vertical, publish_attempt_id, views, reach, likes, comments, saved, shares,
            total_interactions, avg_watch_time_ms, total_watch_time_ms, skip_rate, raw)
         VALUES ($1, $2::date, 'explainers', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
         ON CONFLICT (media_id, ny_date) DO UPDATE SET
           publish_attempt_id = EXCLUDED.publish_attempt_id, captured_at = now(),
           views = COALESCE(EXCLUDED.views, social_hub.media_insights.views),
           reach = COALESCE(EXCLUDED.reach, social_hub.media_insights.reach),
           likes = COALESCE(EXCLUDED.likes, social_hub.media_insights.likes),
           comments = COALESCE(EXCLUDED.comments, social_hub.media_insights.comments),
           saved = COALESCE(EXCLUDED.saved, social_hub.media_insights.saved),
           shares = COALESCE(EXCLUDED.shares, social_hub.media_insights.shares),
           total_interactions = COALESCE(EXCLUDED.total_interactions, social_hub.media_insights.total_interactions),
           avg_watch_time_ms = COALESCE(EXCLUDED.avg_watch_time_ms, social_hub.media_insights.avg_watch_time_ms),
           total_watch_time_ms = COALESCE(EXCLUDED.total_watch_time_ms, social_hub.media_insights.total_watch_time_ms),
           skip_rate = COALESCE(EXCLUDED.skip_rate, social_hub.media_insights.skip_rate),
           raw = EXCLUDED.raw`,
        [
          row.media_id, nyDate, row.id, reading.views, reading.reach, reading.likes, reading.comments, reading.saved, reading.shares,
          reading.total_interactions, reading.ig_reels_avg_watch_time, reading.ig_reels_video_view_total_time,
          normalizeSkipRate(reading.reels_skip_rate), JSON.stringify(reading.raw ?? {}),
        ],
      );
      written += 1;
    }
    const settle = now.getTime() - new Date(row.finished_at).getTime() > INSIGHTS_WARM_MS;
    await db.query(
      `UPDATE social_hub.publish_attempts
          SET insights_checked_at = $2::timestamptz,
              insights_settled_at = CASE WHEN $3::boolean THEN $2::timestamptz ELSE insights_settled_at END
        WHERE id = $1`,
      [row.id, now.toISOString(), settle],
    );
  }
  return { considered: due.length, written, blocked: null, detail };
}
