import type { HubQuery } from '@/lib/social-hub/db';
import { settingIsOn, type InsightRow } from '@/lib/social-hub/queries/reels';

/**
 * Carousel reads (SELECT only). Content lives in schema `social`: post idea =
 * news story (`story_id`); content version = a `social.posts` row. Only
 * `pipeline` rows count (dev renders never post; db/social_schema.sql).
 * Slots, attempts, approvals and insights live on the lifecycle spine
 * (`social_hub`, vertical 'carousels', D36); the row shapes are unchanged.
 */

export type CarouselPostRow = {
  post_id: string;
  run_id: string | null;
  slug: string;
  story_id: string | null;
  title: string;
  status: string;
  caption: string | null;
  created_at: string;
  published_at: string | null;
  render: Record<string, unknown> | null;
  slide_count: number | null;
  has_slide_objects: boolean;
  hook_pass: boolean | null;
  photo_sources: string[] | null;
  checks: { fixes?: unknown[]; warnings?: unknown[]; photoReplacements?: unknown[]; renderReview?: unknown[] } | null;
};

export type CarouselAttemptRow = {
  attempt_id: string;
  post_id: string;
  status: string;
  trigger: string;
  requested_at: string;
  finished_at: string | null;
  media_id: string | null;
  permalink: string | null;
  error: string | null;
  schedule_id: string | null;
  slot: string | null;
  publish_at: string | null;
  approved_at: string | null;
};

export type CarouselScheduleRow = {
  schedule_id: string;
  post_id: string;
  ny_date: string;
  slot: string;
  publish_at: string;
  status: string;
  source: string;
  error: string | null;
  approved_at: string | null;
};

export type CarouselIdeaRow = {
  story_id: string;
  title: string | null;
  url: string | null;
  score: number | string | null;
  outlet_count: number | null;
  run_started_at: string | null;
  post_count: number;
  last_post_at: string | null;
  published: boolean;
  scheduled: boolean;
};

export type CarouselsRead = {
  posts: CarouselPostRow[];
  attempts: CarouselAttemptRow[];
  schedules: CarouselScheduleRow[];
  insights: InsightRow[];
  ideas: CarouselIdeaRow[];
  requireApproval: boolean;
};

export const CAROUSEL_POSTS_SQL = `
SELECT p.id AS post_id, p.run_id, p.slug, p.story_id, p.title, p.status, p.caption,
       p.created_at::text AS created_at, p.published_at::text AS published_at, p.render,
       COALESCE(jsonb_array_length(p.slide_objects), jsonb_array_length(p.render->'slides')) AS slide_count,
       (jsonb_typeof(p.slide_objects) = 'array' AND jsonb_array_length(p.slide_objects) > 0) AS has_slide_objects,
       r.hook_pass,
       -- used_photos.post_id is rarely filled by the pipeline: match the story within a day of the post.
       (SELECT array_agg(DISTINCT u.source ORDER BY u.source) FROM social.used_photos u
         WHERE u.source IS NOT NULL
           AND (u.post_id = p.id
             OR (u.post_id IS NULL AND u.story_id = p.story_id
                 AND u.used_at BETWEEN p.created_at - interval '1 day' AND p.created_at + interval '1 day'))) AS photo_sources,
       (SELECT e->'checks' FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(r.record->'result'->'posts') = 'array' THEN r.record->'result'->'posts' ELSE '[]'::jsonb END) e
         WHERE e->>'storyId' = p.story_id LIMIT 1) AS checks
  FROM social.posts p
  LEFT JOIN social.runs r ON r.id = p.run_id
 WHERE p.origin = 'pipeline'
 ORDER BY p.created_at DESC`;

export const CAROUSEL_ATTEMPTS_SQL = `
SELECT a.id AS attempt_id, ci.native_ref AS post_id, a.status, a.trigger,
       a.requested_at::text AS requested_at, a.finished_at::text AS finished_at,
       a.media_id, a.permalink, a.error,
       s.id AS schedule_id, s.slot, s.publish_at::text AS publish_at, ap.decided_at::text AS approved_at
  FROM social_hub.publish_attempts a
  JOIN social_hub.content_items ci ON ci.id = a.content_item_id
  LEFT JOIN social_hub.approvals ap ON ap.content_item_id = a.content_item_id AND ap.decision = 'approved'
  LEFT JOIN LATERAL (
    SELECT id, slot, publish_at FROM social_hub.schedule
     WHERE publish_attempt_id = a.id
     ORDER BY publish_at DESC LIMIT 1
  ) s ON true
 WHERE a.vertical = 'carousels'
 ORDER BY a.requested_at DESC`;

export const CAROUSEL_SCHEDULES_SQL = `
SELECT s.id AS schedule_id, ci.native_ref AS post_id, s.ny_date::text AS ny_date, s.slot, s.publish_at::text AS publish_at,
       s.status, s.source, s.error, ap.decided_at::text AS approved_at
  FROM social_hub.schedule s
  JOIN social_hub.content_items ci ON ci.id = s.content_item_id
  LEFT JOIN social_hub.approvals ap ON ap.content_item_id = s.content_item_id AND ap.decision = 'approved'
 WHERE s.vertical = 'carousels'
   AND s.publish_attempt_id IS NULL
   -- A slot marked published with no attempt is the "already published" case; the attempt row is the post.
   AND s.status <> 'published'
 ORDER BY s.publish_at DESC`;

export const CAROUSEL_INSIGHTS_SQL = `
SELECT media_id, ny_date::text AS ny_date, views, reach, likes, comments, saved, shares, total_interactions, follows, profile_visits
  FROM social_hub.media_insights
 WHERE vertical = 'carousels'
 ORDER BY media_id, ny_date`;

/** Candidate stories from the newest daily run's shortlist, scored by Jev (probSum). */
export const CAROUSEL_IDEAS_SQL = `
WITH latest AS (
  SELECT record, started_at FROM social.runs
   WHERE kind = 'daily' AND jsonb_typeof(record->'selection'->'shortlist') = 'array'
   ORDER BY started_at DESC NULLS LAST LIMIT 1
)
SELECT c->>'id' AS story_id,
       COALESCE(c->'members'->0->>'title', c->'representative'->>'headline') AS title,
       c->'members'->0->>'url' AS url,
       c->>'probSum' AS score,
       (c->>'outletCount')::int AS outlet_count,
       latest.started_at::text AS run_started_at,
       (SELECT count(*)::int FROM social.posts p WHERE p.story_id = c->>'id' AND p.origin = 'pipeline') AS post_count,
       (SELECT max(p.created_at)::text FROM social.posts p WHERE p.story_id = c->>'id' AND p.origin = 'pipeline') AS last_post_at,
       EXISTS (SELECT 1 FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
                WHERE ci.vertical = 'carousels' AND ci.idea_ref = c->>'id' AND a.status = 'published') AS published,
       EXISTS (SELECT 1 FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id
                WHERE ci.vertical = 'carousels' AND ci.idea_ref = c->>'id' AND s.status IN ('scheduled', 'publishing')) AS scheduled
  FROM latest, jsonb_array_elements(latest.record->'selection'->'shortlist') c`;

export const CAROUSEL_REQUIRE_APPROVAL_SQL = `SELECT value FROM social.settings WHERE key = 'require_approval'`;

export async function readCarousels(q: HubQuery): Promise<CarouselsRead> {
  const [posts, attempts, schedules, insights, ideas, approval] = await Promise.all([
    q<CarouselPostRow>(CAROUSEL_POSTS_SQL),
    q<CarouselAttemptRow>(CAROUSEL_ATTEMPTS_SQL),
    q<CarouselScheduleRow>(CAROUSEL_SCHEDULES_SQL),
    q<InsightRow>(CAROUSEL_INSIGHTS_SQL),
    q<CarouselIdeaRow>(CAROUSEL_IDEAS_SQL),
    q<{ value: unknown }>(CAROUSEL_REQUIRE_APPROVAL_SQL),
  ]);
  return {
    posts: posts.rows,
    attempts: attempts.rows,
    schedules: schedules.rows,
    insights: insights.rows,
    ideas: ideas.rows,
    requireApproval: settingIsOn(approval.rows),
  };
}
