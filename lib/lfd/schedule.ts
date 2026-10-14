// lib/lfd/schedule.ts
/**
 * Last Few Days on the calendar (spec §7.4): one 9:00–10:00 AM window on its
 * days (lfd.settings.days, Tue/Fri), at least 30 minutes from every other feed
 * post. Approve, reject, unschedule, Hard publish and the due-slot release use
 * the same spine helpers as Carousels (lib/social/overnight/schedule.ts).
 */
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { chooseFromWindows, slotTakenKey, uniformIndex } from '@/lib/instagram/window';
import { approveItem, bookSlot } from '@/lib/social-hub/spine';
import type { Queued } from '@/lib/social/overnight/publish';
import { forceApproveItem, rejectItemAndSlot, releaseDueFor, unscheduleItem, type ScheduleOutcome } from '@/lib/social/overnight/schedule';
import type { Query } from '@/lib/social/store/pg';

import { DEFAULT_LFD_DAYS, LFD_SLOT, LFD_WINDOW } from './config';
import { datesByWeekday } from './days';
import { lfdItemId } from './items';
import { queueLfdPublish } from './publish';
import { readLfdSettings } from './settings';

export const LFD_NOT_APPROVED_NOTE = 'Nobody approved this Last Few Days post before its slot, so it was not posted.';
export const LFD_REJECTED_NOTE = 'This Last Few Days post was rejected, so it was not posted.';
export const LFD_HARD_PUBLISH_NOTE = 'Hard published from the Social Hub (posted now, outside its slot).';

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === '23505';

/** Booked LFD windows from `fromDate`, plus every day that is not an LFD day (no window there, LFD-01). */
async function takenSlots(query: Query, fromDate: string, days: readonly number[]): Promise<Set<string>> {
  const { rows } = await query(
    `SELECT ny_date::text AS ny_date, slot FROM social_hub.schedule
      WHERE vertical = 'last_few_days' AND status IN ('scheduled', 'publishing', 'published') AND ny_date >= $1::date`,
    [fromDate],
  );
  const taken = new Set(rows.map((r) => slotTakenKey(r.ny_date as string, r.slot as string)));
  for (const day of datesByWeekday(fromDate, 14, days, false)) taken.add(slotTakenKey(day, LFD_SLOT));
  return taken;
}

/**
 * Put a post into the earliest open LFD window (through `throughDate` when
 * given: the worker passes the post's own day). A post already on the clock
 * keeps its slot. A person scheduling (`user`) approves it.
 */
export async function scheduleLfdPost(
  query: Query,
  postId: string,
  source: 'auto' | 'user',
  now = new Date(),
  throughDate?: string,
  rng: (count: number) => number = uniformIndex,
): Promise<ScheduleOutcome> {
  const itemId = await lfdItemId(query, postId);
  if (!itemId) return { scheduled: false, note: 'The post is gone.' };
  if (source === 'user') await approveItem(query, itemId, 'user');
  const active = async () =>
    (await query(
      `SELECT id, publish_at FROM social_hub.schedule WHERE content_item_id = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`,
      [itemId],
    )).rows[0];
  const existing = await active();
  if (existing) return { scheduled: true, id: existing.id, publishAt: new Date(existing.publish_at).toISOString() };

  const days = await readLfdSettings(query).then((s) => s.days).catch(() => [...DEFAULT_LFD_DAYS]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const today = calendarDateKey(now, SOCIAL_TIMEZONE);
    const busy = [...(await busyFeedTimes(query, now, 'lfd')), ...(await ownFeedTimes(query, 'lfd', now))];
    const choice = chooseFromWindows([LFD_WINDOW], now, await takenSlots(query, today, days), busy, rng, throughDate);
    if (!choice) {
      return {
        scheduled: false,
        note: throughDate ? 'No Last Few Days window is open on that day (it posts on its days only, 9:00–10:00 AM).' : 'No Last Few Days window is open in the next two weeks.',
      };
    }
    try {
      const booked = await bookSlot(query, { vertical: 'last_few_days', itemId, nyDate: choice.nyDate, slot: choice.slot, publishAt: choice.publishAt, source });
      return { scheduled: true, id: booked.id, publishAt: booked.publishAt };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await active();
      if (raced) return { scheduled: true, id: raced.id, publishAt: new Date(raced.publish_at).toISOString() };
    }
  }
  return { scheduled: false, note: 'That window was just taken.' };
}

/** A person approves a post: approved, and booked in its day's window or the next open one (like Carousels, P2-M4). */
export function approveLfdPost(query: Query, postId: string, now = new Date()): Promise<ScheduleOutcome> {
  return scheduleLfdPost(query, postId, 'user', now);
}

/**
 * A person rejects a post (D47): it never posts, its waiting slot is cancelled,
 * and lfd.posts is marked rejected so its stories are free for the next post's
 * repeat check (lib/lfd/store.ts previousPosts skips rejected posts).
 */
export async function rejectLfdPost(query: Query, postId: string, by: string | null = null): Promise<boolean> {
  const itemId = await lfdItemId(query, postId);
  if (!itemId) return false;
  await rejectItemAndSlot(query, itemId, by, LFD_REJECTED_NOTE);
  await query(`UPDATE lfd.posts SET status = 'rejected' WHERE id = $1 AND status = 'review'`, [postId]);
  return true;
}

export async function unscheduleLfdPost(query: Query, postId: string): Promise<{ ok: boolean; note: string }> {
  const itemId = await lfdItemId(query, postId);
  if (!itemId) return { ok: false, note: 'The post is gone.' };
  return unscheduleItem(query, itemId);
}

/** Hard publish (SH-15/SH-17): approved by the click, its waiting slot closed, a force attempt queued. */
export async function hardPublishLfdPost(query: Query, postId: string): Promise<Queued> {
  const itemId = await lfdItemId(query, postId);
  if (itemId) await forceApproveItem(query, itemId, LFD_HARD_PUBLISH_NOTE);
  return queueLfdPublish(query, postId, 'force');
}

/** Due LFD slots become publish attempts (Carousels' rule, LFD's queue and notes). */
export function releaseDueLfd(query: Query, opts: { requireApproval: boolean } = { requireApproval: true }): Promise<number> {
  return releaseDueFor(query, {
    vertical: 'last_few_days',
    requireApproval: opts.requireApproval,
    queue: (postId, trigger) => queueLfdPublish(query, postId, trigger),
    notApprovedNote: LFD_NOT_APPROVED_NOTE,
    rejectedNote: LFD_REJECTED_NOTE,
  });
}
