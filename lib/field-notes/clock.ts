/**
 * The daily 2:00 AM check (night schedule v2; it was 12:00 PM), decided from plain inputs so the worker's clock is tested offline.
 * Field Notes ships with auto_run off, so the check always says no until a person turns it on;
 * a person's Generate is not the clock: it queues on any day (lib/field-notes/manual.ts).
 */
import { calendarDateKey, nextRunAt, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';

import { FIELD_NOTES_AUTO_DAYS, FIELD_NOTES_RUN_HOUR_LOCAL, FIELD_NOTES_RUN_MINUTE_LOCAL } from './config';
import type { ParsedFieldNotesSettings } from './settings';

export type NoonDecision = { queue: boolean; reason: string };

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

/**
 * With auto_run on, on one of its days, a run is queued. Settings that could not be read, auto_run
 * off, another weekday or a bad run cap queue nothing, and the reason says which. Never twice a day
 * (fix 8): nothing is queued when a scheduled run already exists for today's New York date
 * (`scheduledToday`, store.scheduledRunToday; null = unknown), or when the check is more than
 * FIELD_NOTES_CATCH_UP_MS past today's 2:00 AM (a worker restarted later in the day).
 */
export function noonQueue(now: Date, s: ParsedFieldNotesSettings | null, scheduledToday: boolean | null = null): NoonDecision {
  const nyDate = calendarDateKey(now, SOCIAL_TIMEZONE);
  if (scheduledToday) return { queue: false, reason: `a scheduled Field Notes run already exists for ${nyDate}` };
  const late = now.getTime() - lastFieldNotesCheckAt(now).getTime();
  if (late > FIELD_NOTES_CATCH_UP_MS) {
    return { queue: false, reason: `the 2:00 AM check is ${Math.round(late / 60_000)} min past; catch-up only within 2 h; no Field Notes run` };
  }
  if (!s) return { queue: false, reason: 'the Field Notes settings could not be read; no Field Notes run' };
  if (!s.autoRun) return { queue: false, reason: 'Field Notes auto_run is off' };
  if (!FIELD_NOTES_AUTO_DAYS.includes(weekdayOf(nyDate))) return { queue: false, reason: `${nyDate} is not a Field Notes day` };
  if (s.runCapUsd == null) {
    return { queue: false, reason: `field_notes.settings.run_cap_usd is not a positive number (${JSON.stringify(s.runCapRaw)}); no Field Notes run` };
  }
  return { queue: true, reason: 'a Field Notes day' };
}
