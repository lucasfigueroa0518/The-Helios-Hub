// lib/social-hub/slots/scheduler.ts
import type { Vertical } from '@/lib/social-hub/types';

import { chooseSlotTime, type SlotChoice } from './book';
import { isLfdDay, slotsWithinCap, type SlotPlan } from './index';
import { readCaps } from './load';
import { parseSlotId, slotId, type ResolvedSlot, type SlotQuery } from './types';
import { legacyKey } from './write';

/**
 * Template mode for the feed schedulers (Text on Screen, Explainers,
 * Carousels, Last Few Days; week board spec): what a type may still book.
 * Only the first `cap` slots of a date by time are bookable (the hidden daily
 * cap; the rest are never booked, so the overnight fill never makes them).
 * A date that already holds `cap` of the type's posts books nothing more. A
 * Carousel never books on a Last Few Days day (Decision 7). Existing
 * bookings are taken as `${nyDate}|${slotId}`; a pre-cutover booking's
 * window id reads as its window's start minute (legacyKey), so it blocks the
 * free-time slot it became. SELECT only.
 */

export type FeedVertical = Exclude<Vertical, 'stories'>;

export type TemplateSlots = {
  /** Bookable slots per New York date: within the cap, minus full days and Carousels on LFD days. */
  byDate: Map<string, ResolvedSlot[]>;
  /** `${nyDate}|${slotId}` of every waiting, posting or posted booking of the type in the plan. */
  taken: Set<string>;
};

export async function templateSlots(q: SlotQuery, plan: SlotPlan, vertical: FeedVertical): Promise<TemplateSlots> {
  const cap = (await readCaps(q))[vertical];
  const { rows } = await q(
    `SELECT ny_date::text AS ny_date, slot FROM social_hub.schedule
      WHERE vertical = $1 AND status IN ('scheduled', 'publishing', 'published')
        AND ny_date >= $2::date AND ny_date <= $3::date`,
    [vertical, plan.from, plan.to],
  );
  const taken = new Set<string>();
  const perDay = new Map<string, number>();
  for (const r of rows) {
    const nyDate = String(r.ny_date).slice(0, 10);
    perDay.set(nyDate, (perDay.get(nyDate) ?? 0) + 1);
    const key = parseSlotId(String(r.slot)) ?? legacyKey(vertical, String(r.slot));
    if (key) taken.add(`${nyDate}|${slotId(key.startMinute, key.series)}`);
  }
  const byDate = new Map<string, ResolvedSlot[]>();
  for (const nyDate of plan.byDate.keys()) {
    if (vertical === 'carousels' && isLfdDay(plan, nyDate)) continue;
    if ((perDay.get(nyDate) ?? 0) >= cap) continue;
    byDate.set(nyDate, slotsWithinCap(plan, vertical, nyDate, cap).made);
  }
  return { byDate, taken };
}

/** The earliest bookable slot and its drifted minute (chooseSlotTime over templateSlots). */
export async function chooseTemplateSlot(
  q: SlotQuery,
  plan: SlotPlan,
  vertical: FeedVertical,
  opts: { now: Date; busy: readonly Date[]; rng: (count: number) => number; throughDate?: string },
): Promise<SlotChoice | null> {
  const { byDate, taken } = await templateSlots(q, plan, vertical);
  return chooseSlotTime(byDate, opts.now, taken, opts.busy, opts.rng, opts.throughDate);
}
