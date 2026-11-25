import { generateCopy } from '@/lib/content-type/config';
import type { PostingState } from '@/lib/content-type/posting';
import { STATE_COPY, type TypeState } from '@/lib/content-type/state';
import { clockLabel } from '@/lib/social-hub/slots/times';
import type { Vertical } from '@/lib/social-hub/types';
import { REFILL_CADENCE } from '@/lib/social-hub/views/pools';
import { PLAN } from '@/lib/social-hub/views/plan';

/**
 * The words and layout of a pool's Settings tab (settings standard D8, D9, D16–D18; CONTRACT.md §2). Pure, so the
 * tab's choices are tested offline (tests/content-type-settings-tab.test.ts) and the component only draws them.
 */

/** Moving to Live (CONTRACT.md §2). */
export const LIVE_CONFIRM = 'Approved posts will go to Instagram at their slot times.';

/** Moving to Paused (D17): the type's scheduled posts leave their slots and go back to the Made tab, still approved (D18). */
export function pauseConfirm(scheduledAhead: number): string {
  const n = Math.max(0, Math.floor(scheduledAhead));
  if (n === 0) return 'No scheduled posts will go back to the Made tab.';
  return `${n} scheduled ${n === 1 ? 'post' : 'posts'} will go back to the Made tab.`;
}

/** The question asked before a state change, or null when the move needs none (Live to Approval, or no move). */
export type StateAsk = { title: string; lines: string[]; ok: string };

/**
 * What a move from `from` to `to` asks first. Live and Paused ask as the contract says. Leaving Paused also starts the
 * nightly make step again, which spends, so it states the type's own make line (generateCopy, the words the old
 * Generate switch confirmed with); the contract is silent on that move.
 */
export function stateAsk(type: Vertical, from: TypeState, to: TypeState, scheduledAhead: number): StateAsk | null {
  if (from === to) return null;
  if (to === 'paused') return { title: 'Pause this type?', lines: [pauseConfirm(scheduledAhead), 'The pool keeps refilling.'], ok: 'Pause' };
  const lines: string[] = [];
  if (from === 'paused') lines.push(generateCopy(type).confirm);
  if (to === 'live') lines.push(LIVE_CONFIRM);
  if (!lines.length) return null;
  return { title: to === 'live' ? 'Go live?' : 'Make posts again?', lines, ok: to === 'live' ? 'Go live' : 'Turn on Approval' };
}

/** The line under the state control. */
export const stateLine = (state: TypeState): string => STATE_COPY[state].line;

/** The Pool block's refill line: "Refills every night", or the type's own cadence sentence. */
export function refillLine(type: Vertical): string {
  const cadence = REFILL_CADENCE[type];
  return /^[A-Z]/.test(cadence) ? cadence : `Refills ${cadence}`;
}

/** A typed refill cap in USD: a positive amount, rounded to the cent. Empty, zero or not a number is an error, never sent. */
export function parseCapUsd(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim().replace(/^\$/, '');
  if (!t) return { ok: false, error: 'Enter an amount' };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Enter an amount above $0' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Tue, Fri"; every day reads "Every day". */
export function daysLabel(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  return sorted.length === 7 ? 'Every day' : sorted.map((d) => DAY_NAMES[d]).join(', ');
}

/** The read-only posting windows line from the type's plan: "Morning 8:45 AM–10:00 AM · Evening 6:00 PM–9:00 PM". */
export function windowsLine(type: Vertical): string {
  const windows = PLAN[type];
  if (!windows.length) return 'No set windows: posts go where a slot is placed on the calendar.';
  return windows.map((w) => `${w.label} ${clockLabel(w.startMinute)}–${clockLabel(w.endMinute)}`).join(' · ');
}

/** The posting days from the plan's windows when the posting state has none; null when the windows run every day. */
export function planDays(type: Vertical): number[] | null {
  const days = PLAN[type].flatMap((w) => (w.days ? [...w.days] : [0, 1, 2, 3, 4, 5, 6]));
  const set = [...new Set(days)].sort((a, b) => a - b);
  return set.length && set.length < 7 ? set : null;
}

const TIMES_A_DAY = ['', 'once', 'twice'];

/** The weekday (0 = Sunday) of a New York date "YYYY-MM-DD". */
const weekdayOf = (nyDate: string): number => new Date(`${nyDate}T12:00:00Z`).getUTCDay();

/**
 * The Schedule block's one line (D20): the Calendar owns when and how many, so Settings only says what it set and
 * links there. From this week's slots: "Posts once a day, Mon, Thu"; uneven days: "Posts 5 times this week, Mon, Tue, Fri".
 * Without the calendar (legacy) it falls back to the plan's windows and days.
 */
export function scheduleLine(posting: Pick<PostingState, 'type' | 'days' | 'schedule'>): string {
  if (!posting.schedule) {
    const days = posting.days?.length ? [...posting.days] : planDays(posting.type);
    return `${windowsLine(posting.type)}${days ? ` · ${daysLabel(days)}` : ''}`;
  }
  const on = posting.schedule.filter((d) => d.count > 0);
  if (!on.length) return 'No times on the Calendar this week.';
  const label = daysLabel(on.map((d) => weekdayOf(d.nyDate)));
  const days = label === 'Every day' ? 'every day' : label;
  const counts = new Set(on.map((d) => d.count));
  if (counts.size === 1) {
    const n = on[0].count;
    return `Posts ${TIMES_A_DAY[n] ?? `${n} times`} a day, ${days}`;
  }
  return `Posts ${on.reduce((a, d) => a + d.count, 0)} times this week, ${days}`;
}

/** Where the Schedule line's link goes: the Calendar, where times and days are set. */
export const CALENDAR_HREF = '/social/calendar?view=week';

/** The one line of settings that cover every type (D10). */
export const ALSO_AFFECTED = [
  { label: 'publisher', href: '/social/health' },
] as const;
