/**
 * The carousel night's two decisions, from plain inputs so the refill split is tested offline (settings standard D3,
 * D16; CONTRACT.md §4). The carousel pool is the newest daily run's selection shortlist
 * (lib/social-hub/queries/carousels.ts CAROUSEL_IDEAS_SQL), so the run's selection is the refill: it runs every night,
 * in every state, whatever the quota. A night that makes no story runs it alone (`stories` 0), held to the refill cap.
 */
import type { ThreeAm } from '@/lib/lfd/clock';

/** What the 3:00 AM clock queues: Last Few Days' run on its night, and the carousel run every night (make or refill). */
export type ThreeAmRequests = { lfd: boolean; carousel: { mode: 'make' | 'refill'; capUsd: number; reason: string } };

export function threeAmRequests(slot: ThreeAm, o: { lfdRunCapUsd: number | null; carouselRunCapUsd: number; refillCapUsd: number }): ThreeAmRequests {
  const making = slot.queue === 'carousels';
  return {
    lfd: slot.queue === 'last_few_days' && o.lfdRunCapUsd != null,
    carousel: making ? { mode: 'make', capUsd: o.carouselRunCapUsd, reason: slot.reason } : { mode: 'refill', capUsd: o.refillCapUsd, reason: slot.reason },
  };
}

/** How a claimed carousel run is carried out: how many stories it makes, under which cap, and why it only refills. */
export type CarouselNight = { stories: number; capUsd: number; refillOnly: string | null };

/**
 * A claimed (not pinned, not rerun) carousel run. `slot`: tonight's 3:00 decision for a scheduled run (null for a
 * person's manual run, which keeps working in every state). `fill`: the stories the day's quota leaves (null when the
 * fill could not be read: run_stories, as before the rule). A run that makes nothing is never skipped: it refills the
 * pool under min(run cap, refill cap) (D3).
 */
export function carouselNight(o: { slot: ThreeAm | null; fill: { stories: number; note: string } | null; runStories: number; runCapUsd: number; refillCapUsd: number }): CarouselNight {
  const refill = (why: string): CarouselNight => ({ stories: 0, capUsd: Math.min(o.runCapUsd, o.refillCapUsd), refillOnly: why });
  if (o.slot && o.slot.queue !== 'carousels') return refill(o.slot.reason);
  const stories = o.fill ? o.fill.stories : o.runStories;
  if (o.fill && stories < 1) return refill(o.fill.note);
  return { stories, capUsd: o.runCapUsd, refillOnly: null };
}
