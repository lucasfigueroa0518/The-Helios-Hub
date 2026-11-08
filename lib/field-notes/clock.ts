/**
 * The daily 12:00 PM check, decided from plain inputs so the worker's clock is tested offline.
 * Field Notes ships with auto_run off, so the check always says no until a person turns it on;
 * a person's Generate is not the clock: it queues on any day (lib/field-notes/manual.ts).
 */
import { calendarDateKey, nextRunAt, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';

import { FIELD_NOTES_AUTO_DAYS, FIELD_NOTES_RUN_HOUR_LOCAL, FIELD_NOTES_RUN_MINUTE_LOCAL } from './config';
import type { ParsedFieldNotesSettings } from './settings';

export type NoonDecision = { queue: boolean; reason: string };

/** The next 12:00 PM New York after `from`. */
export function nextFieldNotesRunAt(from: Date): Date {
  return nextRunAt(from, FIELD_NOTES_RUN_HOUR_LOCAL, FIELD_NOTES_RUN_MINUTE_LOCAL);
}

/** When a starting worker first checks the noon clock: right away when it starts after today's 12:00, else at the next 12:00. */
export function firstFieldNotesCheckAt(now: Date): Date {
  const next = nextFieldNotesRunAt(now);
  return next.getTime() - now.getTime() > 12 * 60 * 60 * 1000 ? now : next;
}

const weekdayOf = (nyDate: string) => new Date(`${nyDate}T12:00:00Z`).getUTCDay();

/**
 * With auto_run on, on one of its days, a run is queued. Settings that could not be read, auto_run
 * off, another weekday or a bad run cap queue nothing, and the reason says which.
 */
export function noonQueue(now: Date, s: ParsedFieldNotesSettings | null): NoonDecision {
  const nyDate = calendarDateKey(now, SOCIAL_TIMEZONE);
  if (!s) return { queue: false, reason: 'the Field Notes settings could not be read; no Field Notes run' };
  if (!s.autoRun) return { queue: false, reason: 'Field Notes auto_run is off' };
  if (!FIELD_NOTES_AUTO_DAYS.includes(weekdayOf(nyDate))) return { queue: false, reason: `${nyDate} is not a Field Notes day` };
  if (s.runCapUsd == null) {
    return { queue: false, reason: `field_notes.settings.run_cap_usd is not a positive number (${JSON.stringify(s.runCapRaw)}); no Field Notes run` };
  }
  return { queue: true, reason: 'a Field Notes day' };
}
