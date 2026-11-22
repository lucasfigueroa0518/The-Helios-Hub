/**
 * The daily 2:00 AM check (night schedule v2; it was 12:00 PM), decided from plain inputs so the worker's clock is tested offline.
 * Field Notes ships with auto_run off, so the check always says no until a person turns it on;
 * a person's Generate is not the clock: it queues on any day (lib/field-notes/manual.ts).
 *
 * Lead time (Bald-Eagle D4): Field Notes is made 2 days ahead. The rule: the 2:00 AM check on run day R
 * looks at the dates R … R+2 (lib/social-hub/lead.ts fillDates; R's 2:30 PM window is still ahead at
 * 2:00 AM) and queues one run for the EARLIEST of
 * them that is a Field Notes day (a calendar slot in template mode, Tuesday/Friday in legacy mode) and has
 * no Field Notes post yet (`filled`: a post made for it, or a booking on it). The run carries that date
 * (field_notes.runs.ny_date) and its post is stamped with it. In the steady state the run happens exactly 2
 * days before each Field Notes day (Sunday for Tuesday, Wednesday for Friday). The cutover night (D8) may
 * find R or R+1 unfilled too and makes the earliest first; another unfilled date in the window is made by
 * a later night (one run a night, the runs table holds one queued run), at the latest on its own day's 2:00
 * AM check, when its window is still ahead. Every Field Notes day gets at most one post from the clock.
 */
import { calendarDateKey, nextRunAt, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { fillDates, leadDaysFor } from '@/lib/social-hub/lead';

import { FIELD_NOTES_AUTO_DAYS, FIELD_NOTES_RUN_HOUR_LOCAL, FIELD_NOTES_RUN_MINUTE_LOCAL } from './config';
import type { ParsedFieldNotesSettings } from './settings';

/** `target`: the New York date the queued run makes its post for (set only when `queue`). */
export type NoonDecision = { queue: boolean; reason: string; target?: string };

/** The next 2:00 AM New York (FIELD_NOTES_RUN_HOUR_LOCAL) after `from`. */
export function nextFieldNotesRunAt(from: Date): Date {
  return nextRunAt(from, FIELD_NOTES_RUN_HOUR_LOCAL, FIELD_NOTES_RUN_MINUTE_LOCAL);
}

/**
 * When a starting worker first checks the clock: right away when today's (New York) check time
 * already passed, else at today's check time. Decided by calendar day, not by a 12-hour gap, so it
 * holds for any check hour (the old noon rule, "next run more than 12 h away", fails at 2:00 AM).
 */
export function firstFieldNotesCheckAt(now: Date): Date {
  const next = nextFieldNotesRunAt(now);
  return calendarDateKey(next, SOCIAL_TIMEZONE) === calendarDateKey(now, SOCIAL_TIMEZONE) ? next : now;
}

const weekdayOf = (nyDate: string) => new Date(`${nyDate}T12:00:00Z`).getUTCDay();

/** A worker that starts after the 2:00 AM check catches it up only this long after it (fix 8). */
export const FIELD_NOTES_CATCH_UP_MS = 2 * 60 * 60 * 1000;

/** Today's (New York) check time when it already passed, else yesterday's: the latest check at or before `now`. */
export function lastFieldNotesCheckAt(now: Date): Date {
  return nextFieldNotesRunAt(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

/** Whether a date is a Field Notes day by the fixed days (legacy mode): Tuesday and Friday. */
export const isAutoFieldNotesDay = (nyDate: string): boolean => FIELD_NOTES_AUTO_DAYS.includes(weekdayOf(nyDate));

/**
 * The date the 2:00 AM run on `runDay` makes a post for: the earliest date in fillDates(runDay, lead) that
 * is a Field Notes day (`isDay`) and not already `filled`; null when none is. Pure.
 */
export function fieldNotesTarget(runDay: string, isDay: (nyDate: string) => boolean, filled: ReadonlySet<string> = new Set()): string | null {
  return fillDates(runDay, leadDaysFor('field_notes')).find((d) => isDay(d) && !filled.has(d)) ?? null;
}

/**
 * With auto_run on, a run is queued when the fill window has an unfilled Field Notes day (fieldNotesTarget,
 * the rule in this file's header); `target` names it. Settings that could not be read, auto_run off, no
 * unfilled Field Notes day or a bad run cap queue nothing, and the reason says which. Never twice a night
 * (fix 8): nothing is queued when a scheduled run was already requested on today's New York date
 * (`scheduledToday`, store.scheduledRunToday; null = unknown), or when the check is more than
 * FIELD_NOTES_CATCH_UP_MS past today's 2:00 AM (a worker restarted later in the day). In template mode
 * (`calendar` given) a calendar slot on a date makes it a Field Notes day on any weekday, and no slot makes it
 * none; legacy mode (null) keeps the fixed days. `filled`: the dates in the window that already have a Field
 * Notes post or booking (store.fieldNotesFilledDates).
 */
export function noonQueue(
  now: Date,
  s: ParsedFieldNotesSettings | null,
  scheduledToday: boolean | null = null,
  calendar: ((nyDate: string) => boolean) | null = null,
  filled: ReadonlySet<string> = new Set(),
): NoonDecision {
  const nyDate = calendarDateKey(now, SOCIAL_TIMEZONE);
  if (scheduledToday) return { queue: false, reason: `a scheduled Field Notes run was already queued on ${nyDate}` };
  const late = now.getTime() - lastFieldNotesCheckAt(now).getTime();
  if (late > FIELD_NOTES_CATCH_UP_MS) {
    return { queue: false, reason: `the 2:00 AM check is ${Math.round(late / 60_000)} min past; catch-up only within 2 h; no Field Notes run` };
  }
  if (!s) return { queue: false, reason: 'the Field Notes settings could not be read; no Field Notes run' };
  if (!s.autoRun) return { queue: false, reason: 'Field Notes auto_run is off' };
  const window = fillDates(nyDate, leadDaysFor('field_notes'));
  const target = fieldNotesTarget(nyDate, calendar ?? isAutoFieldNotesDay, filled);
  if (!target) return { queue: false, reason: `no unfilled Field Notes day in ${window.join(', ')}` };
  if (s.runCapUsd == null) {
    return { queue: false, reason: `field_notes.settings.run_cap_usd is not a positive number (${JSON.stringify(s.runCapRaw)}); no Field Notes run` };
  }
  return { queue: true, target, reason: `${target} is ${calendar ? 'a Field Notes slot on the calendar' : 'a Field Notes day'}` };
}

/**
 * The refill night (settings standard D3, D16; CONTRACT.md §4): finding and scoring new tips is Field Notes' refill and
 * runs in every state, on its Tue/Fri cadence: the 2:00 AM check of a Field Notes day (a calendar slot in template mode,
 * Tuesday or Friday in legacy mode) queues a refill-only run when noonQueue queued no post run that night (paused, or
 * the days ahead already filled: the quota never stops a refill). A post run refills first itself, so a night never
 * gets both. The same guards as noonQueue: never twice a night, catch-up only within 2 h, unreadable settings queue
 * nothing.
 */
export function refillNight(now: Date, s: ParsedFieldNotesSettings | null, scheduledToday: boolean | null = null, calendar: ((nyDate: string) => boolean) | null = null): NoonDecision {
  const nyDate = calendarDateKey(now, SOCIAL_TIMEZONE);
  if (scheduledToday) return { queue: false, reason: `a scheduled Field Notes run was already queued on ${nyDate}` };
  const late = now.getTime() - lastFieldNotesCheckAt(now).getTime();
  if (late > FIELD_NOTES_CATCH_UP_MS) return { queue: false, reason: `the 2:00 AM check is ${Math.round(late / 60_000)} min past; no Field Notes refill` };
  if (!s) return { queue: false, reason: 'the Field Notes settings could not be read; no Field Notes refill' };
  if (!(calendar ?? isAutoFieldNotesDay)(nyDate)) return { queue: false, reason: `${nyDate} is not a Field Notes day; no refill tonight` };
  return { queue: true, reason: `${nyDate} is a Field Notes day: the tip pool refills` };
}
