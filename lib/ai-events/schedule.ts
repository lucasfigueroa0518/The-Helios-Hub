/**
 * AI Events on the calendar (plan M4, AE-08, AE-29): on its days (ai_events.settings.days,
 * Sunday) the Miami post takes the 6:00–7:00 PM window and the Boston post 7:00–8:00 PM, each at
 * least 30 minutes from every other feed post. Approve,
 * reject, unschedule, Hard publish and the due-slot release use the same spine helpers as
 * Carousels and Last Few Days (lib/social/overnight/schedule.ts, modelled on lib/lfd/schedule.ts).
 */
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { chooseFromWindows, slotTakenKey, uniformIndex, type PostingWindow } from '@/lib/instagram/window';
import { datesByWeekday } from '@/lib/lfd/days';
import { slotPlan } from '@/lib/social-hub/slots';
import { chooseTemplateSlot } from '@/lib/social-hub/slots/scheduler';
import { approveItem, bookSlot } from '@/lib/social-hub/spine';
import type { Queued } from '@/lib/social/overnight/publish';
import { forceApproveItem, rejectItemAndSlot, releaseDueFor, unscheduleItem, type ScheduleOutcome } from '@/lib/social/overnight/schedule';
import type { Query } from '@/lib/social/store/pg';

import {
  AI_EVENTS_MISSED_AFTER_MINUTES,
  AI_EVENTS_NIGHT_SLOT,
  AI_EVENTS_SLOT,
  AI_EVENTS_SLOT_VERTICAL,
  AI_EVENTS_SPINE_VERTICAL,
  AI_EVENTS_VERTICAL,
  AI_EVENTS_WINDOW_FOR,
  DEFAULT_AI_EVENTS_DAYS,
} from './config';
import { aiEventsItemId } from './items';
import { queueAiEventsPublish } from './publish';
import { readAiEventsSettings } from './settings';

export const AI_EVENTS_NOT_APPROVED_NOTE = 'Nobody approved this AI Events post before its slot, so it was not posted.';
export const AI_EVENTS_REJECTED_NOTE = 'This AI Events post was rejected, so it was not posted.';
export const AI_EVENTS_HARD_PUBLISH_NOTE = 'Hard published from the Social Hub (posted now, outside its slot).';
export const AI_EVENTS_APPROVED_OFF_NOTE = 'Approved. It will be scheduled when AI Events publishing is on.';
export const AI_EVENTS_DAY_PASSED_NOTE = 'Its Sunday has passed; use Place to pick a day with an AI Events slot.';
export const AI_EVENTS_PUBLISHING_OFF_NOTE = 'AI Events publishing is off. Turn it on before publishing.';
export const AI_EVENTS_MISSED_NOTE = 'Missed its window; place it again to post.';

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === '23505';

/** Booked AI Events windows from `fromDate`, plus every day that is not one of its days (no window there). */
async function takenSlots(query: Query, fromDate: string, days: readonly number[]): Promise<Set<string>> {
  const { rows } = await query(
    `SELECT ny_date::text AS ny_date, slot FROM social_hub.schedule
      WHERE vertical = $2 AND status IN ('scheduled', 'publishing', 'published') AND ny_date >= $1::date`,
    [fromDate, AI_EVENTS_VERTICAL],
  );
  const taken = new Set(rows.map((r) => slotTakenKey(r.ny_date as string, r.slot as string)));
  for (const day of datesByWeekday(fromDate, 14, days, false)) {
    taken.add(slotTakenKey(day, AI_EVENTS_SLOT));
    taken.add(slotTakenKey(day, AI_EVENTS_NIGHT_SLOT));
  }
  return taken;
}

/** The post's city window (AE-29): Miami 6–7 PM, Boston 7–8 PM; a four-city post (no metro) keeps 6–7 PM. */
async function postWindow(query: Query, postId: string): Promise<PostingWindow> {
  const metro = (await query(`SELECT metro FROM ai_events.posts WHERE id = $1`, [postId]).catch(() => ({ rows: [] }))).rows[0]?.metro;
  return metro === 'boston' ? AI_EVENTS_WINDOW_FOR.boston : AI_EVENTS_WINDOW_FOR.miami;
}

/**
 * Put a post into the earliest open AI Events window (through `throughDate` when given: the
 * worker passes the post's own Sunday). A post already on the clock keeps its slot. A person
 * scheduling (`user`) approves it.
 */
export async function scheduleAiEventsPost(
  query: Query,
  postId: string,
  source: 'auto' | 'user',
  now = new Date(),
  throughDate?: string,
  rng: (count: number) => number = uniformIndex,
): Promise<ScheduleOutcome> {
  const itemId = await aiEventsItemId(query, postId);
  if (!itemId) return { scheduled: false, note: 'The post is gone.' };
  if (source === 'user') await approveItem(query, itemId, 'user');
  const active = async () =>
    (await query(
      `SELECT id, publish_at FROM social_hub.schedule WHERE content_item_id = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`,
      [itemId],
    )).rows[0];
  const existing = await active();
  if (existing) return { scheduled: true, id: existing.id, publishAt: new Date(existing.publish_at).toISOString() };

  const days = await readAiEventsSettings(query).then((s) => s.days).catch(() => [...DEFAULT_AI_EVENTS_DAYS]);
  // Template mode: the calendar's AI Events slots replace ai_events.settings.days and the city windows.
  // A failed slot read throws: it must not silently book by the old rules (ruling P2).
  const plan = await slotPlan(query, calendarDateKey(now, SOCIAL_TIMEZONE));
  const window = await postWindow(query, postId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const today = calendarDateKey(now, SOCIAL_TIMEZONE);
    const busy = [...(await busyFeedTimes(query, now, 'ai_events')), ...(await ownFeedTimes(query, 'ai_events', now))];
    const choice = plan
      ? await chooseTemplateSlot(query, plan, AI_EVENTS_SLOT_VERTICAL, { now, busy, rng, throughDate })
      : chooseFromWindows([window], now, await takenSlots(query, today, days), busy, rng, throughDate);
    if (!choice) {
      return {
        scheduled: false,
        note: throughDate ? `No AI Events window is open on that day (this post goes out on Sundays only, ${window.label}).` : 'No AI Events window is open in the next two weeks.',
      };
    }
    try {
      const booked = await bookSlot(query, { vertical: AI_EVENTS_SPINE_VERTICAL, itemId, nyDate: choice.nyDate, slot: choice.slot, publishAt: choice.publishAt, source });
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
export type AiEventsApproveOutcome = ScheduleOutcome | { scheduled: false; approved: true; note: string };

const publishingLive = (query: Query) => readAiEventsSettings(query).then((s) => s.publishingLive).catch(() => false);

/**
 * A person approves a post. While ai_events publishing_live is on it is booked in its own
 * Sunday's city window only (ai_events.posts.ny_date); when that window has passed or is taken
 * it is approved without a slot (Place picks another day). While publishing is off it is
 * approved and nothing is booked.
 */
export async function approveAiEventsPost(query: Query, postId: string, now = new Date()): Promise<AiEventsApproveOutcome> {
  const itemId = await aiEventsItemId(query, postId);
  if (!itemId) return { scheduled: false, note: 'The post is gone.' };
  if (!(await publishingLive(query))) {
    await approveItem(query, itemId, 'user');
    return { scheduled: false, approved: true, note: AI_EVENTS_APPROVED_OFF_NOTE };
  }
  const ownDay = (await query(`SELECT ny_date::text AS d FROM ai_events.posts WHERE id = $1`, [postId])).rows[0]?.d as string | undefined;
  if (!ownDay) return { scheduled: false, note: 'The post is gone.' };
  const out = await scheduleAiEventsPost(query, postId, 'user', now, ownDay.slice(0, 10));
  return out.scheduled ? out : { scheduled: false, approved: true, note: AI_EVENTS_DAY_PASSED_NOTE };
}

/**
 * A person rejects a post (D47): it never posts, its waiting slot is cancelled, and the row is
 * marked rejected, so its hook and look stop counting for the next draw and a new build of the
 * week makes a fresh post.
 */
export async function rejectAiEventsPost(query: Query, postId: string, by: string | null = null): Promise<boolean> {
  const itemId = await aiEventsItemId(query, postId);
  if (!itemId) return false;
  await rejectItemAndSlot(query, itemId, by, AI_EVENTS_REJECTED_NOTE);
  await query(`UPDATE ai_events.posts SET status = 'rejected', updated_at = now() WHERE id = $1 AND status = 'review'`, [postId]);
  return true;
}

export async function unscheduleAiEventsPost(query: Query, postId: string): Promise<{ ok: boolean; note: string }> {
  const itemId = await aiEventsItemId(query, postId);
  if (!itemId) return { ok: false, note: 'The post is gone.' };
  return unscheduleItem(query, itemId);
}

/** Hard publish (SH-15/SH-17): approved by the click, its waiting slot closed, a force attempt queued. */
export async function hardPublishAiEventsPost(query: Query, postId: string): Promise<Queued> {
  // While publishing_live is off nothing is approved, closed or queued: a force attempt would wait unclaimed.
  if (!(await publishingLive(query))) return { queued: false, note: AI_EVENTS_PUBLISHING_OFF_NOTE, terminal: true };
  const itemId = await aiEventsItemId(query, postId);
  if (itemId) await forceApproveItem(query, itemId, AI_EVENTS_HARD_PUBLISH_NOTE);
  return queueAiEventsPublish(query, postId, 'force');
}

/**
 * Due AI Events slots become publish attempts (the Carousels rule, this type's queue and notes).
 * A slot more than AI_EVENTS_MISSED_AFTER_MINUTES past its time (publishing was off, the worker
 * was down) is cancelled instead of posting late: a Sunday-evening post on Monday is stale.
 */
export function releaseDueAiEvents(query: Query, opts: { requireApproval: boolean } = { requireApproval: true }): Promise<number> {
  return releaseDueFor(query, {
    vertical: AI_EVENTS_VERTICAL,
    requireApproval: opts.requireApproval,
    queue: (postId, trigger) => queueAiEventsPublish(query, postId, trigger),
    notApprovedNote: AI_EVENTS_NOT_APPROVED_NOTE,
    rejectedNote: AI_EVENTS_REJECTED_NOTE,
    missed: { afterMinutes: AI_EVENTS_MISSED_AFTER_MINUTES, note: AI_EVENTS_MISSED_NOTE },
  });
}
