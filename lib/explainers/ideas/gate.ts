/**
 * Explainers' 2 AM night, split into refill and make (settings standard D16, D3; CONTRACT.md §4). The refill (idea
 * generation, scoring and dedupe into explainers.topics) runs every night in every state and on a quota-full day,
 * held to `pool_refill_cap_usd` (D14). Rendering follows `makesPosts`, placing on the calendar `postsToInstagram`,
 * both under the day's quota. Pure apart from `readExplainersGate`.
 */
import type { Queryable } from '@/lib/explainers/db';
import { makesPosts, postsToInstagram, refillCapUsd, stateOf, type TypeState } from '@/lib/content-type/state';

export type ExplainersGate = {
  state: TypeState;
  /** Generate (auto_render) off with Live on: read as paused, logged as `state_mismatch`. */
  mismatch: boolean;
  /** Render pool topics tonight (the quota and render caps still apply). */
  makes: boolean;
  /** Place renders on the calendar. */
  books: boolean;
  /** The refill's cap in USD; null for a person's "Run the idea cycle now" (their click is the go-ahead, as before). */
  refillCapUsd: number | null;
};

export type ExplainersStoredState = { autoRender: unknown; publishingLive: unknown; refillCap: unknown };

/** `force`: a person's "Run the idea cycle now", which makes in every state as it did with auto_render off. */
export function explainersGate(stored: ExplainersStoredState, force = false): ExplainersGate {
  const { state, mismatch } = stateOf(stored.autoRender === true, stored.publishingLive === true);
  return {
    state,
    mismatch,
    makes: force || makesPosts(state),
    books: postsToInstagram(state),
    refillCapUsd: force ? null : refillCapUsd('explainers', stored.refillCap),
  };
}

/** The stored keys behind the gate, read raw from explainers.settings (the typed loader is not needed for three keys). */
export async function readExplainersStored(db: Queryable): Promise<ExplainersStoredState> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM explainers.settings WHERE key IN ('auto_render', 'publishing_live', 'pool_refill_cap_usd')`,
  );
  const value = (key: string) => rows.find((row) => row.key === key)?.value ?? null;
  return { autoRender: value('auto_render'), publishingLive: value('publishing_live'), refillCap: value('pool_refill_cap_usd') };
}

export async function readExplainersGate(db: Queryable, force = false): Promise<ExplainersGate> {
  return explainersGate(await readExplainersStored(db), force);
}
