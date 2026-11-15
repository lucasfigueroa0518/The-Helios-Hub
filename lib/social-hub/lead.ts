/**
 * Lead time per content type (Bald-Eagle D4, D8; planning/bald-eagle-2026-11-12/CONTRACT.md §Lead time).
 *
 * Tommy: "For evergreen content, we will have a 2-day cushion; for time-sensitive content like morning
 * download, that will be generated the day of." A type with lead 2 is made two New York days before
 * the day it posts, so a person has a full day to review it; a type with lead 0 is made the day it
 * posts, as before.
 *
 * How a type uses it (the night run of a cushion type):
 *   1. `fillDates(runDay, leadDaysFor(type))` lists the dates the night may fill. The type itself
 *      decides which of them are still unfilled (its quota minus every booking already there,
 *      lib/social-hub/fill.ts `dailyFill(..., { lead })`) and makes posts only for those.
 *   2. Every post it makes carries the date it is FOR (its target date) in the column it already
 *      uses for its day (`ny_date`, ...). The run date stays where the type already records it.
 *   3. Booking uses `fromDate = throughDate = target` (lib/social-hub/slots/book.ts chooseSlotTime,
 *      scheduler.ts chooseTemplateSlot, lib/instagram/window.ts chooseFromWindows). Approving keeps
 *      (or books) the target date's slot and never moves the item to today.
 *   4. Freshness windows (how recent a source must be) are measured from the RUN time, never the
 *      target date. Daily spend caps count against the target date.
 *   5. The board shows an unbooked item on its target date (lib/social-hub/adapters/common.ts boardDate).
 *
 * Every night run starts after midnight, so its run day is itself a posting day. fillDates therefore
 * includes the run day (integration review M1). The cutover (D8) needs no special code: on the first
 * night with lead 2, the run day, day+1 and day+2 are all unfilled, so the night fills all three (the
 * run day's window is still ahead at night). Every later night finds the run day and day+1 already
 * filled by the two nights before and makes only day+2.
 *
 * Pure: no DB, no clock. Imports types and date arithmetic only (no node modules), so workers, client
 * views and tests can all use it.
 */
import type { StorySeries } from '@/lib/social-hub/slots/types';
import { addDays } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';

export type LeadKey = Vertical | `stories:${StorySeries}`;

/**
 * Days between the night a post is made and the New York day it posts.
 * 2: Text on Screen (`reels`), Explainers, AI Drama, Field Notes, Guess the Number, Free vs. Paid.
 * 0: Carousels, Last Few Days, Morning Download, and AI Events (already made a week ahead by its own clock; untouched).
 * `stories` alone (no series) reads as the same-day default; a Stories caller passes its series.
 */
export const LEAD_DAYS: Readonly<Record<LeadKey, number>> = Object.freeze({
  reels: 2,
  explainers: 2,
  reel_ai_drama: 2,
  field_notes: 2,
  'stories:guess_the_number': 2,
  'stories:free_vs_paid': 2,
  carousels: 0,
  last_few_days: 0,
  ai_events: 0,
  stories: 0,
  'stories:morning_download': 0,
});

/** A type's lead days. Stories go by series (`leadDaysFor('stories', 'guess_the_number')` is 2); unknown keys read as 0. */
export function leadDaysFor(vertical: Vertical, series?: StorySeries | null): number {
  const key: LeadKey = vertical === 'stories' && series ? `stories:${series}` : vertical;
  return LEAD_DAYS[key] ?? 0;
}

/**
 * The New York dates a night run may fill: runDay through runDay+lead (just runDay when lead is 0),
 * ascending. These are candidates; the caller drops the ones its quota says are already filled (in
 * the steady state that leaves only runDay+lead) and, for the run day, any slot whose time has passed.
 *   fillDates('2026-11-12', 0) → ['2026-11-12']
 *   fillDates('2026-11-12', 2) → ['2026-11-12', '2026-11-13', '2026-11-14']
 */
export function fillDates(runDay: string, lead: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDay)) throw new Error(`fillDates: runDay must be YYYY-MM-DD, got ${JSON.stringify(runDay)}`);
  const n = Number.isFinite(lead) && lead > 0 ? Math.floor(lead) : 0;
  return Array.from({ length: n + 1 }, (_, i) => addDays(runDay, i));
}

/** The steady-state target of a night run: runDay + lead (Morning Download: runDay; Guess the Number: runDay + 2). */
export function targetDateFor(runDay: string, vertical: Vertical, series?: StorySeries | null): string {
  return addDays(runDay, leadDaysFor(vertical, series));
}

/** The night that makes a target date in the steady state: target − lead (the board's "the 2 AM run makes it on …"). */
export function runDayFor(targetDay: string, vertical: Vertical, series?: StorySeries | null): string {
  return addDays(targetDay, -leadDaysFor(vertical, series));
}
