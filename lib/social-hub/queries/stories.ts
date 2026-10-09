import type { HubQuery } from '@/lib/social-hub/db';

/**
 * IG Stories reads (schema `stories`, SELECT only). A set is one post and its
 * frames are its pages (spec §3). Stories have no posting_schedule or
 * publish_attempts: `stories.sets` is queue and schedule (docs/social-overnight.md).
 */

export type StorySetRow = {
  set_id: string;
  series: string;
  ny_date: string;
  status: string;
  trigger: string;
  style: string;
  payload: Record<string, unknown> | null;
  publish_at: string | null;
  flagged: boolean;
  error: string | null;
  spend_usd: number | string;
  approved_at: string | null;
  published_at: string | null;
  built_at: string | null;
  created_at: string;
  feedback_verdict: string | null;
  feedback_tags: string[] | null;
  chosen_origins: string[] | null;
};

export type StoryFrameRow = {
  frame_id: string;
  set_id: string;
  seq: number;
  role: string;
  template: string | null;
  backdrop: string;
  storage_path: string | null;
  flagged: boolean;
  ig_media_id: string | null;
  published_at: string | null;
};

export type StoryInsightRow = {
  frame_id: string;
  captured_at: string;
  final: boolean;
  reach: number | null;
  views: number | null;
  replies: number | null;
  shares: number | null;
  follows: number | null;
  profile_visits: number | null;
  total_interactions: number | null;
  taps_forward: number | null;
  taps_back: number | null;
  exits: number | null;
  swipe_forward: number | null;
};

/** One open idea in a series' standing pool (stories.pool, lib/stories/pool.ts). */
export type StoryPoolRow = {
  pool_id: string;
  series: string;
  key: string;
  origin: string;
  ref: string;
  title: string;
  source: string | null;
  score: number | string | null;
  refreshed_at: string;
};

export type StoriesRead = {
  sets: StorySetRow[];
  frames: StoryFrameRow[];
  insights: StoryInsightRow[];
  /** Each series' open pool ideas, best first. Empty while stories.pool is not applied. */
  pool: StoryPoolRow[];
};

/** Requested / building sets have no content yet; rejected sets never post. */
export const STORY_SETS_SQL = `
SELECT s.id AS set_id, s.series, s.ny_date::text AS ny_date, s.status, s.trigger, s.style, s.payload,
       s.publish_at::text AS publish_at, s.flagged, s.error, s.spend_usd,
       s.approved_at::text AS approved_at, s.published_at::text AS published_at,
       s.built_at::text AS built_at, s.created_at::text AS created_at,
       fb.verdict AS feedback_verdict, fb.tags AS feedback_tags,
       (SELECT array_agg(DISTINCT c.origin ORDER BY c.origin) FROM stories.candidates c
         WHERE c.set_id = s.id AND c.chosen) AS chosen_origins
  FROM stories.sets s
  LEFT JOIN LATERAL (
    SELECT verdict, tags FROM stories.feedback WHERE set_id = s.id ORDER BY created_at DESC LIMIT 1
  ) fb ON true
 WHERE s.status NOT IN ('requested', 'building', 'rejected')
 ORDER BY s.ny_date DESC, s.created_at DESC`;

export const STORY_FRAMES_SQL = `
SELECT f.id AS frame_id, f.set_id, f.seq, f.role, f.template, f.backdrop, f.storage_path, f.flagged,
       f.ig_media_id, f.published_at::text AS published_at
  FROM stories.frames f
  JOIN stories.sets s ON s.id = f.set_id
 WHERE s.status NOT IN ('requested', 'building', 'rejected')
 ORDER BY f.set_id, f.seq`;

export const STORY_INSIGHTS_SQL = `
SELECT i.frame_id, i.captured_at::text AS captured_at, i.final, i.reach, i.views, i.replies, i.shares,
       i.follows, i.profile_visits, i.total_interactions, i.taps_forward, i.taps_back, i.exits, i.swipe_forward
  FROM stories.insights i
 ORDER BY i.frame_id, i.captured_at`;

/** The open pool: what the next build of each series chooses from. */
export const STORY_POOL_SQL = `
SELECT p.id AS pool_id, p.series, p.key, p.origin, p.ref, p.title, p.payload->>'source' AS source,
       p.score, p.refreshed_at::text AS refreshed_at
  FROM stories.pool p
 WHERE p.used_at IS NULL
 ORDER BY p.series, p.score DESC NULLS LAST, p.title
 LIMIT 600`;

export async function readStories(q: HubQuery): Promise<StoriesRead> {
  const [sets, frames, insights, pool] = await Promise.all([
    q<StorySetRow>(STORY_SETS_SQL),
    q<StoryFrameRow>(STORY_FRAMES_SQL),
    q<StoryInsightRow>(STORY_INSIGHTS_SQL),
    // The pool table arrives with the schema (db/stories_schema.sql); until then the bench is empty, not the vertical broken.
    q<StoryPoolRow>(STORY_POOL_SQL).catch((err: unknown) => {
      if (/stories\.pool|does not exist/.test(err instanceof Error ? err.message : String(err))) return { rows: [] as StoryPoolRow[] };
      throw err;
    }),
  ]);
  return { sets: sets.rows, frames: frames.rows, insights: insights.rows, pool: pool.rows };
}
