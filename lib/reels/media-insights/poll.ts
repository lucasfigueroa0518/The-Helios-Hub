import { dbQuery } from '@/lib/db';
import { calendarDateKey } from '@/lib/reels/schedule';
import { publishedSince } from '@/lib/reels/analytics/performance';
import { MetaNotConfiguredError, metaConfigured } from '@/lib/reels/music/meta';
import { setSetting } from '@/lib/reels/music/store';
import {
  InsightsPermissionError,
  InsightsTokenError,
  createLiveInsightsClient,
  type InsightsClient,
} from '@/lib/reels/media-insights/client';
import { readingHasSignal, type ReelInsightReading } from '@/lib/reels/media-insights/parse';

/** Nightly poll window. The page Refresh uses the window that is open instead. */
export const INSIGHTS_LOOKBACK_DAYS = 14;

export const INSIGHTS_POLL_SETTING = 'insights_poll';

export const INSIGHTS_PERMISSION_MESSAGE = 'The Instagram token needs the instagram_manage_insights permission.';
export const INSIGHTS_TOKEN_MESSAGE = 'The Instagram token was rejected, so performance numbers cannot be collected.';
export const INSIGHTS_UNCONFIGURED_MESSAGE = 'Meta is not configured, so performance numbers cannot be collected.';
export const INSIGHTS_EMPTY_MESSAGE = 'Instagram did not return insights for these reels.';

export type InsightsPollStatus = {
  at: string;
  blocked: 'permission' | 'token' | 'unconfigured' | null;
  message: string | null;
  considered: number;
  written: number;
  /** First Graph failure. Logged by the worker. Not stored on the setting the page reads. */
  detail?: string | null;
};

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/access_token=[^&\s]+/gi, 'access_token=(redacted)').slice(0, 500);
}

async function remember(status: InsightsPollStatus): Promise<InsightsPollStatus> {
  await setSetting(INSIGHTS_POLL_SETTING, {
    at: status.at,
    blocked: status.blocked,
    message: status.message,
    considered: status.considered,
    written: status.written,
  });
  return status;
}

/**
 * Pull lifetime insights for published reels with `finished_at` at or after `since`.
 * Null `since` checks every published reel. A response with no numbers is not
 * stored, so a failed day cannot hide the previous snapshot.
 */
export async function pollMediaInsights(input: {
  since?: Date | null;
  now?: Date;
  client?: InsightsClient;
} = {}): Promise<InsightsPollStatus> {
  const now = input.now ?? new Date();
  const since = input.since === undefined ? publishedSince(INSIGHTS_LOOKBACK_DAYS, now) : input.since;
  const at = now.toISOString();

  let client = input.client;
  if (!client) {
    if (!metaConfigured()) {
      return remember({
        at,
        blocked: 'unconfigured',
        message: INSIGHTS_UNCONFIGURED_MESSAGE,
        considered: 0,
        written: 0,
      });
    }
    try {
      client = createLiveInsightsClient();
    } catch (error) {
      if (error instanceof MetaNotConfiguredError) {
        return remember({
          at,
          blocked: 'unconfigured',
          message: INSIGHTS_UNCONFIGURED_MESSAGE,
          considered: 0,
          written: 0,
        });
      }
      throw error;
    }
  }

  const { rows } = await dbQuery<{ id: string; media_id: string }>(
    `SELECT id, media_id
       FROM reels.publish_attempts
      WHERE status = 'published'
        AND media_id IS NOT NULL
        AND btrim(media_id) <> ''
        AND trigger <> 'mix_test'
        AND finished_at IS NOT NULL
        AND ($1::timestamptz IS NULL OR finished_at >= $1::timestamptz)
        AND finished_at <= $2::timestamptz
      ORDER BY finished_at DESC`,
    [since ? since.toISOString() : null, now.toISOString()],
  );

  const nyDate = calendarDateKey(now);
  let written = 0;
  let blocked: InsightsPollStatus['blocked'] = null;
  let message: string | null = null;
  let detail: string | null = null;

  for (const row of rows) {
    let reading: ReelInsightReading;
    try {
      reading = await client.reelInsights(row.media_id);
    } catch (error) {
      if (error instanceof InsightsPermissionError) {
        blocked = 'permission';
        message = INSIGHTS_PERMISSION_MESSAGE;
        detail = safeMessage(error);
        break;
      }
      if (error instanceof InsightsTokenError) {
        blocked = 'token';
        message = INSIGHTS_TOKEN_MESSAGE;
        detail = safeMessage(error);
        break;
      }
      if (!detail) detail = safeMessage(error);
      continue;
    }
    if (!readingHasSignal(reading)) continue;
    await upsertInsight(row.id, row.media_id, nyDate, reading);
    written += 1;
  }

  if (!blocked && written === 0 && rows.length > 0) {
    message = INSIGHTS_EMPTY_MESSAGE;
  }
  if (!blocked && written > 0) message = null;

  return remember({ at, blocked, message, considered: rows.length, written, detail });
}

export function pollRecentInsights(now = new Date()): Promise<InsightsPollStatus> {
  return pollMediaInsights({ since: publishedSince(INSIGHTS_LOOKBACK_DAYS, now), now });
}

async function upsertInsight(attemptId: string, mediaId: string, nyDate: string, reading: ReelInsightReading): Promise<void> {
  await dbQuery(
    `INSERT INTO reels.media_insights (
        media_id, ny_date, publish_attempt_id, captured_at,
        views, reach, likes, comments, saved, shares, reposts, total_interactions,
        avg_watch_time_ms, total_watch_time_ms, skip_rate, is_shared_to_feed, raw
      ) VALUES (
        $1, $2::date, $3, now(),
        $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16::jsonb
      )
      ON CONFLICT (media_id, ny_date) DO UPDATE SET
        publish_attempt_id = EXCLUDED.publish_attempt_id,
        captured_at = now(),
        views = COALESCE(EXCLUDED.views, reels.media_insights.views),
        reach = COALESCE(EXCLUDED.reach, reels.media_insights.reach),
        likes = COALESCE(EXCLUDED.likes, reels.media_insights.likes),
        comments = COALESCE(EXCLUDED.comments, reels.media_insights.comments),
        saved = COALESCE(EXCLUDED.saved, reels.media_insights.saved),
        shares = COALESCE(EXCLUDED.shares, reels.media_insights.shares),
        reposts = COALESCE(EXCLUDED.reposts, reels.media_insights.reposts),
        total_interactions = COALESCE(EXCLUDED.total_interactions, reels.media_insights.total_interactions),
        avg_watch_time_ms = COALESCE(EXCLUDED.avg_watch_time_ms, reels.media_insights.avg_watch_time_ms),
        total_watch_time_ms = COALESCE(EXCLUDED.total_watch_time_ms, reels.media_insights.total_watch_time_ms),
        skip_rate = COALESCE(EXCLUDED.skip_rate, reels.media_insights.skip_rate),
        is_shared_to_feed = COALESCE(EXCLUDED.is_shared_to_feed, reels.media_insights.is_shared_to_feed),
        raw = EXCLUDED.raw`,
    [
      mediaId,
      nyDate,
      attemptId,
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
      reading.sharedToFeed,
      JSON.stringify(reading.raw ?? {}),
    ],
  );
}
