import type { HubQuery } from '@/lib/social-hub/db';
import { settingIsOn, type InsightRow } from '@/lib/social-hub/queries/reels';
import { forVertical, insightRows, type SpineRead } from '@/lib/social-hub/queries/spine';

/**
 * Carousel reads (SELECT only). Content lives in schema `social`: post idea =
 * news story (`story_id`); content version = a `social.posts` row. Only
 * `pipeline` rows count (dev renders never post; db/social_schema.sql).
 * Slots, attempts, approvals and insights come from the shared spine read
 * (queries/spine.ts, D48), mapped to the row shapes below.
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
  /** story-scoring@2 answers (Jev probabilities by question id) and how many of the three score questions passed. */
  answers?: Record<string, number> | null;
  passes?: number | null;
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
       c->'answers' AS answers, (c->>'passes')::int AS passes,
       latest.started_at::text AS run_started_at,
       (SELECT count(*)::int FROM social.posts p WHERE p.story_id = c->>'id' AND p.origin = 'pipeline') AS post_count,
       (SELECT max(p.created_at)::text FROM social.posts p WHERE p.story_id = c->>'id' AND p.origin = 'pipeline') AS last_post_at,
       EXISTS (SELECT 1 FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
                WHERE ci.vertical = 'carousels' AND ci.idea_ref = c->>'id' AND a.status = 'published') AS published,
       EXISTS (SELECT 1 FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id
                WHERE ci.vertical = 'carousels' AND ci.idea_ref = c->>'id' AND s.status IN ('scheduled', 'publishing')) AS scheduled
  FROM latest, jsonb_array_elements(latest.record->'selection'->'shortlist') c`;

export const CAROUSEL_REQUIRE_APPROVAL_SQL = `SELECT value FROM social.settings WHERE key = 'require_approval'`;

export async function readCarousels(q: HubQuery, spine: SpineRead): Promise<CarouselsRead> {
  const [posts, ideas, approval] = await Promise.all([
    q<CarouselPostRow>(CAROUSEL_POSTS_SQL),
    q<CarouselIdeaRow>(CAROUSEL_IDEAS_SQL),
    q<{ value: unknown }>(CAROUSEL_REQUIRE_APPROVAL_SQL),
  ]);
  const mine = forVertical(spine, 'carousels');
  return {
    posts: posts.rows,
    // Slots, attempts and insights come from the shared spine read (D48); the post is the item.
    attempts: mine.attempts.filter((a) => a.content_ref).map((a) => ({
      attempt_id: a.attempt_id, post_id: a.content_ref!, status: a.status, trigger: a.trigger,
      requested_at: a.requested_at, finished_at: a.finished_at, media_id: a.media_id, permalink: a.permalink, error: a.error,
      schedule_id: a.schedule_id, slot: a.slot, publish_at: a.publish_at, approved_at: a.approved_at,
    })),
    schedules: mine.schedules.filter((r) => r.content_ref).map((r) => ({
      schedule_id: r.schedule_id, post_id: r.content_ref!, ny_date: r.ny_date, slot: r.slot, publish_at: r.publish_at,
      status: r.status, source: r.source, error: r.error, approved_at: r.approved_at,
    })),
    insights: insightRows(mine.insights, 'carousels'),
    ideas: ideas.rows,
    requireApproval: settingIsOn(approval.rows),
  };
}
