/**
 * The Sunday 12:00 PM clock (AE-08), decided from plain inputs so the worker's clock is tested
 * offline. The worker wakes at 12:00 New York every day; this says whether that day queues an
 * AI Events run. A person's Generate is not the clock: it queues on any day (lib/ai-events/manual.ts).
 */
import { calendarDateKey, nextRunAt, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';

import { AI_EVENTS_RUN_HOUR_LOCAL, AI_EVENTS_RUN_MINUTE_LOCAL } from './config';
import type { AiEventsSettings } from './settings';

/**
 * `make`: the queued run also renders the week's posts (makesPosts, D16); false, it only ranks the week into
 * ai_events.pool (the refill), held to pool_refill_cap_usd.
 */
export type NoonDecision = { queue: boolean; reason: string; make?: boolean };

/** The next 12:00 PM New York after `from` (the worker checks the day with noonQueue). */
export function nextAiEventsRunAt(from: Date): Date {
  return nextRunAt(from, AI_EVENTS_RUN_HOUR_LOCAL, AI_EVENTS_RUN_MINUTE_LOCAL);
}

/**
 * When a starting worker first checks the noon clock: right away when it starts after today's
 * 12:00 New York (a restart on Sunday afternoon would otherwise skip that week's run, with no
 * catch-up), else at the next 12:00. A run for a week that already has a post skips itself, so a
 * catch-up check can never make a second post.
 */
export function firstAiEventsCheckAt(now: Date): Date {
  const next = nextAiEventsRunAt(now);
  // The next noon is tomorrow (more than 12h away) only when today's noon has already passed.
  return next.getTime() - now.getTime() > 12 * 60 * 60 * 1000 ? now : next;
}

const weekdayOf = (nyDate: string) => new Date(`${nyDate}T12:00:00Z`).getUTCDay();

/**
 * At 12:00 on one of its days (ai_events.settings.days, Sunday) an AI Events run is queued in every state: the
 * weekly ranking into ai_events.pool is the type's refill, and refill always runs (settings standard D3, D16;
 * CONTRACT.md §4). With auto_run on (Approval or Live) and a usable run cap the run also renders the posts
 * (`make`); paused, or with a bad run cap, it only ranks. Settings that could not be read or another weekday
 * queue nothing, and the reason says which. In template mode (`calendarDay` given) the calendar says whether
 * today has an AI Events slot instead of `days`.
 */
export function noonQueue(now: Date, s: AiEventsSettings | null, calendarDay: boolean | null = null): NoonDecision {
  const nyDate = calendarDateKey(now, SOCIAL_TIMEZONE);
  if (!s) return { queue: false, reason: 'the AI Events settings could not be read; no AI Events run' };
  const isDay = calendarDay ?? s.days.includes(weekdayOf(nyDate));
  if (!isDay) return { queue: false, reason: `${nyDate} is not an AI Events day` };
  if (!s.autoRun) return { queue: true, make: false, reason: 'an AI Events day; AI Events is paused, so the run only ranks the week (refill)' };
  if (s.runCapUsd == null) {
    return { queue: true, make: false, reason: `ai_events.settings.run_cap_usd is not a positive number (${JSON.stringify(s.runCapRaw)}); the run only ranks the week (refill)` };
  }
  return { queue: true, make: true, reason: 'an AI Events day' };
}
