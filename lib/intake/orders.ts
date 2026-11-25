/**
 * The intake orders (Owner B; plan round 4). Code-defined. Each order names the sources and scorecards its type
 * reads.
 *
 * Settings standard (D16, CONTRACT.md §4): the intake is the pool refill for Carousels, Last Few Days, Morning
 * Download, Field Notes, Trial Reels and AI Trivia's research, and refill runs in every state (Paused, Approval,
 * Live), whatever the day's quota (D3). So every order of a type that is not retired is open on every run: no
 * order reads its type's Generate switch, queue or seeds any more. A retired type has no order (Free vs. Paid's
 * 'fvp' and Guess the Number's are gone, SS-31, AT-14), so it never refills.
 *
 * Spend: each run stays under its own cap (main $0.50, top-up and manual $0.15, deposit; lib/intake/types.ts). The
 * intake does not attribute cost to one type (its scorecards are shared across orders), so a type's
 * pool_refill_cap_usd is not applied here; the run caps are the bound.
 */
import { TRIVIA_SOURCE_ID } from './deposit';
import type { IntakeOrder, IntakeQuery, OrderId, ScorecardId } from './types';

const FULL: readonly ScorecardId[] = ['reels-score', 'story-scoring', 'major-news', 'story-builder'];

/** Refill runs in every state (D16), so a type's order is open on every run. */
export const alwaysOpen = async (_q?: IntakeQuery, _now?: Date): Promise<boolean> => true;

export const LFD_ORDER: IntakeOrder = {
  id: 'lfd',
  sources: ['reels:*', 'feeds:*'],
  lookbackDays: 10,
  scorecards: FULL,
  isOpen: alwaysOpen,
};

export const MD_ORDER: IntakeOrder = {
  id: 'md',
  sources: ['reels:*', 'feeds:*'],
  lookbackDays: 4,
  scorecards: FULL,
  isOpen: alwaysOpen,
};

// SS-31: Free vs. Paid's order ('fvp') is retired with the series; run records and consumer rows naming it still read.

/**
 * "Are you smarter than AI?" (SS-30): the pages its daily writer cited, deposited under `search:trivia`
 * (lib/intake/deposit.ts TRIVIA_DEPOSIT) and read back as research in intake mode (lib/stories/trivia/research.ts).
 * No scorecard: every existing one judges news (reels-score, story-scoring, major-news, story-builder) or a Field
 * Notes tip, none judges a fact page, and the questions written from them are scored by trivia-score@3 anyway. So the
 * order is a pass-through: no Jev is spent on its items (and they are never grouped, SS-32). Open on every run, like
 * every order (D16).
 */
export const TRIVIA_ORDER: IntakeOrder = {
  id: 'trivia',
  sources: [TRIVIA_SOURCE_ID],
  lookbackDays: 30,
  scorecards: [],
  isOpen: alwaysOpen,
};

/*
 * Real or AI? has no intake order (SS-30): it reads no news. Its "scrapes" are photo requests (real photos from
 * Commons and NASA) through the shared photo finder and the photo bank (lib/photos, owner D of the Stories split).
 */

/* ── Phase 2 orders ───────────────────────────────────────────────────── */

/** Trial Reels: the primary adapters plus its own search deposits (family 'search' is covered by 'reels:*'). */
export const REELS_ORDER: IntakeOrder = {
  id: 'reels',
  sources: ['reels:*'],
  lookbackDays: 14,
  scorecards: ['reels-screen', 'reels-score'],
  isOpen: alwaysOpen,
};

/** Carousels: the 19 feeds plus the reels primary adapters (today's carousel re-fetches them as hub sources). */
export const CAROUSEL_ORDER: IntakeOrder = {
  id: 'carousel',
  sources: ['feeds:*', 'reels:*'],
  lookbackDays: 2,
  scorecards: ['story-scoring'],
  isOpen: alwaysOpen,
};

/** Field Notes: every SOURCE_REGISTRY entry; each item its own story. */
export const FIELD_NOTES_ORDER: IntakeOrder = {
  id: 'field-notes',
  sources: ['field-notes:*'],
  lookbackDays: 45,
  scorecards: ['field-notes-score'],
  isOpen: alwaysOpen,
};

export const INTAKE_ORDERS: readonly IntakeOrder[] = [LFD_ORDER, MD_ORDER, REELS_ORDER, CAROUSEL_ORDER, FIELD_NOTES_ORDER, TRIVIA_ORDER];

export const orderById = (id: OrderId): IntakeOrder => INTAKE_ORDERS.find((o) => o.id === id)!;

/** The orders open now, in INTAKE_ORDERS order. */
export async function openOrders(q: IntakeQuery, now: Date, orders: readonly IntakeOrder[] = INTAKE_ORDERS): Promise<IntakeOrder[]> {
  const open = await Promise.all(orders.map((o) => o.isOpen(q, now)));
  return orders.filter((_, i) => open[i]);
}
