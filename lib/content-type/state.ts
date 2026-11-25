/**
 * The one control every content type has (settings standard, D16; planning/settings-standard/CONTRACT.md §1):
 *
 *  - paused:   the pool refills; nothing is made; nothing posts.
 *  - approval: the pool refills; posts are made and wait for review; nothing posts.
 *  - live:     the pool refills; posts are made and wait for review; approved posts go out at their slot time.
 *
 * Refill is not a control: it runs in every state, on its own spend cap, even when the day's quota is full (D3).
 * Every post needs a person's approval (require_approval is always true; there is no setting for it).
 *
 * The state is stored in the two keys each type already has (D7, contract §3): its Generate key
 * (auto_run / auto_render / auto / series auto) and publishing_live. Pure: no server imports, so workers,
 * routes and client code can all use it.
 */
import type { Vertical } from '@/lib/social-hub/types';

export type TypeState = 'paused' | 'approval' | 'live';

export const TYPE_STATES: readonly TypeState[] = ['paused', 'approval', 'live'];

export const isTypeState = (v: unknown): v is TypeState => TYPE_STATES.includes(v as TypeState);

/** What the Settings tab shows for each state. */
export const STATE_COPY: Record<TypeState, { label: string; line: string }> = {
  paused: { label: 'Paused', line: 'The pool keeps refilling. Nothing new is made and nothing posts.' },
  approval: { label: 'Approval', line: 'Posts are made and wait for your review. Nothing posts.' },
  live: { label: 'Live', line: 'Posts are made and wait for your review. Approved posts go out at their slot time.' },
};

/** The stored pair behind a state. */
export function keysOf(state: TypeState): { generate: boolean; live: boolean } {
  return { generate: state !== 'paused', live: state === 'live' };
}

/**
 * The state a stored pair means. Generate off with Live on is not a state: it reads as paused (nothing is
 * made, and a paused type posts nothing) with `mismatch` set so the caller logs `state_mismatch`.
 * A missing value is off (D6).
 */
export function stateOf(generate: boolean | null | undefined, live: boolean | null | undefined): { state: TypeState; mismatch: boolean } {
  const g = generate === true;
  const l = live === true;
  if (!g) return { state: 'paused', mismatch: l };
  return { state: l ? 'live' : 'approval', mismatch: false };
}

/** Whether a night run may make new posts in this state (the quota still applies). */
export const makesPosts = (state: TypeState): boolean => state !== 'paused';

/** Whether approved posts may go to Instagram in this state. */
export const postsToInstagram = (state: TypeState): boolean => state === 'live';

/** A paused type holds no slots (D17): its scheduled posts go back to the Made tab, still approved (D18). */
export const holdsSlots = (state: TypeState): boolean => state !== 'paused';

/** The reason written on a slot taken back to the Made tab (D17). */
export type UnslotReason = 'paused' | 'slot-passed';

/**
 * Default spend cap of one refill, in USD (D19, replacing D14): each type's run budget from before the split, so
 * no pool refills slower than it did. Text on Screen's web-search refill averaged ~$0.67 (max $1.36) over 30 days;
 * AI Drama's refill is its nightly development session (MD-156; also held to nightly_dev_cap_usd). All refills together are also
 * held to the nightly total (lib/content-type/refill-total.ts).
 */
export const REFILL_CAP_DEFAULT_USD: Record<Vertical, number> = {
  reels: 1.5,
  carousels: 2,
  last_few_days: 1,
  ai_events: 0.5,
  stories: 2,
  ai_trivia: 2,
  real_or_ai: 2,
  explainers: 1,
  reel_ai_drama: 3,
  field_notes: 0.5,
};

/** Default total of all refills in one New York night, in USD (D19). Stored in social_hub.settings `refill_total_cap_usd`. */
export const REFILL_TOTAL_DEFAULT_USD = 5;

/** A stored nightly total, or the default when missing or not a positive number. */
export function refillTotalUsd(stored: unknown): number {
  const n = typeof stored === 'string' ? Number(stored) : stored;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : REFILL_TOTAL_DEFAULT_USD;
}

/** A stored refill cap, or the type's default when missing or not a positive number. */
export function refillCapUsd(type: Vertical, stored: unknown): number {
  const n = typeof stored === 'string' ? Number(stored) : stored;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : REFILL_CAP_DEFAULT_USD[type];
}
