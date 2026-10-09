import { dbQuery } from '@/lib/db';
import { PASSING_REELS_PER_NIGHT } from '@/lib/reels/config';
import { getSetting } from '@/lib/reels/music/store';
import { reelsSpine } from '@/lib/reels/publish/items';
import { reelsForOpenWindows } from '@/lib/reels/publish/slots';
import { calendarDateKey } from '@/lib/reels/schedule';
import { dailyFill, type DailyFill } from '@/lib/social-hub/fill';

/**
 * Trial Reels' daily fill (D54). The 1:00 AM run fills the day's quota
 * (PASSING_REELS_PER_NIGHT) less the reels people placed for that New York
 * day, one per posting window still open. Ideas a person already placed are
 * not made again, and a carryover idea whose finished video never posted
 * takes its slot with that video instead of a new copy and render: the one
 * explicit exception to SH-59 (D55).
 */

/** Tonight's fill: the quota, the reels people placed for today, what is left. */
export async function reelsFill(now = new Date()): Promise<DailyFill> {
  return dailyFill(reelsSpine, 'reels', calendarDateKey(now), await reelsPerDay());
}

/** The day's quota: the `posts_per_day` row of reels.settings, else the default of three. */
export async function reelsPerDay(): Promise<number> {
  const raw = await getSetting<unknown>('posts_per_day');
  // A missing row is the default, not zero (Number(null) is 0).
  const value = raw == null ? NaN : Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : PASSING_REELS_PER_NIGHT;
}

/** Reels the night makes: one per window still open, never more than the fill leaves. */
export function reelsTonight(openWindows: number, fill: DailyFill): number {
  return reelsForOpenWindows(openWindows, fill.making);
}

/**
 * Of these ideas, the ones a person already put on the calendar (a `user`
 * slot waiting or posting). The daily fill counted them; the night leaves
 * them out of its slots so it doesn't make them a second time.
 */
export async function placedIdeas(ideaIds: readonly string[]): Promise<Set<string>> {
  if (ideaIds.length === 0) return new Set();
  const { rows } = await dbQuery<{ idea_ref: string }>(
    `SELECT DISTINCT idea_ref FROM social_hub.schedule
      WHERE vertical = 'reels' AND source = 'user' AND status IN ('scheduled', 'publishing')
        AND idea_ref = ANY($1::text[])`,
    [ideaIds],
  );
  return new Set(rows.map((row) => row.idea_ref));
}

/**
 * Carryover ideas on this slate that already have a finished video to reuse
 * (D55), idea → video job. The video must be the idea's newest finished one,
 * made on an earlier New York day than the slate, still in Storage, with its
 * song and its own slate's copy (what posting reads), and never rejected,
 * never tried on Instagram (anything but a clean failure, as D41 rules for
 * carousels) and never posted. Nothing for the idea may be in the making
 * (a queued or running video, an active finish request), and this slate
 * must not have made it a video of its own.
 */
export async function reusableVideos(slateId: string, ideaIds: readonly string[]): Promise<Map<string, string>> {
  if (ideaIds.length === 0) return new Map();
  const { rows } = await dbQuery<{ post_idea_id: string; video_job_id: string }>(
    `WITH slate AS (SELECT id, ny_date FROM reels.score_slates WHERE id = $1::uuid),
     newest AS (
       SELECT DISTINCT ON (v.post_idea_id) v.id, v.post_idea_id, v.slate_id, v.video_storage_path
         FROM reels.video_jobs v
        WHERE v.post_idea_id = ANY($2::uuid[]) AND v.status = 'ok'
        ORDER BY v.post_idea_id, v.finished_at DESC NULLS LAST, v.created_at DESC)
     SELECT n.post_idea_id::text AS post_idea_id, n.id::text AS video_job_id
       FROM newest n
       JOIN slate sl ON true
       JOIN reels.score_slates made ON made.id = n.slate_id
       JOIN reels.idea_scores sc ON sc.slate_id = sl.id AND sc.post_idea_id = n.post_idea_id AND sc.origin = 'carryover'
       LEFT JOIN social_hub.content_items ci ON ci.vertical = 'reels' AND ci.native_ref = n.id::text
      WHERE made.ny_date < sl.ny_date
        AND n.video_storage_path IS NOT NULL
        AND EXISTS (SELECT 1 FROM reels.song_picks p WHERE p.video_job_id = n.id AND p.status = 'ok')
        AND EXISTS (SELECT 1 FROM reels.idea_copy c WHERE c.post_idea_id = n.post_idea_id AND c.slate_id = n.slate_id AND c.status = 'ok')
        AND NOT EXISTS (SELECT 1 FROM social_hub.approvals a WHERE a.content_item_id = ci.id AND a.decision = 'rejected')
        AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts t
                         WHERE t.content_item_id = ci.id
                           AND (t.status <> 'failed' OR t.media_id IS NOT NULL OR t.error LIKE 'The worker stopped%'))
        AND NOT EXISTS (SELECT 1 FROM reels.published_status ps WHERE ps.post_idea_id = n.post_idea_id AND ps.published)
        AND NOT EXISTS (SELECT 1 FROM reels.video_jobs w
                         WHERE w.post_idea_id = n.post_idea_id AND (w.status IN ('requested', 'running') OR w.slate_id = sl.id))
        AND NOT EXISTS (SELECT 1 FROM reels.finish_requests f WHERE f.post_idea_id = n.post_idea_id AND f.status = 'active')`,
    [slateId, ideaIds],
  );
  return new Map(rows.map((row) => [row.post_idea_id, row.video_job_id]));
}
