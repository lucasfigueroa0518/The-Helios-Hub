import type { HubQuery } from '@/lib/social-hub/db';
import { settingIsOn, type InsightRow } from '@/lib/social-hub/queries/reels';
import { forVertical, insightRows, type SpineRead } from '@/lib/social-hub/queries/spine';

/**
 * Field Notes reads (SELECT only; planning/Field Notes/CONTRACT.md). Content lives in schema
 * `field_notes`: a post is a field_notes.posts row (a photo carousel made from one tip), the
 * Ideas view is the tips (field_notes.tips). Slots, attempts, approvals and insights come
 * from the shared spine read (queries/spine.ts, D48). Nothing is scored or ranked on a page view.
 */

export type FieldNotesPostRow = {
  post_id: string;
  run_id: string | null;
  /** The first tip (older rows have only this). */
  tip_id: string | null;
  /** Every tip on the post, in slide order. */
  tip_ids: string[];
  /** Each tip's subject and source, in slide order, for the review screen's source links. */
  tips: Array<{ tip_id: string; subject: string | null; source_url: string | null; source_label: string | null }>;
  seq: number;
  slug: string;
  ny_date: string;
  status: string;
  caption: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  approved_by: string | null;
  /** The tip's subject and branch, for the title and the review screen. */
  subject: string | null;
  branch: string | null;
  source_url: string | null;
  source_label: string | null;
  /** Slide outline the hub paints: each slide's kind, headline and the rest of its text. */
  render: Record<string, unknown> | null;
  render_version: number;
  slide_count: number | null;
  has_slide_objects: boolean;
  fit_problems: unknown;
  render_problems: unknown;
};

export type FieldNotesAttemptRow = {
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

export type FieldNotesScheduleRow = {
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

export type FieldNotesRunRow = {
  id: string;
  kind: string;
  status: string;
  trigger: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  total_usd: number | null;
  stop_reason: string | null;
  error: string | null;
};

/** One tip (field_notes.tips): an idea for a post. */
export type FieldNotesTipRow = {
  tip_id: string;
  created_at: string;
  updated_at: string;
  source_kind: string;
  source_url: string | null;
  source_label: string | null;
  subject: string;
  branch: string;
  use_with_result: string;
  score: number | null;
  status: string;
  /** The post made from it that is not rejected, when there is one. */
  post_id: string | null;
};

export type FieldNotesRead = {
  posts: FieldNotesPostRow[];
  attempts: FieldNotesAttemptRow[];
  schedules: FieldNotesScheduleRow[];
  insights: InsightRow[];
  tips: FieldNotesTipRow[];
  /** The newest run (any outcome), for the type page. */
  latestRun: FieldNotesRunRow | null;
  requireApproval: boolean;
  publishingLive: boolean;
};

export const FIELD_NOTES_POSTS_SQL = `
SELECT p.id::text AS post_id, p.run_id::text AS run_id, p.tip_id::text AS tip_id,
       (CASE WHEN cardinality(p.tip_ids) > 0 THEN p.tip_ids::text[] WHEN p.tip_id IS NOT NULL THEN ARRAY[p.tip_id::text] ELSE '{}'::text[] END) AS tip_ids,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('tip_id', pt.id::text, 'subject', pt.subject, 'source_url', pt.source_url, 'source_label', pt.source_label) ORDER BY u.ord), '[]'::jsonb)
          FROM unnest(CASE WHEN cardinality(p.tip_ids) > 0 THEN p.tip_ids WHEN p.tip_id IS NOT NULL THEN ARRAY[p.tip_id] ELSE '{}'::uuid[] END) WITH ORDINALITY AS u(id, ord)
          JOIN field_notes.tips pt ON pt.id = u.id) AS tips,
       p.seq, p.slug, p.ny_date::text AS ny_date, p.status,
       p.caption, p.created_at::text AS created_at, p.updated_at::text AS updated_at, p.published_at::text AS published_at, p.approved_by,
       t.subject, COALESCE(t.leaf, t.branch) AS branch, t.source_url, t.source_label,
       -- Slide outline the hub paints: each slide's kind, its headline block and the text of the rest.
       jsonb_build_object('slides', (
         SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind', s.slide->'kind',
           'headline', (SELECT b->>'text' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.slide->'blocks') = 'array' THEN s.slide->'blocks' ELSE '[]'::jsonb END) AS b WHERE b->>'role' = 'headline' LIMIT 1),
           'body', (SELECT string_agg(b->>'text', ' · ') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.slide->'blocks') = 'array' THEN s.slide->'blocks' ELSE '[]'::jsonb END) AS b WHERE b->>'role' <> 'headline')
         ) ORDER BY s.ord), '[]'::jsonb)
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.slides) = 'array' THEN p.slides ELSE '[]'::jsonb END) WITH ORDINALITY AS s(slide, ord)
       )) AS render,
       p.render_version,
       COALESCE(jsonb_array_length(p.slide_objects), jsonb_array_length(p.slides)) AS slide_count,
       (jsonb_typeof(p.slide_objects) = 'array' AND jsonb_array_length(p.slide_objects) > 0) AS has_slide_objects,
       p.fit_problems, p.render_problems
  FROM field_notes.posts p
  LEFT JOIN field_notes.tips t ON t.id = p.tip_id
 ORDER BY p.created_at DESC`;

export const FIELD_NOTES_LATEST_RUN_SQL = `
SELECT id::text AS id, kind, status, trigger, requested_at::text AS requested_at, started_at::text AS started_at,
       finished_at::text AS finished_at, total_usd::float8 AS total_usd, stop_reason, error
  FROM field_notes.runs
 ORDER BY COALESCE(started_at, requested_at) DESC
 LIMIT 1`;

export const FIELD_NOTES_TIPS_SQL = `
SELECT t.id::text AS tip_id, t.created_at::text AS created_at, t.updated_at::text AS updated_at, t.source_kind, t.source_url, t.source_label,
       t.subject, COALESCE(t.leaf, t.branch) AS branch, t.use_with_result, t.score::float8 AS score, t.status,
       (SELECT p.id::text FROM field_notes.posts p WHERE (p.tip_id = t.id OR t.id = ANY(p.tip_ids)) AND p.status <> 'rejected' ORDER BY p.created_at DESC LIMIT 1) AS post_id
  FROM field_notes.tips t
 ORDER BY t.created_at DESC`;

export const FIELD_NOTES_SETTINGS_SQL = `SELECT key, value FROM field_notes.settings WHERE key IN ('require_approval', 'publishing_live')`;

export async function readFieldNotes(q: HubQuery, spine: SpineRead): Promise<FieldNotesRead> {
  const [posts, run, tips, settings] = await Promise.all([
    q<FieldNotesPostRow>(FIELD_NOTES_POSTS_SQL),
    q<FieldNotesRunRow>(FIELD_NOTES_LATEST_RUN_SQL),
    q<FieldNotesTipRow>(FIELD_NOTES_TIPS_SQL),
    q<{ key: string; value: unknown }>(FIELD_NOTES_SETTINGS_SQL),
  ]);
  const setting = (key: string) => settings.rows.filter((r) => r.key === key);
  const mine = forVertical(spine, 'field_notes');
  return {
    posts: posts.rows,
    attempts: mine.attempts.filter((a) => a.content_ref).map((a) => ({
      attempt_id: a.attempt_id, post_id: a.content_ref!, status: a.status, trigger: a.trigger,
      requested_at: a.requested_at, finished_at: a.finished_at, media_id: a.media_id, permalink: a.permalink, error: a.error,
      schedule_id: a.schedule_id, slot: a.slot, publish_at: a.publish_at, approved_at: a.approved_at,
    })),
    schedules: mine.schedules.filter((r) => r.content_ref).map((r) => ({
      schedule_id: r.schedule_id, post_id: r.content_ref!, ny_date: r.ny_date, slot: r.slot, publish_at: r.publish_at,
      status: r.status, source: r.source, error: r.error, approved_at: r.approved_at,
    })),
    insights: insightRows(mine.insights, 'field_notes'),
    tips: tips.rows,
    latestRun: run.rows[0] ?? null,
    requireApproval: settingIsOn(setting('require_approval')),
    // Off unless it is literally true (lib/field-notes/settings.ts).
    publishingLive: setting('publishing_live')[0]?.value === true,
  };
}
