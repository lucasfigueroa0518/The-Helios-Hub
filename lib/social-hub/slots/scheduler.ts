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
 * A date that already holds `cap` of the type's posts books nothing more; a
 * post a person put in an over-cap slot doesn't count, so the within-cap
 * slots are still made in time order (spec §Safety cap). A
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
  const keys = rows.map((r) => {
    const nyDate = String(r.ny_date).slice(0, 10);
    const key = parseSlotId(String(r.slot)) ?? legacyKey(vertical, String(r.slot));
    const id = key ? slotId(key.startMinute, key.series) : null;
    if (id) taken.add(`${nyDate}|${id}`);
    return { nyDate, id };
  });
  const byDate = new Map<string, ResolvedSlot[]>();
  for (const nyDate of plan.byDate.keys()) {
    if (vertical === 'carousels' && isLfdDay(plan, nyDate)) continue;
    const { made, over } = slotsWithinCap(plan, vertical, nyDate, cap);
    // A post a person put in an over-cap slot is theirs, not the run's: it never starves a within-cap slot (spec §Safety cap).
    const overIds = new Set(over.map((x) => slotId(x.startMinute, x.series)));
    const counted = keys.filter((k) => k.nyDate === nyDate && !(k.id && overIds.has(k.id))).length;
    if (counted >= cap) continue;
    byDate.set(nyDate, made);
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
