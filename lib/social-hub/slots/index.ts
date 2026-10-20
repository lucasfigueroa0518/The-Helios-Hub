// lib/social-hub/slots/index.ts
import { addCalendarDays } from '@/lib/instagram/window';
import type { Vertical } from '@/lib/social-hub/types';

import { bySlotTime } from './book';
import { loadSlots, readCaps, readSlotSource } from './load';
import type { FeedMode, ResolvedSlot, SlotQuery } from './types';

/**
 * The one question every scheduler and hub view asks (spec §5): which of a
 * type's windows are slots on these dates? Null while slot_source is
 * 'legacy': the caller then runs its own code exactly as before, so legacy
 * mode is today's code, not a copy of it. SELECT only.
 */

export type SlotPlan = { from: string; to: string; byDate: ReadonlyMap<string, ResolvedSlot[]> };

/** The schedulers look two weeks ahead (PLACEMENT_DAYS_AHEAD + 1). */
export const PLAN_DAYS = 14;

export async function slotPlan(q: SlotQuery, from: string, days = PLAN_DAYS): Promise<SlotPlan | null> {
  if ((await readSlotSource(q)) !== 'template') return null;
  const to = addCalendarDays(from, days - 1);
  return { from, to, byDate: await loadSlots(q, from, to) };
}

export function slotsOn(plan: SlotPlan, vertical: Vertical, nyDate: string): ResolvedSlot[] {
  return (plan.byDate.get(nyDate) ?? []).filter((s) => s.vertical === vertical);
}

/** Decision 7 (literal): a day with a Last Few Days slot is carousel-off, paused or not. */
export function isLfdDay(plan: SlotPlan, nyDate: string): boolean {
  return (plan.byDate.get(nyDate) ?? []).some((s) => s.vertical === 'last_few_days');
}

/** Before the calendar: Text on Screen posts as trial reels, Explainers to the main feed. */
export function legacyFeedMode(vertical: Vertical): FeedMode | null {
  return vertical === 'reels' ? 'trial' : vertical === 'explainers' ? 'main' : null;
}

/**
 * The feed mode an item posts with: its waiting or posting booking's, else
 * the type's old behavior (a force post with no slot, a booking from before
 * the column). Reel types only.
 */
export async function bookingFeedMode(q: SlotQuery, itemId: string | null, vertical: 'reels' | 'explainers', ideaRef: string | null = null): Promise<FeedMode> {
  try {
    const { rows } = await q(
      `SELECT feed_mode FROM social_hub.schedule
        WHERE vertical = $1 AND status IN ('scheduled', 'publishing') AND feed_mode IS NOT NULL
          AND (content_item_id = $2::uuid OR ($3::text IS NOT NULL AND idea_ref = $3::text))
        ORDER BY (status = 'publishing') DESC, publish_at LIMIT 1`,
      [vertical, itemId, ideaRef],
    );
    const mode = rows[0]?.feed_mode;
    if (mode === 'trial' || mode === 'main') return mode;
  } catch {
    // No feed_mode column yet: the old behavior.
  }
  return legacyFeedMode(vertical)!;
}

/**
 * A type's slots on a date split by the hidden daily cap: the first `cap` by
 * time are made, the rest are over. Stories pass the cap per series.
 */
export function slotsWithinCap(plan: SlotPlan, vertical: Vertical, nyDate: string, cap: number): { made: ResolvedSlot[]; over: ResolvedSlot[] } {
  const all = slotsOn(plan, vertical, nyDate).sort(bySlotTime);
  if (vertical !== 'stories') return { made: all.slice(0, Math.max(0, cap)), over: all.slice(Math.max(0, cap)) };
  const seen = new Map<string, number>();
  const made: ResolvedSlot[] = [];
  const over: ResolvedSlot[] = [];
  for (const s of all) {
    const n = seen.get(s.series ?? '') ?? 0;
    seen.set(s.series ?? '', n + 1);
    (n < cap ? made : over).push(s);
  }
  return { made, over };
}

/** A type's posts for a date in template mode (its slot count, capped); null while legacy, so the caller keeps posts_per_day. */
export async function quotaFromSlots(q: SlotQuery, vertical: Vertical, nyDate: string): Promise<number | null> {
  const plan = await slotPlan(q, nyDate, 1);
  if (!plan) return null;
  const caps = await readCaps(q);
  return slotsWithinCap(plan, vertical, nyDate, caps[vertical]).made.length;
}

/** Template mode: the Stories slots on `nyDate` within the per-series cap; null while legacy (the series' own days stand). */
export async function storiesSlotsOn(q: SlotQuery, nyDate: string): Promise<ResolvedSlot[] | null> {
  const plan = await slotPlan(q, nyDate, 1);
  if (!plan) return null;
  const caps = await readCaps(q);
  return slotsWithinCap(plan, 'stories', nyDate, caps.stories).made;
}
