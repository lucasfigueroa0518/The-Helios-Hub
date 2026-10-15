// lib/social-hub/slots/index.ts
import { addCalendarDays } from '@/lib/instagram/window';
import type { Vertical } from '@/lib/social-hub/types';

import { loadSlots, readSlotSource } from './load';
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

/** Keys (in the caller's own key format) for every window of `vertical` that is NOT a slot, on every date in the plan. */
export function nonSlotKeys(plan: SlotPlan, vertical: Vertical, windowIds: readonly string[], key: (nyDate: string, windowId: string) => string): Set<string> {
  const out = new Set<string>();
  for (const [date, slots] of plan.byDate) {
    const on = new Set(slots.filter((s) => s.vertical === vertical).map((s) => s.windowId));
    for (const id of windowIds) if (!on.has(id)) out.add(key(date, id));
  }
  return out;
}

/** A reel type's slots split by Trial / Main, in the caller's key format. */
export function feedModeKeys(plan: SlotPlan, vertical: Vertical, key: (nyDate: string, windowId: string) => string): { trial: Set<string>; main: Set<string> } {
  const trial = new Set<string>();
  const main = new Set<string>();
  for (const [date, slots] of plan.byDate) {
    for (const s of slots) if (s.vertical === vertical) (s.feedMode === 'main' ? main : trial).add(key(date, s.windowId));
  }
  return { trial, main };
}

/** Decision 7 (literal): a day with a Last Few Days slot is carousel-off, paused or not. */
export function isLfdDay(plan: SlotPlan, nyDate: string): boolean {
  return (plan.byDate.get(nyDate) ?? []).some((s) => s.vertical === 'last_few_days');
}

/** Before the calendar: Text on Screen posts as trial reels, Explainers to the main feed. */
export function legacyFeedMode(vertical: Vertical): FeedMode | null {
  return vertical === 'reels' ? 'trial' : vertical === 'explainers' ? 'main' : null;
}

/** The feed mode a new booking in (nyDate, windowId) takes. */
export async function feedModeFor(q: SlotQuery, vertical: Vertical, nyDate: string, windowId: string): Promise<FeedMode | null> {
  if (vertical !== 'reels' && vertical !== 'explainers') return null;
  const plan = await slotPlan(q, nyDate, 1);
  const slot = plan ? slotsOn(plan, vertical, nyDate).find((s) => s.windowId === windowId) : null;
  return slot?.feedMode ?? legacyFeedMode(vertical);
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
