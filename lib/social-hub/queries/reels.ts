import type { HubQuery } from '@/lib/social-hub/db';

/**
 * Trial Reels reads (SELECT only). The attempt query copies the shape of
 * `loadPublishedReels` in lib/reels/analytics/performance-store.ts, widened
 * to every attempt status; mix tests never count (as there).
 */

export type ReelAttemptRow = {
  attempt_id: string;
  status: string;
  trigger: string;
  media_id: string | null;
  post_idea_id: string;
  video_job_id: string | null;
  requested_at: string;
  finished_at: string | null;
  permalink: string | null;
  error: string | null;
  caption: string | null;
  song_title: string | null;
  song_artist: string | null;
  graduation_strategy: string | null;
  motion_prompt: string | null;
  video_storage_path: string | null;
  video_finished_at: string | null;
  video_slate_id: string | null;
  visual_render: { colorProfile?: string } | null;
  audio_type: string | null;
  genre: string | null;
  schedule_id: string | null;
  schedule_slot: string | null;
  schedule_publish_at: string | null;
  approved_at: string | null;
  chosen_framework: string | null;
  chosen_bucket: string | null;
  blockbuster: number | string | null;
  net: number | string | null;
  origin: string | null;
  on_screen_copy: string | null;
  full_story_below: boolean | null;
  headline: string | null;
};

export type ReelScheduleRow = {
  schedule_id: string;
  post_idea_id: string;
  video_job_id: string | null;
  ny_date: string;
  slot: string;
  publish_at: string;
  status: string;
  source: string;
  error: string | null;
  approved_at: string | null;
  created_at: string;
  video_storage_path: string | null;
  video_finished_at: string | null;
  video_slate_id: string | null;
  chosen_framework: string | null;
  chosen_bucket: string | null;
  net: number | string | null;
  on_screen_copy: string | null;
  headline: string | null;
};

export type InsightRow = { media_id: string; ny_date: string; [metric: string]: unknown };

export type ReelIdeaRow = {
  post_idea_id: string;
  headline: string | null;
  net: number | string | null;
  rank: number | null;
  selected: boolean;
  origin: string | null;
  scored_at: string;
  published: boolean | null;
  scheduled: boolean;
  has_video: boolean;
  video_count: number;
  last_video_at: string | null;
};

export type ReelSourceRow = { post_idea_id: string; url: string; headline: string | null };

export type ReelsRead = {
  attempts: ReelAttemptRow[];
  schedules: ReelScheduleRow[];
  insights: InsightRow[];
  ideas: ReelIdeaRow[];
  sources: ReelSourceRow[];
  requireApproval: boolean;
};

const SCORE_LATERAL = `
       LEFT JOIN LATERAL (
         SELECT s.chosen_framework, s.chosen_bucket, s.blockbuster, s.net, s.origin
           FROM reels.idea_scores s
           JOIN reels.score_slates sl ON sl.id = s.slate_id
          WHERE s.post_idea_id = %IDEA%
          ORDER BY (v.slate_id IS NOT NULL AND s.slate_id = v.slate_id) DESC, sl.scored_at DESC
          LIMIT 1
       ) score ON true
       LEFT JOIN LATERAL (
         SELECT c.on_screen_copy, c.full_story_below
           FROM reels.idea_copy c
           JOIN reels.score_slates sl ON sl.id = c.slate_id
          WHERE c.post_idea_id = %IDEA%
            AND c.status = 'ok'
          ORDER BY (v.slate_id IS NOT NULL AND c.slate_id = v.slate_id) DESC, sl.scored_at DESC
          LIMIT 1
       ) copy ON true
       LEFT JOIN LATERAL (
         SELECT s.headline
           FROM reels.post_idea_members m
           JOIN reels.sources s ON s.id = m.source_id
          WHERE m.post_idea_id = %IDEA%
          ORDER BY CASE m.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END, m.joined_at
          LIMIT 1
       ) src ON true`;

export const REEL_ATTEMPTS_SQL = `
SELECT a.id AS attempt_id, a.status, a.trigger, a.media_id, a.post_idea_id, a.video_job_id,
       a.requested_at::text AS requested_at, a.finished_at::text AS finished_at,
       a.permalink, a.error, a.caption, a.song_title, a.song_artist, a.graduation_strategy,
       left(v.motion_prompt, 500) AS motion_prompt, v.video_storage_path,
       v.finished_at::text AS video_finished_at, v.slate_id AS video_slate_id,
       vis.render AS visual_render, song.audio_type, song.genre,
       sched.id AS schedule_id, sched.slot AS schedule_slot,
       sched.publish_at::text AS schedule_publish_at, sched.approved_at::text AS approved_at,
       score.chosen_framework, score.chosen_bucket, score.blockbuster, score.net, score.origin,
       copy.on_screen_copy, copy.full_story_below, src.headline
  FROM reels.publish_attempts a
  LEFT JOIN reels.video_jobs v ON v.id = a.video_job_id
  LEFT JOIN reels.visual_jobs vis ON vis.id = v.visual_job_id
  LEFT JOIN reels.songs song ON song.audio_id = a.audio_id
  LEFT JOIN LATERAL (
    SELECT id, slot, publish_at, approved_at
      FROM reels.posting_schedule
     WHERE publish_attempt_id = a.id
     ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END, publish_at DESC
     LIMIT 1
  ) sched ON true
  ${SCORE_LATERAL.replaceAll('%IDEA%', 'a.post_idea_id')}
 WHERE a.trigger <> 'mix_test'
 ORDER BY a.requested_at DESC`;

/** Slots with no attempt yet: scheduled, cancelled-unapproved, or failed before a try. */
export const REEL_SCHEDULES_SQL = `
SELECT ps.id AS schedule_id, ps.post_idea_id, ps.video_job_id, ps.ny_date::text AS ny_date, ps.slot,
       ps.publish_at::text AS publish_at, ps.status, ps.source, ps.error,
       ps.approved_at::text AS approved_at, ps.created_at::text AS created_at,
       v.video_storage_path, v.finished_at::text AS video_finished_at, v.slate_id AS video_slate_id,
       score.chosen_framework, score.chosen_bucket, score.net,
       copy.on_screen_copy, src.headline
  FROM reels.posting_schedule ps
  LEFT JOIN reels.video_jobs v ON v.id = ps.video_job_id
  ${SCORE_LATERAL.replaceAll('%IDEA%', 'ps.post_idea_id')}
 WHERE ps.publish_attempt_id IS NULL
   -- A slot marked published with no attempt is the "already published" case; the attempt row is the post.
   AND ps.status <> 'published'
 ORDER BY ps.publish_at DESC`;

export const REEL_INSIGHTS_SQL = `
SELECT media_id, ny_date::text AS ny_date, views, reach, likes, comments, saved, shares, reposts,
       total_interactions, avg_watch_time_ms, total_watch_time_ms, skip_rate
  FROM reels.media_insights
 ORDER BY media_id, ny_date`;

/** The idea pool from the newest slate (spec §7 Ideas): scores as the night ranked them. */
export const REEL_IDEAS_SQL = `
WITH latest AS (
  SELECT id, scored_at FROM reels.score_slates ORDER BY scored_at DESC LIMIT 1
)
SELECT s.post_idea_id, src.headline, s.net, s.rank, s.selected, s.origin, latest.scored_at::text AS scored_at,
       ps.published,
       EXISTS (SELECT 1 FROM reels.posting_schedule x
                WHERE x.post_idea_id = s.post_idea_id AND x.status IN ('scheduled', 'publishing')) AS scheduled,
       EXISTS (SELECT 1 FROM reels.video_jobs j WHERE j.post_idea_id = s.post_idea_id AND j.status = 'ok') AS has_video,
       (SELECT count(*)::int FROM reels.video_jobs j WHERE j.post_idea_id = s.post_idea_id AND j.status = 'ok') AS video_count,
       (SELECT max(j.finished_at)::text FROM reels.video_jobs j WHERE j.post_idea_id = s.post_idea_id AND j.status = 'ok') AS last_video_at
  FROM latest
  JOIN reels.idea_scores s ON s.slate_id = latest.id
  LEFT JOIN reels.published_status ps ON ps.post_idea_id = s.post_idea_id
  LEFT JOIN LATERAL (
    SELECT so.headline
      FROM reels.post_idea_members m
      JOIN reels.sources so ON so.id = m.source_id
     WHERE m.post_idea_id = s.post_idea_id
     ORDER BY CASE m.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END, m.joined_at
     LIMIT 1
  ) src ON true
 ORDER BY s.rank NULLS LAST, s.net DESC NULLS LAST
 LIMIT 200`;

/** Source articles behind every idea that reached a slot or an attempt (spec §7 Sources). */
export const REEL_SOURCES_SQL = `
SELECT DISTINCT m.post_idea_id, s.canonical_url AS url, s.headline
  FROM reels.post_idea_members m
  JOIN reels.sources s ON s.id = m.source_id
 WHERE m.role <> 'merged_duplicate'
   AND m.post_idea_id IN (
     SELECT post_idea_id FROM reels.publish_attempts WHERE trigger <> 'mix_test'
     UNION SELECT post_idea_id FROM reels.posting_schedule
   )`;

export const REEL_REQUIRE_APPROVAL_SQL = `SELECT value FROM reels.settings WHERE key = 'require_approval'`;

/** Missing row = on (docs/social-overnight.md: "treated as on when the row is missing"). */
export function settingIsOn(rows: Array<{ value: unknown }>): boolean {
  const value = rows[0]?.value;
  return value !== false && value !== 'false';
}

export async function readReels(q: HubQuery): Promise<ReelsRead> {
  const [attempts, schedules, insights, ideas, sources, approval] = await Promise.all([
    q<ReelAttemptRow>(REEL_ATTEMPTS_SQL),
    q<ReelScheduleRow>(REEL_SCHEDULES_SQL),
    q<InsightRow>(REEL_INSIGHTS_SQL),
    q<ReelIdeaRow>(REEL_IDEAS_SQL),
    q<ReelSourceRow>(REEL_SOURCES_SQL),
    q<{ value: unknown }>(REEL_REQUIRE_APPROVAL_SQL),
  ]);
  return {
    attempts: attempts.rows,
    schedules: schedules.rows,
    insights: insights.rows,
    ideas: ideas.rows,
    sources: sources.rows,
    requireApproval: settingIsOn(approval.rows),
  };
}
