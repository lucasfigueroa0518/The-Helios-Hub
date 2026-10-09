import { dbQuery } from '@/lib/db';
import { calendarDateKey } from '@/lib/reels/schedule';
import {
  INSIGHTS_COOLDOWN_MS,
  INSIGHTS_NIGHTLY_BATCH,
  INSIGHTS_PAGE_BATCH,
  INSIGHTS_STALE_LOCK_MS,
  INSIGHTS_WARM_MS,
  insightIsDue,
} from '@/lib/reels/media-insights/due';
import { MetaNotConfiguredError, metaConfigured } from '@/lib/reels/music/meta';
import { getSetting, setSetting } from '@/lib/reels/music/store';
import {
  InsightsPermissionError,
  InsightsTokenError,
  createLiveInsightsClient,
  type InsightsClient,
} from '@/lib/reels/media-insights/client';
import { readingHasSignal, type ReelInsightReading } from '@/lib/reels/media-insights/parse';

export { INSIGHTS_NIGHTLY_BATCH, INSIGHTS_PAGE_BATCH };

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

export type InsightsClaim = 'claimed' | 'cooldown' | 'busy';

/** One pull at a time. `force` skips the 30-minute cooldown and still waits for a live pull. */
export async function claimInsightsPoll(now: Date, force: boolean): Promise<InsightsClaim> {
  const startedAt = now.toISOString();
  const staleBefore = new Date(now.getTime() - INSIGHTS_STALE_LOCK_MS).toISOString();
  const cooldownBefore = new Date(now.getTime() - INSIGHTS_COOLDOWN_MS).toISOString();
  const updated = await dbQuery<{ key: string }>(
    `UPDATE reels.settings
        SET value = jsonb_set(COALESCE(value, '{}'::jsonb), '{startedAt}', to_jsonb($2::text), true),
            updated_at = now()
      WHERE key = $1
        AND (
          COALESCE(value->>'startedAt', '') = ''
          OR value->>'startedAt' < $3
        )
        AND (
          $4::boolean
          OR COALESCE(value->>'at', '') = ''
          OR value->>'at' < $5
        )
      RETURNING key`,
    [INSIGHTS_POLL_SETTING, startedAt, staleBefore, force, cooldownBefore],
  );
  if (updated.rows.length > 0) return 'claimed';

  const inserted = await dbQuery<{ key: string }>(
    `INSERT INTO reels.settings (key, value, updated_at)
     VALUES (
       $1,
       jsonb_build_object('startedAt', $2::text, 'at', '', 'blocked', NULL, 'message', NULL, 'considered', 0, 'written', 0),
       now()
     )
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
    [INSIGHTS_POLL_SETTING, startedAt],
  );
  if (inserted.rows.length > 0) return 'claimed';

  const current = await getSetting<{ startedAt?: string }>(INSIGHTS_POLL_SETTING);
  if (current?.startedAt && current.startedAt >= staleBefore) return 'busy';
  return 'cooldown';
}

export async function releaseInsightsLock(startedAt: string): Promise<void> {
  await dbQuery(
    `UPDATE reels.settings
        SET value = value - 'startedAt', updated_at = now()
      WHERE key = $1 AND value->>'startedAt' = $2`,
    [INSIGHTS_POLL_SETTING, startedAt],
  );
}

/**
 * Ask Instagram for reels that are still due. A reel from the last two days is
 * due every 30 minutes. A reel from the last 14 days is due once each New York
 * day. After that, one closing read is stored and the reel is left alone.
 * Snapshots already stored stay. A response with no numbers is not stored.
 */
export async function pollDueInsights(input: {
  limit?: number;
  now?: Date;
  force?: boolean;
  alreadyClaimed?: boolean;
  client?: InsightsClient;
} = {}): Promise<InsightsPollStatus> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? INSIGHTS_PAGE_BATCH;
  const startedAt = now.toISOString();
  if (!input.alreadyClaimed) {
    const claim = await claimInsightsPoll(now, input.force ?? false);
    if (claim !== 'claimed') {
      const current = await getSetting<InsightsPollStatus>(INSIGHTS_POLL_SETTING);
      return {
        at: current?.at ?? startedAt,
        blocked: current?.blocked ?? null,
        message: claim === 'busy' ? 'A refresh is already running.' : current?.message ?? null,
        considered: 0,
        written: 0,
      };
    }
  }
  try {
    return await runDuePoll(now, limit, input.client);
  } catch (error) {
    await releaseInsightsLock(startedAt).catch(() => undefined);
    throw error;
  }
}

async function runDuePoll(now: Date, limit: number, clientInput?: InsightsClient): Promise<InsightsPollStatus> {
  const at = now.toISOString();

  let client = clientInput;
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

  const open = await dbQuery<{ id: string; media_id: string; finished_at: Date; insights_checked_at: Date | null }>(
    `SELECT id, media_id, finished_at, insights_checked_at
       FROM social_hub.publish_attempts
      WHERE vertical = 'reels'
        AND status = 'published'
        AND media_id IS NOT NULL
        AND btrim(media_id) <> ''
        AND trigger <> 'mix_test'
        AND finished_at IS NOT NULL
        AND finished_at <= $1::timestamptz
        AND insights_settled_at IS NULL
      ORDER BY (insights_checked_at IS NULL) DESC, finished_at DESC`,
    [at],
  );
  const rows = open.rows
    .filter((row) => insightIsDue({
      finishedAt: new Date(row.finished_at),
      checkedAt: row.insights_checked_at ? new Date(row.insights_checked_at) : null,
      now,
    }))
    .slice(0, limit);

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
    if (readingHasSignal(reading)) {
      await upsertInsight(row.id, row.media_id, nyDate, reading);
      written += 1;
    }
    await markInsightCheck(row.id, new Date(row.finished_at), now);
  }

  if (!blocked && written === 0 && rows.length > 0) {
    message = INSIGHTS_EMPTY_MESSAGE;
  }
  if (!blocked && written > 0) message = null;

  return remember({ at, blocked, message, considered: rows.length, written, detail });
}

async function markInsightCheck(attemptId: string, finishedAt: Date, now: Date): Promise<void> {
  const settle = now.getTime() - finishedAt.getTime() > INSIGHTS_WARM_MS;
  await dbQuery(
    `UPDATE social_hub.publish_attempts
        SET insights_checked_at = $2::timestamptz,
            insights_settled_at = CASE WHEN $3::boolean THEN $2::timestamptz ELSE insights_settled_at END
      WHERE id = $1`,
    [attemptId, now.toISOString(), settle],
  );
}

async function upsertInsight(attemptId: string, mediaId: string, nyDate: string, reading: ReelInsightReading): Promise<void> {
  await dbQuery(
    `INSERT INTO social_hub.media_insights (
        media_id, ny_date, vertical, publish_attempt_id, captured_at,
        views, reach, likes, comments, saved, shares, reposts, total_interactions,
        avg_watch_time_ms, total_watch_time_ms, skip_rate, shared_to_feed, raw
      ) VALUES (
        $1, $2::date, 'reels', $3, now(),
        $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16::jsonb
      )
      ON CONFLICT (media_id, ny_date) DO UPDATE SET
        publish_attempt_id = EXCLUDED.publish_attempt_id,
        captured_at = now(),
        views = COALESCE(EXCLUDED.views, social_hub.media_insights.views),
        reach = COALESCE(EXCLUDED.reach, social_hub.media_insights.reach),
        likes = COALESCE(EXCLUDED.likes, social_hub.media_insights.likes),
        comments = COALESCE(EXCLUDED.comments, social_hub.media_insights.comments),
        saved = COALESCE(EXCLUDED.saved, social_hub.media_insights.saved),
        shares = COALESCE(EXCLUDED.shares, social_hub.media_insights.shares),
        reposts = COALESCE(EXCLUDED.reposts, social_hub.media_insights.reposts),
        total_interactions = COALESCE(EXCLUDED.total_interactions, social_hub.media_insights.total_interactions),
        avg_watch_time_ms = COALESCE(EXCLUDED.avg_watch_time_ms, social_hub.media_insights.avg_watch_time_ms),
        total_watch_time_ms = COALESCE(EXCLUDED.total_watch_time_ms, social_hub.media_insights.total_watch_time_ms),
        skip_rate = COALESCE(EXCLUDED.skip_rate, social_hub.media_insights.skip_rate),
        shared_to_feed = COALESCE(EXCLUDED.shared_to_feed, social_hub.media_insights.shared_to_feed),
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
