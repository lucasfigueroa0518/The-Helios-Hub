import type { Query } from '@/lib/social/store/pg';

import { calendarDateKey } from './clock';
import { SOCIAL_TIMEZONE } from './config';
import { queuePublish } from './publish';
import { chooseCarouselSlot, uniformIndex } from './slots';

/**
 * One carousel per Eastern day in the 7:00–8:15 AM window, the same shape as
 * reels.posting_schedule. The 3:00 AM run fills today's window only while
 * publishing is live; a due slot becomes a normal publish attempt.
 */

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

async function takenDays(query: Query, fromDate: string): Promise<Set<string>> {
  const { rows } = await query(
    `SELECT ny_date::text AS ny_date FROM social.posting_schedule
      WHERE status IN ('scheduled', 'publishing', 'published') AND ny_date >= $1::date`,
    [fromDate],
  );
  return new Set(rows.map((r) => r.ny_date as string));
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
    const choice = chooseCarouselSlot(now, await takenDays(query, calendarDateKey(now, SOCIAL_TIMEZONE)), rng, throughDate);
    if (!choice) return { scheduled: false, note: throughDate ? 'Today’s carousel window is taken or over.' : 'No carousel window is open in the next two weeks.' };
    try {
      const { rows } = await query(
        `INSERT INTO social.posting_schedule (post_id, ny_date, slot, publish_at, status, source)
         VALUES ($1, $2::date, $3, $4::timestamptz, 'scheduled', $5) RETURNING id, publish_at`,
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
 * After a run: the run's best post (lowest slug number = best-ranked story)
 * that is in review with its slides stored goes into today's window. The
 * caller checks publishing_live first.
 */
export async function scheduleRunPost(query: Query, runId: string, now = new Date(), rng?: (count: number) => number): Promise<ScheduleOutcome> {
  const { rows } = await query(
    `SELECT id FROM social.posts
      WHERE run_id = $1 AND status = 'review' AND origin = 'pipeline' AND slide_objects IS NOT NULL
      ORDER BY slug
      LIMIT 1`,
    [runId],
  );
  if (!rows[0]) return { scheduled: false, note: 'The run shipped no post ready to schedule.' };
  return schedulePost(query, rows[0].id, 'auto', now, calendarDateKey(now, SOCIAL_TIMEZONE), rng);
}

/** Due slots become publish attempts. A failing queue check fails the slot, with the reason. */
export async function releaseDueSchedules(query: Query): Promise<number> {
  const { rows } = await query(
    `SELECT id, post_id, source FROM social.posting_schedule WHERE status = 'scheduled' AND publish_at <= now() ORDER BY publish_at`,
  );
  let released = 0;
  for (const row of rows) {
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
