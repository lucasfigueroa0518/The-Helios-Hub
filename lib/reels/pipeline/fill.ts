import { dbQuery } from '@/lib/db';
import { PASSING_REELS_PER_NIGHT } from '@/lib/reels/config';
import { getSetting } from '@/lib/reels/music/store';
import { reelsSpine } from '@/lib/reels/publish/items';
import { reelsForOpenWindows } from '@/lib/reels/publish/slots';
import { calendarDateKey } from '@/lib/reels/schedule';
import type { RunTrigger } from '@/lib/reels/types';
import { dailyFill, remainingQuota, type DailyFill } from '@/lib/social-hub/fill';
import { fillDates, leadDaysFor } from '@/lib/social-hub/lead';
import { quotaFromSlots } from '@/lib/social-hub/slots';

/**
 * Text on Screen's daily fill (D54). The 1:00 AM run fills a day's quota
 * (PASSING_REELS_PER_NIGHT) less what is already placed for that New York
 * day, one per posting window still open. Ideas a person already placed are
 * not made again, and a carryover idea whose finished video never posted
 * takes its slot with that video instead of a new copy and render: the one
 * explicit exception to SH-59 (D55).
 *
 * Lead time (Bald-Eagle D4, D8): the scheduled night makes Text on Screen 2
 * days ahead. It fills every date in fillDates(runDay, 2) that still has room
 * (the cutover night: day+1 and day+2; after that: day+2), and on those dates
 * every booking counts, the night's own from an earlier night included. A
 * person's Run now (trigger 'manual') stays on the day clicked, as before.
 */

/** The dates a run fills, and the lead it counts them with: the scheduled night fills ahead, Run now fills its own day. */
export function reelsRunDates(runDay: string, trigger: RunTrigger): { dates: string[]; lead: number } {
  const lead = trigger === 'scheduled' ? leadDaysFor('reels') : 0;
  return { dates: fillDates(runDay, lead), lead };
}

/**
 * One date's fill: the quota, what is already placed, what is left. Same-day (`lead` 0): the reels
 * people placed. Made ahead (`lead` > 0): every booking on that date (lib/social-hub/fill.ts rule 4).
 */
export async function reelsFill(now = new Date(), opts: { nyDate?: string; lead?: number } = {}): Promise<DailyFill> {
  const nyDate = opts.nyDate ?? calendarDateKey(now);
  return dailyFill(reelsSpine, 'reels', nyDate, await reelsPerDay(now, nyDate), { lead: opts.lead ?? 0 });
}

/** The day's quota: the calendar's reels slots for that day within the daily cap in template mode, else the `posts_per_day` row of reels.settings, else three. */
export async function reelsPerDay(now = new Date(), nyDate = calendarDateKey(now)): Promise<number> {
  // A failed slot read throws: it must not silently book by the old rules (ruling P2).
  const fromSlots = await quotaFromSlots((text, params) => dbQuery(text, params) as never, 'reels', nyDate);
  if (fromSlots != null) return fromSlots;
  const raw = await getSetting<unknown>('posts_per_day');
  // A missing row is the default, not zero (Number(null) is 0).
  const value = raw == null ? NaN : Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : PASSING_REELS_PER_NIGHT;
}

/**
 * Reels already made (or being made) for a posting date that hold no booking there: the selected ideas of the
 * date's newest slate with a finished video, or a copy / frame / video / Generate walk in progress, on that slate.
 * Not rejected, and no waiting, posting or posted booking on the date (those already count in the fill). Publishing
 * off, or a booking that failed, leaves a made reel unbooked: without this the next night would see the date as
 * empty and write and render it again (Bald-Eagle D4, integration review S1).
 */
export async function madeUnbookedOn(nyDate: string): Promise<number> {
  const { rows } = await dbQuery<{ n: number }>(
    `WITH slate AS (
       SELECT id FROM reels.score_slates WHERE ny_date = $1::date ORDER BY scored_at DESC LIMIT 1)
     SELECT count(DISTINCT sc.post_idea_id)::int AS n
       FROM reels.idea_scores sc
       JOIN slate ON slate.id = sc.slate_id
      WHERE sc.selected
        AND (EXISTS (SELECT 1 FROM reels.video_jobs v
                      WHERE v.post_idea_id = sc.post_idea_id AND v.slate_id = slate.id AND v.status IN ('requested', 'running', 'ok'))
          OR EXISTS (SELECT 1 FROM reels.finish_requests f
                      WHERE f.post_idea_id = sc.post_idea_id AND f.slate_id = slate.id AND f.status IN ('active', 'done'))
          OR EXISTS (SELECT 1 FROM reels.copy_jobs c
                      WHERE c.post_idea_id = sc.post_idea_id AND c.slate_id = slate.id AND c.status IN ('requested', 'running'))
          OR EXISTS (SELECT 1 FROM reels.visual_jobs j
                      WHERE j.post_idea_id = sc.post_idea_id AND j.slate_id = slate.id AND j.status IN ('requested', 'running')))
        AND NOT EXISTS (SELECT 1 FROM social_hub.approvals a
                          JOIN social_hub.content_items ci ON ci.id = a.content_item_id
                         WHERE ci.vertical = 'reels' AND ci.idea_ref = sc.post_idea_id::text AND a.decision = 'rejected')
        AND NOT EXISTS (SELECT 1 FROM social_hub.schedule b
                         WHERE b.vertical = 'reels' AND b.idea_ref = sc.post_idea_id::text AND b.ny_date = $1::date
                           AND b.status IN ('scheduled', 'publishing', 'published'))`,
    [nyDate],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * A made-ahead date's fill (lead > 0): every booking on it, plus the reels already made or in progress for it that
 * hold no booking (madeUnbookedOn). Same-day (Run now) stays the plain reelsFill.
 */
export async function reelsLeadFill(now: Date, nyDate: string, lead: number): Promise<DailyFill> {
  const fill = await reelsFill(now, { nyDate, lead });
  if (lead <= 0) return fill;
  const made = await madeUnbookedOn(nyDate);
  if (made === 0) return fill;
  const placed = fill.userPlaced + made;
  return { ...fill, userPlaced: placed, making: remainingQuota(fill.quota, placed) };
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
 * made for an earlier posting day than this slate's (slates are keyed by
 * posting date, Bald-Eagle D4), still in Storage, with its
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
