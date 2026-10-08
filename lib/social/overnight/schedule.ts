import type { Query } from '@/lib/social/store/pg';

import { calendarDateKey } from '@/lib/instagram/clock';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { slotTakenKey } from '@/lib/instagram/window';
import { DEFAULT_POSTS_PER_DAY, SOCIAL_TIMEZONE } from './config';
import { queuePublish } from './publish';
import { chooseCarouselSlots, uniformIndex } from './slots';

/**
 * Up to `posts_per_day` carousels per Eastern day (default 2), one per
 * window (9:00–10:00 AM, 2:30–3:30 PM), the same shape as
 * reels.posting_schedule, each ≥ 30 minutes from any other feed post
 * (SH-46 – SH-48). The 3:00 AM run fills today's windows only while
 * publishing is live; a due slot becomes a normal publish attempt.
 */

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

async function takenSlots(query: Query, fromDate: string): Promise<Set<string>> {
  const { rows } = await query(
    `SELECT ny_date::text AS ny_date, slot FROM social.posting_schedule
      WHERE status IN ('scheduled', 'publishing', 'published') AND ny_date >= $1::date`,
    [fromDate],
  );
  return new Set(rows.map((r) => slotTakenKey(r.ny_date as string, r.slot as string)));
}

/** `posts_per_day` from social.settings (SH-48), else the default. */
export async function postsPerDay(query: Query): Promise<number> {
  const { rows } = await query(`SELECT value FROM social.settings WHERE key = 'posts_per_day'`);
  const value = Number(rows[0]?.value);
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_POSTS_PER_DAY;
}

export type ScheduleOutcome = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string };

/** Put a post into the earliest open window (through `throughDate` when given). A post already on the clock keeps it. */
export async function schedulePost(
  query: Query,
  postId: string,
  source: 'auto' | 'user',
  now = new Date(),
  throughDate?: string,
  rng: (count: number) => number = uniformIndex,
): Promise<ScheduleOutcome> {
  const active = async () =>
    (await query(
      `SELECT id, publish_at FROM social.posting_schedule WHERE post_id = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`,
      [postId],
    )).rows[0];
  const existing = await active();
  if (existing) return { scheduled: true, id: existing.id, publishAt: new Date(existing.publish_at).toISOString() };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const busy = [...(await busyFeedTimes(query, now, 'social')), ...(await ownFeedTimes(query, 'social', now))];
    const choice = chooseCarouselSlots(now, await takenSlots(query, calendarDateKey(now, SOCIAL_TIMEZONE)), busy, await postsPerDay(query), rng, throughDate);
    if (!choice) return { scheduled: false, note: throughDate ? 'Today’s carousel windows are taken or over.' : 'No carousel window is open in the next two weeks.' };
    try {
      const { rows } = await query(
        `INSERT INTO social.posting_schedule (post_id, ny_date, slot, publish_at, status, source, approved_at)
         VALUES ($1, $2::date, $3, $4::timestamptz, 'scheduled', $5, CASE WHEN $5::text = 'user' THEN now() END) RETURNING id, publish_at`,
        [postId, choice.nyDate, choice.slot, choice.publishAt.toISOString(), source],
      );
      return { scheduled: true, id: rows[0].id, publishAt: new Date(rows[0].publish_at).toISOString() };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await active();
      if (raced) return { scheduled: true, id: raced.id, publishAt: new Date(raced.publish_at).toISOString() };
    }
  }
  return { scheduled: false, note: 'That window was just taken.' };
}

/**
 * After a run: the run's best posts (lowest slug number = best-ranked story)
 * that are in review with slides stored go into today's windows, up to
 * `posts_per_day` (SH-48: the top two by default). The caller checks
 * publishing_live first.
 */
export async function scheduleRunPosts(query: Query, runId: string, now = new Date(), rng?: (count: number) => number): Promise<ScheduleOutcome[]> {
  const perDay = await postsPerDay(query);
  const { rows } = await query(
    `SELECT id FROM social.posts
      WHERE run_id = $1 AND status = 'review' AND origin = 'pipeline' AND slide_objects IS NOT NULL
      ORDER BY slug
      LIMIT $2`,
    [runId, perDay],
  );
  if (!rows[0]) return [{ scheduled: false, note: 'The run shipped no post ready to schedule.' }];
  const out: ScheduleOutcome[] = [];
  for (const row of rows) {
    const result = await schedulePost(query, row.id, 'auto', now, calendarDateKey(now, SOCIAL_TIMEZONE), rng);
    out.push(result);
    if (!result.scheduled) break;
  }
  return out;
}

/** The run's best post only (kept for callers that want one). */
export async function scheduleRunPost(query: Query, runId: string, now = new Date(), rng?: (count: number) => number): Promise<ScheduleOutcome> {
  return (await scheduleRunPosts(query, runId, now, rng))[0]!;
}

/** A person approves a scheduled carousel (the Social Hub review screen). */
export async function approveSchedule(query: Query, scheduleId: string): Promise<boolean> {
  const { rows } = await query(
    `UPDATE social.posting_schedule SET approved_at = coalesce(approved_at, now()) WHERE id = $1 AND status = 'scheduled' RETURNING id`,
    [scheduleId],
  );
  return rows.length > 0;
}

export const NOT_APPROVED_NOTE = 'Nobody approved this carousel before its slot, so it was not posted.';

/**
 * Due slots become publish attempts. With require_approval on (the default),
 * an unapproved slot is cancelled instead. A failing queue check fails the
 * slot, with the reason.
 */
export async function releaseDueSchedules(query: Query, opts: { requireApproval: boolean } = { requireApproval: true }): Promise<number> {
  const { rows } = await query(
    `SELECT id, post_id, source, approved_at FROM social.posting_schedule WHERE status = 'scheduled' AND publish_at <= now() ORDER BY publish_at`,
  );
  let released = 0;
  for (const row of rows) {
    if (opts.requireApproval && !row.approved_at) {
      await query(`UPDATE social.posting_schedule SET status = 'cancelled', error = $2 WHERE id = $1 AND status = 'scheduled'`, [row.id, NOT_APPROVED_NOTE]);
      continue;
    }
    const claimed = await query(
      `UPDATE social.posting_schedule SET status = 'publishing' WHERE id = $1 AND status = 'scheduled' RETURNING id`,
      [row.id],
    );
    if (!claimed.rows[0]) continue;
    const result = await queuePublish(query, row.post_id, row.source === 'user' ? 'approve' : 'auto');
    if (result.queued) {
      await query(`UPDATE social.posting_schedule SET publish_attempt_id = $2 WHERE id = $1`, [row.id, result.id]);
      released += 1;
    } else if (result.alreadyPublished) {
      await query(`UPDATE social.posting_schedule SET status = 'published', error = NULL WHERE id = $1`, [row.id]);
    } else if (result.terminal) {
      await query(`UPDATE social.posting_schedule SET status = 'failed', error = $2 WHERE id = $1`, [row.id, result.note]);
    } else {
      await query(`UPDATE social.posting_schedule SET status = 'scheduled', error = $2 WHERE id = $1`, [row.id, result.note]);
    }
  }
  return released;
}

export const HARD_PUBLISH_NOTE = 'Hard published from the Social Hub (posted now, outside its slot).';

/**
 * Hard publish (Social Hub, SH-15/SH-17): post this carousel now. A person's
 * click is its approval, so the post's waiting slot is approved and closed
 * (cancelled with the reason) before the force attempt is queued; the slot
 * can then never post it a second time.
 */
export async function hardPublishPost(query: Query, postId: string) {
  await query(
    `UPDATE social.posting_schedule SET approved_at = coalesce(approved_at, now()), status = 'cancelled', error = $2
      WHERE post_id = $1 AND status = 'scheduled'`,
    [postId, HARD_PUBLISH_NOTE],
  );
  return queuePublish(query, postId, 'force');
}
