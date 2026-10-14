import type { Query } from '@/lib/social/store/pg';

import { calendarDateKey } from '@/lib/instagram/clock';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { slotTakenKey } from '@/lib/instagram/window';
import { dailyFill, quotaFilledNote, type DailyFill } from '@/lib/social-hub/fill';
import { approveItem, bookSlot, rejectItem } from '@/lib/social-hub/spine';
import { datesByWeekday } from '@/lib/lfd/days';
import { carouselOffDays } from '@/lib/lfd/settings';
import { CAROUSEL_SLOTS, DEFAULT_POSTS_PER_DAY, SOCIAL_TIMEZONE } from './config';
import { carouselItemId } from './items';
import { queuePublish, type FeedVertical, type PublishTrigger, type Queued } from './publish';
import { chooseCarouselSlots, uniformIndex } from './slots';

/**
 * Up to `posts_per_day` carousels per Eastern day (default 2), one per
 * window (9:00–10:00 AM, 2:30–3:30 PM), each ≥ 30 minutes from any other
 * feed post (SH-46 – SH-48). The 3:00 AM run fills today's windows only while
 * publishing is live; a due slot becomes a normal publish attempt.
 *
 * Slots live on the lifecycle spine (social_hub.schedule, vertical
 * 'carousels'); approval is the item's (social_hub.approvals), so content a
 * person approved stays approved wherever it is placed (D36).
 */

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

async function takenSlots(query: Query, fromDate: string): Promise<Set<string>> {
  const { rows } = await query(
    `SELECT ny_date::text AS ny_date, slot FROM social_hub.schedule
      WHERE vertical = 'carousels' AND status IN ('scheduled', 'publishing', 'published') AND ny_date >= $1::date`,
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

/**
 * Today's daily fill (D54): `posts_per_day`, less the carousels people placed
 * for today (`source = 'user'` slots waiting, posting or posted). What is
 * left is what the 3 AM run may make and schedule.
 */
export async function carouselFill(query: Query, now = new Date()): Promise<DailyFill> {
  return dailyFill(query, 'carousels', calendarDateKey(now, SOCIAL_TIMEZONE), await postsPerDay(query));
}

/**
 * Stories the nightly run makes: the fill's remainder, never more than
 * `run_stories` (the run's own spend knob, default 2). Zero: the run is skipped.
 */
export function nightStories(fill: DailyFill, runStories: number): number {
  const knob = Number.isFinite(runStories) ? Math.max(0, Math.floor(runStories)) : 0;
  return Math.min(knob, fill.making);
}

export type ScheduleOutcome = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string };

/**
 * Put a post into the earliest open window (through `throughDate` when given).
 * A post already on the clock keeps it. A person scheduling (`user`) approves it.
 */
export async function schedulePost(
  query: Query,
  postId: string,
  source: 'auto' | 'user',
  now = new Date(),
  throughDate?: string,
  rng: (count: number) => number = uniformIndex,
): Promise<ScheduleOutcome> {
  const itemId = await carouselItemId(query, postId);
  if (!itemId) return { scheduled: false, note: 'The post is gone.' };
  if (source === 'user') await approveItem(query, itemId, 'user');
  const active = async () =>
    (await query(
      `SELECT id, publish_at FROM social_hub.schedule WHERE content_item_id = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`,
      [itemId],
    )).rows[0];
  const existing = await active();
  if (existing) return { scheduled: true, id: existing.id, publishAt: new Date(existing.publish_at).toISOString() };

  // LFD-02: while Last Few Days' auto_run is on, its days have no carousel windows.
  const off = await carouselOffDays(query);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const busy = [...(await busyFeedTimes(query, now, 'social')), ...(await ownFeedTimes(query, 'social', now))];
    const today = calendarDateKey(now, SOCIAL_TIMEZONE);
    const taken = await takenSlots(query, today);
    for (const day of datesByWeekday(today, 14, off, true)) for (const w of CAROUSEL_SLOTS) taken.add(slotTakenKey(day, w.id));
    const choice = chooseCarouselSlots(now, taken, busy, await postsPerDay(query), rng, throughDate);
    if (!choice) return { scheduled: false, note: throughDate ? 'Today’s carousel windows are taken or over.' : 'No carousel window is open in the next two weeks.' };
    try {
      const booked = await bookSlot(query, { vertical: 'carousels', itemId, nyDate: choice.nyDate, slot: choice.slot, publishAt: choice.publishAt, source });
      return { scheduled: true, id: booked.id, publishAt: booked.publishAt };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await active();
      if (raced) return { scheduled: true, id: raced.id, publishAt: new Date(raced.publish_at).toISOString() };
    }
  }
  return { scheduled: false, note: 'That window was just taken.' };
}

/** A run's own posts, best-ranked story first (lowest slug number), for runs recorded before `ship_post_ids`. */
const RUN_POSTS_BY_SLUG = `
SELECT id FROM social.posts
 WHERE run_id = $1 AND status = 'review' AND origin = 'pipeline' AND slide_objects IS NOT NULL
 ORDER BY slug
 LIMIT $2`;

/** The run's ship list in rank order: its new posts and the stored posts it reused (SH-60). */
const RUN_SHIP_LIST = `
SELECT p.id FROM social.runs r
 CROSS JOIN LATERAL jsonb_array_elements_text(r.ship_post_ids) WITH ORDINALITY AS o(post_id, n)
 JOIN social.posts p ON p.id::text = o.post_id
WHERE r.id = $1 AND p.status = 'review' AND p.origin = 'pipeline' AND p.slide_objects IS NOT NULL
  -- A reused post already waiting in a slot keeps it; it does not take one of today's windows (D41).
  AND NOT EXISTS (SELECT 1 FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id
                   WHERE ci.vertical = 'carousels' AND ci.native_ref = p.id::text AND s.status IN ('scheduled', 'publishing'))
ORDER BY o.n
LIMIT $2`;

/**
 * After a run: the run's best posts that are in review with slides stored go
 * into today's windows, up to `posts_per_day` (SH-48: the top two by
 * default) less what people placed for today (daily fill, D54). A story
 * whose finished post was reused (SH-60) is in the ship list at its rank, so
 * its stored post takes the slot. The caller checks publishing_live first.
 */
export async function scheduleRunPosts(query: Query, runId: string, now = new Date(), rng?: (count: number) => number): Promise<ScheduleOutcome[]> {
  const fill = await carouselFill(query, now);
  if (fill.making < 1) return [{ scheduled: false, note: quotaFilledNote(fill, 'carousel') }];
  const run = (await query(`SELECT ship_post_ids IS NOT NULL AS listed FROM social.runs WHERE id = $1`, [runId])).rows[0];
  const { rows } = await query(run?.listed ? RUN_SHIP_LIST : RUN_POSTS_BY_SLUG, [runId, fill.making]);
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

/** A person approves a scheduled carousel (the Social Hub review screen): the content in that slot. */
export async function approveSchedule(query: Query, scheduleId: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT content_item_id FROM social_hub.schedule WHERE id = $1 AND vertical = 'carousels' AND status = 'scheduled'`,
    [scheduleId],
  );
  if (!rows[0]) return false;
  await approveItem(query, rows[0].content_item_id, 'user');
  return true;
}

/**
 * A person approves a carousel that has no slot yet (Content ready, P2-M4):
 * it is approved and placed in the earliest open window. One already
 * waiting in a slot is approved there.
 */
export async function approvePost(query: Query, postId: string, now = new Date()): Promise<ScheduleOutcome> {
  return schedulePost(query, postId, 'user', now);
}

export const NOT_APPROVED_NOTE = 'Nobody approved this carousel before its slot, so it was not posted.';
export const REJECTED_NOTE = 'This carousel was rejected, so it was not posted.';

/** What a due feed slot turns into: the type's queue rule, and the notes a refused slot keeps. */
export type ReleaseRules = {
  vertical: FeedVertical;
  requireApproval: boolean;
  queue: (nativeRef: string, trigger: PublishTrigger) => Promise<Queued>;
  notApprovedNote: string;
  rejectedNote: string;
  /** Optional (Last Few Days only): a slot more than `afterMinutes` past due is cancelled with `note`, never posted late. */
  missed?: { afterMinutes: number; note: string };
};

/**
 * Due slots become publish attempts. With require_approval on (the default),
 * an unapproved slot is cancelled instead. A failing queue check fails the
 * slot, with the reason. Carousels and Last Few Days share this rule.
 */
export async function releaseDueFor(query: Query, rules: ReleaseRules): Promise<number> {
  const { rows } = await query(
    `SELECT s.id, ci.native_ref, s.source, a.decision, s.publish_at
       FROM social_hub.schedule s
       JOIN social_hub.content_items ci ON ci.id = s.content_item_id
       LEFT JOIN social_hub.approvals a ON a.content_item_id = s.content_item_id
      WHERE s.vertical = $1 AND s.status = 'scheduled' AND s.publish_at <= now()
      ORDER BY s.publish_at`,
    [rules.vertical],
  );
  const cancel = (id: string, note: string) =>
    query(`UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE id = $1 AND status = 'scheduled'`, [id, note]);
  let released = 0;
  for (const row of rows) {
    if (row.decision === 'rejected') {
      await cancel(row.id, rules.rejectedNote);
      continue;
    }
    if (rules.requireApproval && row.decision !== 'approved') {
      await cancel(row.id, rules.notApprovedNote);
      continue;
    }
    if (rules.missed && new Date(row.publish_at).getTime() < Date.now() - rules.missed.afterMinutes * 60_000) {
      await cancel(row.id, rules.missed.note);
      continue;
    }
    const claimed = await query(
      `UPDATE social_hub.schedule SET status = 'publishing' WHERE id = $1 AND status = 'scheduled' RETURNING id`,
      [row.id],
    );
    if (!claimed.rows[0]) continue;
    const result = await rules.queue(row.native_ref, row.source === 'user' ? 'approve' : 'auto');
    if (result.queued) {
      await query(`UPDATE social_hub.schedule SET publish_attempt_id = $2 WHERE id = $1`, [row.id, result.id]);
      released += 1;
    } else if (result.alreadyPublished) {
      await query(`UPDATE social_hub.schedule SET status = 'published', error = NULL WHERE id = $1`, [row.id]);
    } else if (result.terminal) {
      await query(`UPDATE social_hub.schedule SET status = 'failed', error = $2 WHERE id = $1`, [row.id, result.note]);
    } else {
      await query(`UPDATE social_hub.schedule SET status = 'scheduled', error = $2 WHERE id = $1`, [row.id, result.note]);
    }
  }
  return released;
}

/** Carousels' due slots (the carousel queue rule and notes). */
export async function releaseDueSchedules(query: Query, opts: { requireApproval: boolean } = { requireApproval: true }): Promise<number> {
  return releaseDueFor(query, {
    vertical: 'carousels',
    requireApproval: opts.requireApproval,
    queue: (postId, trigger) => queuePublish(query, postId, trigger),
    notApprovedNote: NOT_APPROVED_NOTE,
    rejectedNote: REJECTED_NOTE,
  });
}

/** Reject an item (it never posts, D47) and cancel its waiting slot with `note`. */
export async function rejectItemAndSlot(query: Query, itemId: string, by: string | null, note: string): Promise<void> {
  await rejectItem(query, itemId, by);
  await query(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE content_item_id = $1 AND status = 'scheduled'`,
    [itemId, note],
  );
}

/** Hard publish's first half (SH-17): the click approves the item, and its waiting slot is closed so it can't post twice. */
export async function forceApproveItem(query: Query, itemId: string, note: string): Promise<void> {
  await approveItem(query, itemId, 'force');
  await query(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE content_item_id = $1 AND status = 'scheduled'`,
    [itemId, note],
  );
}

/**
 * A person rejects a carousel (Social Hub Reject, D47): its item is rejected on
 * the spine, so it never posts and is never reused (SH-60), and its waiting slot
 * is cancelled with the reason.
 */
export async function rejectPost(query: Query, postId: string, by: string | null = null): Promise<boolean> {
  const itemId = await carouselItemId(query, postId);
  if (!itemId) return false;
  await rejectItemAndSlot(query, itemId, by, REJECTED_NOTE);
  return true;
}

export const HARD_PUBLISH_NOTE = 'Hard published from the Social Hub (posted now, outside its slot).';

/**
 * Hard publish (Social Hub, SH-15/SH-17): post this carousel now. A person's
 * click is its approval, so the post's waiting slot is approved and closed
 * (cancelled with the reason) before the force attempt is queued; the slot
 * can then never post it a second time.
 */
export async function hardPublishPost(query: Query, postId: string) {
  const itemId = await carouselItemId(query, postId);
  if (itemId) await forceApproveItem(query, itemId, HARD_PUBLISH_NOTE);
  return queuePublish(query, postId, 'force');
}

export const UNSCHEDULED_NOTE = 'Taken off the calendar by a person (unscheduled). It is not approved any more.';

/**
 * Take an item off the calendar (the hub's Unschedule): its waiting slot is
 * cancelled and its approval withdrawn, so it is made and waiting again. A
 * rejection stays; content that is posting or has posted can't be unscheduled.
 */
export async function unscheduleItem(query: Query, itemId: string): Promise<{ ok: boolean; note: string }> {
  const { rows: busy } = await query(
    `SELECT (SELECT count(*) FROM social_hub.schedule WHERE content_item_id = $1 AND status = 'publishing')
          + (SELECT count(*) FROM social_hub.publish_attempts WHERE content_item_id = $1 AND status IN ('requested', 'creating', 'processing', 'publishing', 'published')) AS n`,
    [itemId],
  );
  if (Number(busy[0]?.n ?? 0) > 0) return { ok: false, note: 'It is posting, or has already posted, so it can’t be unscheduled.' };
  const cancelled = await query(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE content_item_id = $1 AND status = 'scheduled' RETURNING id`,
    [itemId, UNSCHEDULED_NOTE],
  );
  await query(`DELETE FROM social_hub.approvals WHERE content_item_id = $1 AND decision = 'approved'`, [itemId]);
  return cancelled.rows.length
    ? { ok: true, note: 'Unscheduled. It is not approved any more; approve and schedule it again when you want it to post.' }
    : { ok: true, note: 'It had no slot. Its approval is withdrawn.' };
}

/** Take a carousel off the calendar (the hub's Unschedule). */
export async function unschedulePost(query: Query, postId: string): Promise<{ ok: boolean; note: string }> {
  const itemId = await carouselItemId(query, postId);
  if (!itemId) return { ok: false, note: 'The post is gone.' };
  return unscheduleItem(query, itemId);
}
