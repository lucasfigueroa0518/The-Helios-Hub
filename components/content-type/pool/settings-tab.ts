import { maxCapFor } from '@/lib/content-type/caps';
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

/** What the Posts and Posting windows blocks draw for one type. */
export type SettingsLayout = {
  /** The daily count control: the calendar's daily limit (template mode), the legacy posts-per-day stepper, or none. */
  posts: 'limit' | 'perDay' | null;
  /** The weekdays the type posts (read only, legacy mode), or null when every day. */
  days: number[] | null;
  /** Posting windows: the calendar's week strip (template mode) or the plan's windows line. */
  windows: 'calendar' | 'plan';
  /** The run and render caps live in this type's own form ("This type only"), so the Posts block points there. */
  capsInTypeForm: boolean;
};

/** Types whose run $ cap and render cap are edited in their own settings form (the Explainers and AI Drama forms). */
const CAPS_IN_FORM: ReadonlySet<Vertical> = new Set(['explainers', 'reel_ai_drama']);

export function settingsLayout(posting: Pick<PostingState, 'type' | 'perDay' | 'maxPerDay' | 'days' | 'schedule' | 'cap'>): SettingsLayout {
  const calendar = posting.schedule != null;
  const posts = calendar ? (posting.cap !== null ? 'limit' : null) : posting.perDay !== null && posting.maxPerDay !== null ? 'perDay' : null;
  // With the calendar, its week strip already says which days have slots.
  const days = calendar ? null : posting.days?.length ? [...posting.days] : planDays(posting.type);
  return { posts, days, windows: calendar ? 'calendar' : 'plan', capsInTypeForm: CAPS_IN_FORM.has(posting.type) };
}

/** The most a daily limit can be, from the type's config: AI Trivia and Real or AI? once a day (SS-24), Morning Download two (R25). */
export const capMax = (type: Vertical): number => maxCapFor(type);

/** The one line of settings that cover every type (D10). */
export const ALSO_AFFECTED = [
  { label: 'calendar template mode', href: '/social/calendar?view=week' },
  { label: 'publisher', href: '/social/health' },
] as const;
