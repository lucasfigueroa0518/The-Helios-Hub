// lib/lfd/clock.ts
/** The 3:00 AM slot (spec §7.3, LFD-02), decided from plain inputs so the worker's clock is tested offline. */
import { weekdayOfDate } from './days';
import type { LfdSettings } from './settings';

export type ThreeAm = { queue: 'last_few_days' | 'carousels' | 'none'; reason: string };

/**
 * On a Last Few Days day with its auto_run on, Last Few Days runs and the
 * carousel run does not (one type per hour). Any other day belongs to the
 * carousel run, as before. With LFD's auto_run off, Tuesday and Friday are
 * ordinary carousel days. A bad run cap on an LFD day queues nothing at all.
 * In template mode (`lfdDay` given) the calendar says whether today is an LFD
 * day, and the calendar is literal: an LFD day with LFD paused runs neither
 * Last Few Days nor Carousels (Decision 7).
 */
export function threeAmQueue(nyDate: string, lfd: LfdSettings | null, carouselAutoRun: boolean, lfdDay: boolean | null = null): ThreeAm {
  const isLfdDay = lfdDay ?? Boolean(lfd?.autoRun && lfd.days.includes(weekdayOfDate(nyDate)));
  if (isLfdDay && lfdDay !== null && !lfd?.autoRun) {
    return { queue: 'none', reason: 'a Last Few Days day on the calendar, and Last Few Days is paused; no carousel run (the calendar is literal)' };
  }
  if (isLfdDay) {
    return lfd?.runCapUsd == null
      ? { queue: 'none', reason: `lfd.settings.run_cap_usd is not a positive number (${JSON.stringify(lfd?.runCapRaw)}); no Last Few Days run, and no carousel run on its day` }
      : { queue: 'last_few_days', reason: 'a Last Few Days day' };
  }
  return carouselAutoRun ? { queue: 'carousels', reason: 'auto_run is on' } : { queue: 'none', reason: 'auto_run is off' };
}
