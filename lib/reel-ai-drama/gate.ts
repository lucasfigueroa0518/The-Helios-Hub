/**
 * AI Drama split into refill and make (settings standard D16, D3; CONTRACT.md §4). The refill is the daily pool
 * tending (no model call) and the weekly development session, which run in every state; the session is held to
 * `pool_refill_cap_usd` (D14). The night fill is the make step: it requests reels only while the type makes posts,
 * and books them only while it is Live. Pure apart from `readDramaGate`.
 */
import type { Queryable } from '@/lib/explainers/db';
import { makesPosts, postsToInstagram, refillCapUsd, stateOf, type TypeState } from '@/lib/content-type/state';

export type DramaGate = {
  state: TypeState;
  /** Generate (`auto`) off with Live on: read as paused, logged as `state_mismatch`. */
  mismatch: boolean;
  /** The night fill may request reels (the quota and caps still apply). */
  makes: boolean;
  /** Reels may be booked and posted. */
  books: boolean;
  /** The weekly development session's refill cap in USD. */
  refillCapUsd: number;
};

export type DramaStoredState = { auto: unknown; publishingLive: unknown; refillCap: unknown };

export function dramaGate(stored: DramaStoredState): DramaGate {
  const { state, mismatch } = stateOf(stored.auto === true, stored.publishingLive === true);
  return { state, mismatch, makes: makesPosts(state), books: postsToInstagram(state), refillCapUsd: refillCapUsd('reel_ai_drama', stored.refillCap) };
}

/** The stored keys behind the gate, read raw from reel_ai_drama.settings. */
export async function readDramaGate(db: Queryable): Promise<DramaGate> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM reel_ai_drama.settings WHERE key IN ('auto', 'publishing_live', 'pool_refill_cap_usd')`,
  );
  const value = (key: string) => rows.find((row) => row.key === key)?.value ?? null;
  return dramaGate({ auto: value('auto'), publishingLive: value('publishing_live'), refillCap: value('pool_refill_cap_usd') });
}
