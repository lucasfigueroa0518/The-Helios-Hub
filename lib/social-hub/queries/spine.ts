import type { HubQuery } from '@/lib/social-hub/db';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * The hub's shared lifecycle reads (unification Move 7, D48): three queries
 * over the spine serve every content type on it — attempts, slots with no
 * attempt yet, and insights. Each type's own queries then read only its
 * content (posts, renders, videos and scores) for the ids these rows carry.
 * SELECT only.
 */

/** A content ref that is a real id (Trial Reels keep `attempt:<id>` placeholders for videos already gone). */
const UUID_OR_NULL = (ref: string) => `CASE WHEN ${ref} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ${ref} END`;

export type SpineAttemptRow = {
  attempt_id: string;
  vertical: Vertical;
  /** The content's own id (post / render / video), or null for a Trial Reels record whose video is gone. */
  content_ref: string | null;
  idea_ref: string | null;
  status: string;
  trigger: string;
  requested_at: string;
  finished_at: string | null;
  media_id: string | null;
  permalink: string | null;
  error: string | null;
  caption: string | null;
  payload: Record<string, unknown>;
  schedule_id: string | null;
  slot: string | null;
  publish_at: string | null;
  approved_at: string | null;
};

export type SpineScheduleRow = {
  schedule_id: string;
  vertical: Vertical;
  content_ref: string | null;
  idea_ref: string | null;
  ny_date: string;
  slot: string;
  publish_at: string;
  status: string;
  source: string;
  error: string | null;
  approved_at: string | null;
  created_at: string;
};

export type SpineInsightRow = { media_id: string; ny_date: string; vertical: Vertical; [metric: string]: unknown };

export type SpineRead = { attempts: SpineAttemptRow[]; schedules: SpineScheduleRow[]; insights: SpineInsightRow[] };

/** Every attempt (mix tests are repeats of one post and never shown), with the slot it fired from. */
export const SPINE_ATTEMPTS_SQL = `
SELECT a.id AS attempt_id, a.vertical, ${UUID_OR_NULL('ci.native_ref')} AS content_ref,
       COALESCE(a.payload->>'post_idea_id', ci.idea_ref) AS idea_ref,
       a.status, a.trigger, a.requested_at::text AS requested_at, a.finished_at::text AS finished_at,
       a.media_id, a.permalink, a.error, a.caption, a.payload,
       s.id AS schedule_id, s.slot, s.publish_at::text AS publish_at,
       COALESCE(s.approved_at, ap.decided_at)::text AS approved_at
  FROM social_hub.publish_attempts a
  JOIN social_hub.content_items ci ON ci.id = a.content_item_id
  LEFT JOIN social_hub.approvals ap ON ap.content_item_id = a.content_item_id AND ap.decision = 'approved'
  LEFT JOIN LATERAL (
    SELECT id, slot, publish_at, approved_at FROM social_hub.schedule x
     WHERE x.publish_attempt_id = a.id
     ORDER BY CASE x.status WHEN 'published' THEN 0 ELSE 1 END, x.publish_at DESC
     LIMIT 1
  ) s ON true
 WHERE a.vertical = ANY($1::text[]) AND a.trigger <> 'mix_test'
 ORDER BY a.requested_at DESC`;

/** Slots with no attempt yet: scheduled, cancelled, or failed before a try. A slot marked published with no attempt is not a second post. */
export const SPINE_SCHEDULES_SQL = `
SELECT s.id AS schedule_id, s.vertical, ${UUID_OR_NULL('ci.native_ref')} AS content_ref,
       COALESCE(s.idea_ref, ci.idea_ref) AS idea_ref,
       s.ny_date::text AS ny_date, s.slot, s.publish_at::text AS publish_at, s.status, s.source, s.error,
       COALESCE(s.approved_at, ap.decided_at)::text AS approved_at, s.created_at::text AS created_at
  FROM social_hub.schedule s
  LEFT JOIN social_hub.content_items ci ON ci.id = s.content_item_id
  LEFT JOIN social_hub.approvals ap ON ap.content_item_id = s.content_item_id AND ap.decision = 'approved'
 WHERE s.vertical = ANY($1::text[]) AND s.publish_attempt_id IS NULL AND s.status <> 'published'
 ORDER BY s.publish_at DESC`;

export const SPINE_INSIGHTS_SQL = `
SELECT media_id, ny_date::text AS ny_date, vertical, views, reach, likes, comments, saved, shares, reposts,
       total_interactions, avg_watch_time_ms, total_watch_time_ms, skip_rate, follows, profile_visits
  FROM social_hub.media_insights
 WHERE vertical = ANY($1::text[])
 ORDER BY media_id, ny_date`;

/** The metrics each type's posts carry (the columns its own insights table had), so a post's metrics keep their shape. */
const METRICS: Record<Vertical, readonly string[]> = {
  carousels: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'follows', 'profile_visits'],
  explainers: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'avg_watch_time_ms', 'total_watch_time_ms', 'skip_rate'],
  reels: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'reposts', 'total_interactions', 'avg_watch_time_ms', 'total_watch_time_ms', 'skip_rate'],
  stories: ['views', 'reach', 'shares', 'follows', 'profile_visits', 'total_interactions'],
};

export async function readSpine(q: HubQuery, verticals: readonly Vertical[]): Promise<SpineRead> {
  const [attempts, schedules, insights] = await Promise.all([
    q<SpineAttemptRow>(SPINE_ATTEMPTS_SQL, [verticals]),
    q<SpineScheduleRow>(SPINE_SCHEDULES_SQL, [verticals]),
    q<SpineInsightRow>(SPINE_INSIGHTS_SQL, [verticals]),
  ]);
  return { attempts: attempts.rows, schedules: schedules.rows, insights: insights.rows };
}

/** One type's share of a spine read. */
export function forVertical(read: SpineRead, vertical: Vertical): SpineRead {
  return {
    attempts: read.attempts.filter((r) => r.vertical === vertical),
    schedules: read.schedules.filter((r) => r.vertical === vertical),
    insights: read.insights.filter((r) => r.vertical === vertical),
  };
}

/** A type's insight rows in the shape its adapter reads: media, day, and that type's metric columns. */
export function insightRows(rows: readonly SpineInsightRow[], vertical: Vertical): Array<{ media_id: string; ny_date: string; [metric: string]: unknown }> {
  const cols = METRICS[vertical];
  return rows.map((r) => Object.fromEntries([['media_id', r.media_id], ['ny_date', r.ny_date], ...cols.map((c) => [c, r[c]])]) as { media_id: string; ny_date: string });
}
