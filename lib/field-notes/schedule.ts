/**
 * Field Notes on the calendar: one post a day at most, in the 'afternoon' window (the spine's
 * schedule CHECK allows only that window for field_notes), at least 30 minutes from every other
 * feed post. Nothing is booked until a person approves, and nothing while publishing is off.
 * Approve, reject, unschedule, Hard publish and the due-slot release use the same spine helpers as
 * the other feed types (lib/social/overnight/schedule.ts).
 */
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import { chooseFromWindows, slotTakenKey, uniformIndex } from '@/lib/instagram/window';
import { slotPlan } from '@/lib/social-hub/slots';
import { chooseTemplateSlot } from '@/lib/social-hub/slots/scheduler';
import { approveItem, bookSlot } from '@/lib/social-hub/spine';
import type { Queued } from '@/lib/social/overnight/publish';
import { forceApproveItem, rejectItemAndSlot, releaseDueFor, unscheduleItem, type ScheduleOutcome } from '@/lib/social/overnight/schedule';
import type { Query } from '@/lib/social/store/pg';

import {
  FIELD_NOTES_FEED_VERTICAL,
  FIELD_NOTES_MISSED_AFTER_MINUTES,
  FIELD_NOTES_SLOT,
  FIELD_NOTES_SLOT_VERTICAL,
  FIELD_NOTES_SPINE_VERTICAL,
  FIELD_NOTES_VERTICAL,
  FIELD_NOTES_WINDOW,
} from './config';
import { fieldNotesItemId } from './items';
import { queueFieldNotesPublish } from './publish';
import { readFieldNotesSettings } from './settings';
import { POST_TIP_IDS_SQL } from './store';

export const FIELD_NOTES_NOT_APPROVED_NOTE = 'Nobody approved this Field Notes post before its slot, so it was not posted.';
export const FIELD_NOTES_REJECTED_NOTE = 'This Field Notes post was rejected, so it was not posted.';
export const FIELD_NOTES_HARD_PUBLISH_NOTE = 'Hard published from the Social Hub (posted now, outside its slot).';
export const FIELD_NOTES_APPROVED_OFF_NOTE = 'Approved. It will be scheduled when Field Notes publishing is on.';
export const FIELD_NOTES_NO_WINDOW_NOTE = 'No Field Notes window is open in the next two weeks.';
export const FIELD_NOTES_PUBLISHING_OFF_NOTE = 'Field Notes publishing is off. Turn it on before publishing.';
export const FIELD_NOTES_MISSED_NOTE = 'Missed its window; place it again to post.';

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === '23505';

const publishingLive = (query: Query) => readFieldNotesSettings(query).then((s) => s.publishingLive).catch(() => false);

/** Booked Field Notes windows from `fromDate` (one post a day) and the instants of every booked post of this type. */
async function ownBookings(query: Query, fromDate: string): Promise<{ taken: Set<string>; times: Date[] }> {
  const { rows } = await query(
    `SELECT ny_date::text AS ny_date, slot, publish_at FROM social_hub.schedule
      WHERE vertical = $2 AND status IN ('scheduled', 'publishing', 'published') AND ny_date >= $1::date`,
    [fromDate, FIELD_NOTES_VERTICAL],
  );
  return {
    taken: new Set(rows.map((r) => slotTakenKey(String(r.ny_date).slice(0, 10), String(r.slot)))),
    times: rows.map((r) => new Date(r.publish_at as string)),
  };
}

/**
 * Put a post into the earliest open Field Notes window (through `throughDate` when given). A post
 * already on the clock keeps its slot. A person scheduling (`user`) approves it.
 */
export async function scheduleFieldNotesPost(
  query: Query,
  postId: string,
  source: 'auto' | 'user',
  now = new Date(),
  throughDate?: string,
  rng: (count: number) => number = uniformIndex,
): Promise<ScheduleOutcome> {
  const itemId = await fieldNotesItemId(query, postId);
  if (!itemId) return { scheduled: false, note: 'The post is gone.' };
  if (source === 'user') await approveItem(query, itemId, 'user');
  const active = async () =>
    (await query(
      `SELECT id, publish_at FROM social_hub.schedule WHERE content_item_id = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`,
      [itemId],
    )).rows[0];
  const existing = await active();
  if (existing) return { scheduled: true, id: existing.id, publishAt: new Date(existing.publish_at).toISOString() };

  // Template mode: the calendar's Field Notes slots. A failed slot read throws: it must not
  // silently book by the old rules (ruling P2).
  const plan = await slotPlan(query, calendarDateKey(now, SOCIAL_TIMEZONE));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const today = calendarDateKey(now, SOCIAL_TIMEZONE);
    const own = await ownBookings(query, today);
    const busy = [...(await busyFeedTimes(query, now, null)), ...own.times];
    const choice = plan
      ? await chooseTemplateSlot(query, plan, FIELD_NOTES_SLOT_VERTICAL, { now, busy, rng, throughDate })
      : chooseFromWindows([FIELD_NOTES_WINDOW], now, own.taken, busy, rng, throughDate);
    if (!choice) return { scheduled: false, note: FIELD_NOTES_NO_WINDOW_NOTE };
    try {
      const booked = await bookSlot(query, { vertical: FIELD_NOTES_SPINE_VERTICAL, itemId, nyDate: choice.nyDate, slot: choice.slot, publishAt: choice.publishAt, source });
      return { scheduled: true, id: booked.id, publishAt: booked.publishAt };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await active();
      if (raced) return { scheduled: true, id: raced.id, publishAt: new Date(raced.publish_at).toISOString() };
    }
  }
  return { scheduled: false, note: 'That window was just taken.' };
}

/** Approve's outcome: booked, approved without a slot (with why), or refused. */
export type FieldNotesApproveOutcome = ScheduleOutcome | { scheduled: false; approved: true; note: string };

/**
 * A person approves a post. The tip is approved with it. While field_notes publishing_live is on
 * it is booked in the earliest open window; while publishing is off it is approved and nothing is booked.
 */
export async function approveFieldNotesPost(query: Query, postId: string, now = new Date(), by: string | null = null): Promise<FieldNotesApproveOutcome> {
  const itemId = await fieldNotesItemId(query, postId);
  if (!itemId) return { scheduled: false, note: 'The post is gone.' };
  await query(
    `UPDATE field_notes.posts SET approved_by = coalesce($2, approved_by), updated_at = now() WHERE id = $1 AND status = 'review'`,
    [postId, by],
  );
  await query(
    `UPDATE field_notes.tips SET status = 'approved', updated_at = now() WHERE id IN (${POST_TIP_IDS_SQL}) AND status = 'drafted'`,
    [postId],
  );
  if (!(await publishingLive(query))) {
    await approveItem(query, itemId, 'user', by);
    return { scheduled: false, approved: true, note: FIELD_NOTES_APPROVED_OFF_NOTE };
  }
  const out = await scheduleFieldNotesPost(query, postId, 'user', now);
  return out.scheduled ? out : { scheduled: false, approved: true, note: out.note };
}

/**
 * A person rejects a post: it never posts, its waiting slot is cancelled, the row is marked
 * rejected and its tip is rejected too (so it is not picked again). Its photos keep resting.
 */
export async function rejectFieldNotesPost(query: Query, postId: string, by: string | null = null): Promise<boolean> {
  const itemId = await fieldNotesItemId(query, postId);
  if (!itemId) return false;
  await rejectItemAndSlot(query, itemId, by, FIELD_NOTES_REJECTED_NOTE);
  await query(`UPDATE field_notes.posts SET status = 'rejected', updated_at = now() WHERE id = $1 AND status = 'review'`, [postId]);
  await query(
    `UPDATE field_notes.tips SET status = 'rejected', updated_at = now() WHERE id IN (${POST_TIP_IDS_SQL}) AND status IN ('drafted', 'approved')`,
    [postId],
  );
  return true;
}

export async function unscheduleFieldNotesPost(query: Query, postId: string): Promise<{ ok: boolean; note: string }> {
  const itemId = await fieldNotesItemId(query, postId);
  if (!itemId) return { ok: false, note: 'The post is gone.' };
  return unscheduleItem(query, itemId);
}

/** Hard publish: approved by the click, its waiting slot closed, a force attempt queued. Refused while publishing is off. */
export async function hardPublishFieldNotesPost(query: Query, postId: string): Promise<Queued> {
  // While publishing_live is off nothing is approved, closed or queued: a force attempt would wait unclaimed.
  if (!(await publishingLive(query))) return { queued: false, note: FIELD_NOTES_PUBLISHING_OFF_NOTE, terminal: true };
  const itemId = await fieldNotesItemId(query, postId);
  if (itemId) await forceApproveItem(query, itemId, FIELD_NOTES_HARD_PUBLISH_NOTE);
  return queueFieldNotesPublish(query, postId, 'force');
}

/**
 * Due Field Notes slots become publish attempts (the carousel rule, this type's queue and notes).
 * A slot more than FIELD_NOTES_MISSED_AFTER_MINUTES past its time is cancelled instead of posting late.
 */
export function releaseDueFieldNotes(query: Query, opts: { requireApproval: boolean } = { requireApproval: true }): Promise<number> {
  return releaseDueFor(query, {
    vertical: FIELD_NOTES_FEED_VERTICAL,
    requireApproval: opts.requireApproval,
    queue: (postId, trigger) => queueFieldNotesPublish(query, postId, trigger),
    notApprovedNote: FIELD_NOTES_NOT_APPROVED_NOTE,
    rejectedNote: FIELD_NOTES_REJECTED_NOTE,
    missed: { afterMinutes: FIELD_NOTES_MISSED_AFTER_MINUTES, note: FIELD_NOTES_MISSED_NOTE },
  });
}

export { FIELD_NOTES_SLOT };
