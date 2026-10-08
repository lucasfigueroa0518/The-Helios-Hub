import { calendarDateKey } from '@/lib/instagram/clock';
import { InsightsBlockedError, createInsightsClient, safeMessage, type InsightsClient, type InsightsReading } from '@/lib/instagram/insights-client';
import { INSIGHTS_WARM_MS, insightIsDue } from '@/lib/instagram/insights-rules';
import type { Query } from '@/lib/social/store/pg';

/**
 * Lifetime insights for published carousels, into social.media_insights, on
 * the Trial Reels due/settle rules (lib/instagram/insights-rules.ts): every
 * 30 minutes for two days, once a New York day through day 14, then one
 * closing read.
 */

export const CAROUSEL_METRICS = ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'] as const;
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
    `SELECT id, media_id, finished_at, insights_checked_at FROM social.publish_attempts
      WHERE status = 'published' AND media_id IS NOT NULL AND finished_at IS NOT NULL
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
        `INSERT INTO social.media_insights (media_id, ny_date, publish_attempt_id, views, reach, likes, comments, saved, shares, total_interactions, raw)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         ON CONFLICT (media_id, ny_date) DO UPDATE SET
           publish_attempt_id = EXCLUDED.publish_attempt_id, captured_at = now(),
           views = COALESCE(EXCLUDED.views, social.media_insights.views),
           reach = COALESCE(EXCLUDED.reach, social.media_insights.reach),
           likes = COALESCE(EXCLUDED.likes, social.media_insights.likes),
           comments = COALESCE(EXCLUDED.comments, social.media_insights.comments),
           saved = COALESCE(EXCLUDED.saved, social.media_insights.saved),
           shares = COALESCE(EXCLUDED.shares, social.media_insights.shares),
           total_interactions = COALESCE(EXCLUDED.total_interactions, social.media_insights.total_interactions),
           raw = EXCLUDED.raw`,
        [row.media_id, nyDate, row.id, reading.views, reading.reach, reading.likes, reading.comments, reading.saved, reading.shares, reading.total_interactions, JSON.stringify(reading.raw ?? {})],
      );
      written += 1;
    }
    const settle = now.getTime() - new Date(row.finished_at).getTime() > INSIGHTS_WARM_MS;
    await query(
      `UPDATE social.publish_attempts
          SET insights_checked_at = $2::timestamptz,
              insights_settled_at = CASE WHEN $3::boolean THEN $2::timestamptz ELSE insights_settled_at END
        WHERE id = $1`,
      [row.id, now.toISOString(), settle],
    );
  }
  return { considered: due.length, written, blocked: null, detail };
}
