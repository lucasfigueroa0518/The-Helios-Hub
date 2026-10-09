import { chooseFromWindows, chooseWindow, openWindowRange, uniformIndex, type WindowChoice } from '@/lib/instagram/window';

import { CAROUSEL_SLOT, CAROUSEL_SLOTS } from './config';

/** The carousel posting windows (New York), on the shared window rules. */

export type CarouselSlotChoice = WindowChoice;

export { uniformIndex };

export function openMinuteRange(nyDate: string, now: Date) {
  return openWindowRange(CAROUSEL_SLOT, nyDate, now);
}

export function chooseCarouselSlot(
  now: Date,
  taken: ReadonlySet<string>,
  rng: (count: number) => number = uniformIndex,
  throughDate?: string,
): CarouselSlotChoice | null {
  return chooseWindow(CAROUSEL_SLOT, now, taken, rng, throughDate);
}

/** The first `perDay` windows, spaced ≥ 30 minutes from every other feed post (SH-47). */
export function chooseCarouselSlots(
  now: Date,
  takenSlots: ReadonlySet<string>,
  busy: readonly Date[],
  perDay: number,
  rng: (count: number) => number = uniformIndex,
  throughDate?: string,
): CarouselSlotChoice | null {
  return chooseFromWindows(CAROUSEL_SLOTS.slice(0, Math.max(1, Math.min(perDay, CAROUSEL_SLOTS.length))), now, takenSlots, busy, rng, throughDate);
}
