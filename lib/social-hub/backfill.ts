/**
 * Copy a content type's lifecycle history onto the spine (D36: expand →
 * backfill → switch → contract). Idempotent: every insert skips a row that is
 * already there, so it can run before the switch, after it, or twice.
 * Copied rows keep their ids (and record them in `legacy_id`), so hub ids
 * built from schedule and attempt ids keep resolving.
 *
 * The legacy tables are only read here; after the switch nothing writes them.
 * (Explainers' review verdicts stay live in explainers.feedback; the spine
 * mirrors them, and re-running the backfill re-syncs any that drifted.)
 */
import type { SpineQuery } from './spine';

export type BackfillCounts = { items: number; attempts: number; schedule: number; insights: number; approvals: number };

const CAROUSELS = {
  items: `
INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref)
SELECT 'carousels', 'feed', p.id::text, p.story_id
  FROM social.posts p
 WHERE p.id IN (SELECT post_id FROM social.posting_schedule UNION SELECT post_id FROM social.publish_attempts)
ON CONFLICT DO NOTHING`,
  attempts: `
INSERT INTO social_hub.publish_attempts (id, content_item_id, vertical, trigger, status, requested_at, started_at, finished_at,
       caption, payload, child_container_ids, container_id, media_id, permalink, status_log, error,
       insights_checked_at, insights_settled_at, legacy_id)
SELECT a.id, ci.id, 'carousels', a.trigger, a.status, a.requested_at, a.started_at, a.finished_at,
       a.caption, jsonb_build_object('image_objects', a.image_objects), a.child_container_ids, a.container_id, a.media_id,
       a.permalink, a.status_log, a.error, a.insights_checked_at, a.insights_settled_at, a.id
  FROM social.publish_attempts a
  JOIN social_hub.content_items ci ON ci.vertical = 'carousels' AND ci.native_ref = a.post_id::text
ON CONFLICT DO NOTHING`,
  schedule: `
INSERT INTO social_hub.schedule (id, content_item_id, vertical, ny_date, slot, publish_at, status, source, publish_attempt_id, error, created_at, legacy_id)
SELECT s.id, ci.id, 'carousels', s.ny_date, s.slot, s.publish_at, s.status, s.source, s.publish_attempt_id, s.error, s.created_at, s.id
  FROM social.posting_schedule s
  JOIN social_hub.content_items ci ON ci.vertical = 'carousels' AND ci.native_ref = s.post_id::text
ON CONFLICT DO NOTHING`,
  insights: `
INSERT INTO social_hub.media_insights (media_id, ny_date, vertical, publish_attempt_id, captured_at, views, reach, likes, comments,
       saved, shares, total_interactions, follows, profile_visits, raw)
SELECT m.media_id, m.ny_date, 'carousels', m.publish_attempt_id, m.captured_at, m.views, m.reach, m.likes, m.comments,
       m.saved, m.shares, m.total_interactions, m.follows, m.profile_visits, m.raw
  FROM social.media_insights m
  JOIN social_hub.publish_attempts a ON a.id = m.publish_attempt_id
ON CONFLICT DO NOTHING`,
  // A person's slot approval, else a Force click (SH-17): the earliest one per post.
  approvals: `
INSERT INTO social_hub.approvals (content_item_id, decision, decided_at, via)
SELECT DISTINCT ON (ci.id) ci.id, 'approved', d.at, d.via
  FROM (
    SELECT post_id, approved_at AS at, 'user' AS via FROM social.posting_schedule WHERE approved_at IS NOT NULL
    UNION ALL
    SELECT post_id, requested_at, 'force' FROM social.publish_attempts WHERE trigger = 'force'
  ) d
  JOIN social_hub.content_items ci ON ci.vertical = 'carousels' AND ci.native_ref = d.post_id::text
 ORDER BY ci.id, d.at
ON CONFLICT DO NOTHING`,
};

/** Carousels: social.{posting_schedule, publish_attempts, media_insights} → social_hub. */
export async function backfillCarousels(query: SpineQuery): Promise<BackfillCounts> {
  const run = async (sql: string) => (await query(`WITH moved AS (${sql.trim()} RETURNING 1) SELECT count(*)::int AS n FROM moved`)).rows[0].n as number;
  const items = await run(CAROUSELS.items);
  const attempts = await run(CAROUSELS.attempts);
  const schedule = await run(CAROUSELS.schedule);
  const insights = await run(CAROUSELS.insights);
  const approvals = await run(CAROUSELS.approvals);
  return { items, attempts, schedule, insights, approvals };
}

const EXPLAINERS = {
  // Every render with lifecycle history or a review verdict: an approved render
  // not yet scheduled must carry its approval onto the spine, or it never posts.
  items: `
INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref)
SELECT 'explainers', 'reel', j.id::text, j.topic_id::text
  FROM explainers.jobs j
 WHERE j.id IN (SELECT job_id FROM explainers.posting_schedule
                UNION SELECT job_id FROM explainers.publish_attempts
                UNION SELECT job_id FROM explainers.feedback)
ON CONFLICT DO NOTHING`,
  attempts: `
INSERT INTO social_hub.publish_attempts (id, content_item_id, vertical, trigger, status, requested_at, started_at, finished_at,
       caption, payload, container_id, media_id, permalink, status_log, error,
       insights_checked_at, insights_settled_at, legacy_id)
SELECT a.id, ci.id, 'explainers', a.trigger, a.status, a.requested_at, a.started_at, a.finished_at,
       a.caption, jsonb_build_object('video_object', a.video_object, 'share_to_feed', a.share_to_feed), a.container_id, a.media_id,
       a.permalink, a.status_log, a.error, a.insights_checked_at, a.insights_settled_at, a.id
  FROM explainers.publish_attempts a
  JOIN social_hub.content_items ci ON ci.vertical = 'explainers' AND ci.native_ref = a.job_id::text
ON CONFLICT DO NOTHING`,
  schedule: `
INSERT INTO social_hub.schedule (id, content_item_id, vertical, ny_date, slot, publish_at, status, source, publish_attempt_id, error, created_at, legacy_id)
SELECT s.id, ci.id, 'explainers', s.ny_date, s.slot, s.publish_at, s.status, s.source, s.publish_attempt_id, s.error, s.created_at, s.id
  FROM explainers.posting_schedule s
  JOIN social_hub.content_items ci ON ci.vertical = 'explainers' AND ci.native_ref = s.job_id::text
ON CONFLICT DO NOTHING`,
  insights: `
INSERT INTO social_hub.media_insights (media_id, ny_date, vertical, publish_attempt_id, captured_at, views, reach, likes, comments,
       saved, shares, total_interactions, avg_watch_time_ms, total_watch_time_ms, skip_rate, raw)
SELECT m.media_id, m.ny_date, 'explainers', m.publish_attempt_id, m.captured_at, m.views, m.reach, m.likes, m.comments,
       m.saved, m.shares, m.total_interactions, m.avg_watch_time_ms, m.total_watch_time_ms, m.skip_rate, m.raw
  FROM explainers.media_insights m
  JOIN social_hub.publish_attempts a ON a.id = m.publish_attempt_id
ON CONFLICT DO NOTHING`,
  // The review verdict is the source of truth (explainers.feedback); the spine mirrors it.
  approvals: `
INSERT INTO social_hub.approvals (content_item_id, decision, decided_at, decided_by, via)
SELECT ci.id, f.verdict, f.updated_at, f.created_by,
       CASE WHEN f.note LIKE 'Approved by Hard publish%' THEN 'force' ELSE 'user' END
  FROM explainers.feedback f
  JOIN social_hub.content_items ci ON ci.vertical = 'explainers' AND ci.native_ref = f.job_id::text
ON CONFLICT (content_item_id) DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at,
       decided_by = excluded.decided_by, via = excluded.via
 WHERE social_hub.approvals.decision IS DISTINCT FROM excluded.decision`,
};

/** Explainers: explainers.{posting_schedule, publish_attempts, media_insights} and the review verdicts → social_hub. */
export async function backfillExplainers(query: SpineQuery): Promise<BackfillCounts> {
  const run = async (sql: string) => (await query(`WITH moved AS (${sql.trim()} RETURNING 1) SELECT count(*)::int AS n FROM moved`)).rows[0].n as number;
  const items = await run(EXPLAINERS.items);
  const attempts = await run(EXPLAINERS.attempts);
  const schedule = await run(EXPLAINERS.schedule);
  const insights = await run(EXPLAINERS.insights);
  const approvals = await run(EXPLAINERS.approvals);
  return { items, attempts, schedule, insights, approvals };
}
