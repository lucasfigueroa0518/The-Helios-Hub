/**
 * Copy a content type's lifecycle history onto the spine (D36: expand →
 * backfill → switch → contract). Idempotent: every insert skips a row that is
 * already there, so it can run before the switch, after it, or twice.
 * Copied rows keep their ids (and record them in `legacy_id`), so hub ids
 * built from schedule and attempt ids keep resolving.
 *
 * The legacy tables are only read here; after the switch nothing writes them.
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
