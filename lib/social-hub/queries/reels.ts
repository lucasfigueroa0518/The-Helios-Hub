import type { HubQuery } from '@/lib/social-hub/db';
import { forVertical, insightRows, type SpineRead } from '@/lib/social-hub/queries/spine';

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

/**
 * A finished video the night made that holds no slot yet: nothing scheduled
 * it (publishing off, or no window left) and nobody rejected it. It waits on
 * a person, so the hub shows it as made content (Today's Content).
 */
export type ReelMadeRow = {
  video_job_id: string;
  post_idea_id: string;
  ny_date: string;
  video_storage_path: string;
  video_finished_at: string;
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
  /** Made videos with no slot, attempt or rejection (newest per idea, last three days). */
  made: ReelMadeRow[];
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

/**
 * The content behind each (idea, video) the spine read names (D48): the video
 * and its visual, and the idea's score, copy and headline, preferring the
 * video's own slate as before.
 */
export const REEL_FACTS_SQL = `
SELECT r.idea::text AS post_idea_id, r.video::text AS video_job_id,
       left(v.motion_prompt, 500) AS motion_prompt, v.video_storage_path,
       v.finished_at::text AS video_finished_at, v.slate_id AS video_slate_id, vis.render AS visual_render,
       score.chosen_framework, score.chosen_bucket, score.blockbuster, score.net, score.origin,
       copy.on_screen_copy, copy.full_story_below, src.headline
  FROM unnest($1::uuid[], $2::uuid[]) AS r(idea, video)
  LEFT JOIN reels.video_jobs v ON v.id = r.video
  LEFT JOIN reels.visual_jobs vis ON vis.id = v.visual_job_id
  ${SCORE_LATERAL.replaceAll('%IDEA%', 'r.idea')}`;

export const REEL_MADE_SQL = `
SELECT DISTINCT ON (v.post_idea_id)
       v.id::text AS video_job_id, v.post_idea_id::text AS post_idea_id,
       coalesce(sl.ny_date, (v.finished_at AT TIME ZONE 'America/New_York')::date)::text AS ny_date,
       v.video_storage_path, v.finished_at::text AS video_finished_at, v.slate_id AS video_slate_id,
       score.chosen_framework, score.chosen_bucket, score.net, copy.on_screen_copy, src.headline
  FROM reels.video_jobs v
  LEFT JOIN reels.score_slates sl ON sl.id = v.slate_id
  ${SCORE_LATERAL.replaceAll('%IDEA%', 'v.post_idea_id')}
 WHERE v.status = 'ok'
   AND v.video_storage_path IS NOT NULL
   AND v.finished_at > now() - interval '3 days'
   AND NOT EXISTS (SELECT 1 FROM social_hub.schedule x WHERE x.vertical = 'reels' AND x.idea_ref = v.post_idea_id::text)
   AND NOT EXISTS (
     SELECT 1 FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
      WHERE a.vertical = 'reels' AND ci.idea_ref = v.post_idea_id::text)
   AND NOT EXISTS (
     SELECT 1 FROM social_hub.approvals ap JOIN social_hub.content_items ci ON ci.id = ap.content_item_id
      WHERE ci.vertical = 'reels' AND ci.native_ref = v.id::text AND ap.decision = 'rejected')
 ORDER BY v.post_idea_id, v.finished_at DESC`;

/** Each posted song's type and genre (attempts carry the audio id in their payload). */
export const REEL_SONGS_SQL = `SELECT audio_id, audio_type, genre FROM reels.songs WHERE audio_id = ANY($1::text[])`;

/** The idea pool from the newest slate (spec §7 Ideas): scores as the night ranked them. */
export const REEL_IDEAS_SQL = `
WITH latest AS (
  SELECT id, scored_at FROM reels.score_slates ORDER BY scored_at DESC LIMIT 1
)
SELECT s.post_idea_id, src.headline, s.net, s.rank, s.selected, s.origin, latest.scored_at::text AS scored_at,
       ps.published,
       EXISTS (SELECT 1 FROM social_hub.schedule x
                WHERE x.vertical = 'reels' AND x.idea_ref = s.post_idea_id::text AND x.status IN ('scheduled', 'publishing')) AS scheduled,
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

/** Source articles behind every idea that reached a slot or an attempt (spec §7 Sources); the ideas come from the spine read. */
export const REEL_SOURCES_SQL = `
SELECT DISTINCT m.post_idea_id, s.canonical_url AS url, s.headline
  FROM reels.post_idea_members m
  JOIN reels.sources s ON s.id = m.source_id
 WHERE m.role <> 'merged_duplicate'
   AND m.post_idea_id = ANY($1::uuid[])`;

export const REEL_REQUIRE_APPROVAL_SQL = `SELECT value FROM reels.settings WHERE key = 'require_approval'`;

/** Missing row = on (docs/social-overnight.md: "treated as on when the row is missing"). */
export function settingIsOn(rows: Array<{ value: unknown }>): boolean {
  const value = rows[0]?.value;
  return value !== false && value !== 'false';
}

type ReelFacts = Pick<ReelAttemptRow,
  'motion_prompt' | 'video_storage_path' | 'video_finished_at' | 'video_slate_id' | 'visual_render' | 'chosen_framework' | 'chosen_bucket'
  | 'blockbuster' | 'net' | 'origin' | 'on_screen_copy' | 'full_story_below' | 'headline'> & { post_idea_id: string; video_job_id: string | null };

const NO_FACTS: Omit<ReelFacts, 'post_idea_id' | 'video_job_id'> = {
  motion_prompt: null, video_storage_path: null, video_finished_at: null, video_slate_id: null, visual_render: null, chosen_framework: null,
  chosen_bucket: null, blockbuster: null, net: null, origin: null, on_screen_copy: null, full_story_below: null, headline: null,
};

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export async function readReels(q: HubQuery, spine: SpineRead): Promise<ReelsRead> {
  const mine = forVertical(spine, 'reels');
  // The (idea, video) pairs the spine rows name, once each.
  const pairs = new Map<string, { idea: string; video: string | null }>();
  for (const r of [...mine.attempts, ...mine.schedules]) {
    if (r.idea_ref) pairs.set(`${r.idea_ref}|${r.content_ref ?? ''}`, { idea: r.idea_ref, video: r.content_ref });
  }
  const list = [...pairs.values()];
  const ideaIds = [...new Set(list.map((p) => p.idea))];
  const audioIds = [...new Set(mine.attempts.map((a) => str(a.payload?.audio_id)).filter((x): x is string => Boolean(x)))];
  const [facts, songs, ideas, made, approval] = await Promise.all([
    q<ReelFacts>(REEL_FACTS_SQL, [list.map((p) => p.idea), list.map((p) => p.video)]),
    q<{ audio_id: string; audio_type: string | null; genre: string | null }>(REEL_SONGS_SQL, [audioIds]),
    q<ReelIdeaRow>(REEL_IDEAS_SQL),
    q<ReelMadeRow>(REEL_MADE_SQL),
    q<{ value: unknown }>(REEL_REQUIRE_APPROVAL_SQL),
  ]);
  const sources = await q<ReelSourceRow>(REEL_SOURCES_SQL, [[...new Set([...ideaIds, ...made.rows.map((m) => m.post_idea_id)])]]);
  const factsOf = new Map(facts.rows.map((f) => [`${f.post_idea_id}|${f.video_job_id ?? ''}`, f]));
  const songOf = new Map(songs.rows.map((s) => [s.audio_id, s]));
  const fact = (idea: string | null, video: string | null) => {
    const { post_idea_id: _idea, video_job_id: _video, ...rest } = factsOf.get(`${idea}|${video ?? ''}`) ?? { post_idea_id: '', video_job_id: null, ...NO_FACTS };
    return rest;
  };
  return {
    // Lifecycle from the shared spine read (D48); content from the facts above.
    attempts: mine.attempts.map((a) => {
      const song = songOf.get(str(a.payload?.audio_id) ?? '');
      return {
        attempt_id: a.attempt_id, status: a.status, trigger: a.trigger, media_id: a.media_id,
        post_idea_id: a.idea_ref ?? '', video_job_id: a.content_ref,
        requested_at: a.requested_at, finished_at: a.finished_at, permalink: a.permalink, error: a.error, caption: a.caption,
        song_title: str(a.payload?.song_title), song_artist: str(a.payload?.song_artist), graduation_strategy: str(a.payload?.graduation_strategy),
        audio_type: song?.audio_type ?? null, genre: song?.genre ?? null,
        schedule_id: a.schedule_id, schedule_slot: a.slot, schedule_publish_at: a.publish_at, approved_at: a.approved_at,
        ...fact(a.idea_ref, a.content_ref),
      };
    }),
    schedules: mine.schedules.map((r) => {
      const f = fact(r.idea_ref, r.content_ref);
      return {
        schedule_id: r.schedule_id, post_idea_id: r.idea_ref ?? '', video_job_id: r.content_ref, ny_date: r.ny_date, slot: r.slot,
        publish_at: r.publish_at, status: r.status, source: r.source, error: r.error, approved_at: r.approved_at, created_at: r.created_at,
        video_storage_path: f.video_storage_path, video_finished_at: f.video_finished_at, video_slate_id: f.video_slate_id,
        chosen_framework: f.chosen_framework, chosen_bucket: f.chosen_bucket, net: f.net, on_screen_copy: f.on_screen_copy, headline: f.headline,
      };
    }),
    made: made.rows,
    insights: insightRows(mine.insights, 'reels'),
    ideas: ideas.rows,
    sources: sources.rows,
    requireApproval: settingIsOn(approval.rows),
  };
}
