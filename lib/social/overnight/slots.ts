import { chooseWindow, openWindowRange, uniformIndex, type WindowChoice } from '@/lib/instagram/window';

import { CAROUSEL_SLOT } from './config';

/** The carousel posting window (7:00–8:15 AM New York), on the shared window rules. */

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
