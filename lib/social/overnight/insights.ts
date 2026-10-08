import { calendarDateKey } from '@/lib/instagram/clock';
import { InsightsBlockedError, createInsightsClient, safeMessage, type InsightsClient, type InsightsReading } from '@/lib/instagram/insights-client';
import { INSIGHTS_WARM_MS, insightIsDue } from '@/lib/instagram/insights-rules';
import type { Query } from '@/lib/social/store/pg';

/**
 * Lifetime insights for published carousels, into social_hub.media_insights, on
 * the Trial Reels due/settle rules (lib/instagram/insights-rules.ts): every
 * 30 minutes for two days, once a New York day through day 14, then one
 * closing read.
 */

/** Feed media metrics (Social Hub META_API_CHECK): follows and profile_visits added in P2-M1. */
export const CAROUSEL_METRICS = ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'follows', 'profile_visits'] as const;
export type CarouselMetric = (typeof CAROUSEL_METRICS)[number];
export type CarouselReading = InsightsReading<CarouselMetric>;
export type CarouselInsightsClient = InsightsClient<CarouselMetric>;

export function createCarouselInsightsClient(options: { token: string; fetchImpl?: typeof fetch }): CarouselInsightsClient {
  return createInsightsClient({ ...options, metrics: CAROUSEL_METRICS });
}

export type CarouselInsightsResult = { considered: number; written: number; blocked: 'permission' | 'token' | null; detail: string | null };

/** Ask Instagram about every published carousel that is due. */
export async function pollCarouselInsights(query: Query, client: CarouselInsightsClient, now = new Date(), limit = 200): Promise<CarouselInsightsResult> {
  const { rows: open } = await query(
    `SELECT id, media_id, finished_at, insights_checked_at FROM social_hub.publish_attempts
      WHERE vertical = 'carousels' AND status = 'published' AND media_id IS NOT NULL AND finished_at IS NOT NULL
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
    let reading: CarouselReading;
    try {
      reading = await client.insights(row.media_id);
    } catch (error) {
      if (error instanceof InsightsBlockedError) return { considered: due.length, written, blocked: error.blocked, detail: safeMessage(error) };
      detail ??= safeMessage(error);
      continue;
    }
    if (CAROUSEL_METRICS.some((m) => reading[m] != null)) {
      await query(
        `INSERT INTO social_hub.media_insights (media_id, ny_date, vertical, publish_attempt_id, views, reach, likes, comments, saved, shares, total_interactions, follows, profile_visits, raw)
         VALUES ($1, $2::date, 'carousels', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
         ON CONFLICT (media_id, ny_date) DO UPDATE SET
           publish_attempt_id = EXCLUDED.publish_attempt_id, captured_at = now(),
           views = COALESCE(EXCLUDED.views, social_hub.media_insights.views),
           reach = COALESCE(EXCLUDED.reach, social_hub.media_insights.reach),
           likes = COALESCE(EXCLUDED.likes, social_hub.media_insights.likes),
           comments = COALESCE(EXCLUDED.comments, social_hub.media_insights.comments),
           saved = COALESCE(EXCLUDED.saved, social_hub.media_insights.saved),
           shares = COALESCE(EXCLUDED.shares, social_hub.media_insights.shares),
           total_interactions = COALESCE(EXCLUDED.total_interactions, social_hub.media_insights.total_interactions),
           follows = COALESCE(EXCLUDED.follows, social_hub.media_insights.follows),
           profile_visits = COALESCE(EXCLUDED.profile_visits, social_hub.media_insights.profile_visits),
           raw = EXCLUDED.raw`,
        [row.media_id, nyDate, row.id, reading.views, reading.reach, reading.likes, reading.comments, reading.saved, reading.shares, reading.total_interactions, reading.follows, reading.profile_visits, JSON.stringify(reading.raw ?? {})],
      );
      written += 1;
    }
    const settle = now.getTime() - new Date(row.finished_at).getTime() > INSIGHTS_WARM_MS;
    await query(
      `UPDATE social_hub.publish_attempts
          SET insights_checked_at = $2::timestamptz,
              insights_settled_at = CASE WHEN $3::boolean THEN $2::timestamptz ELSE insights_settled_at END
        WHERE id = $1`,
      [row.id, now.toISOString(), settle],
    );
  }
  return { considered: due.length, written, blocked: null, detail };
}
