/**
 * Text on Screen's night, split into refill and make (settings standard D16, D3; CONTRACT.md §4). The refill (ingest,
 * grouping and idea scoring; song ingest runs on its own at 12:30) runs in every state and on a quota-full day, held to
 * `pool_refill_cap_usd` (D14). Writing copy, rendering and booking follow the state: made only when `makesPosts`,
 * booked only when `postsToInstagram`, and still under the day's quota. Pure; the read is separate so tests pass a gate.
 */
import { makesPosts, postsToInstagram, refillCapUsd, stateOf, type TypeState } from '@/lib/content-type/state';
import type { RunTrigger } from '@/lib/reels/types';

export type ReelsNightGate = {
  state: TypeState;
  /** Generate off with Live on: read as paused, logged as `state_mismatch`. */
  mismatch: boolean;
  /** Write copy and render tonight's reels (the quota still applies). */
  makes: boolean;
  /** Book tonight's reels into slots. */
  books: boolean;
  /** The refill's cap in USD; null for a person's Run now (their click is the go-ahead, as before). */
  refillCapUsd: number | null;
};

export type ReelsStoredState = { autoRun: unknown; publishingLive: unknown; refillCap: unknown };

const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/**
 * The scheduled night refills on its cap whatever the state, and makes and books by the state. A person's Run now
 * makes in every state (as it did with auto_run off), but books only while the type is Live: posting is never a
 * side effect of a click on a type that isn't Live.
 */
export function reelsNightGate(trigger: RunTrigger, stored: ReelsStoredState): ReelsNightGate {
  const { state, mismatch } = stateOf(bool(stored.autoRun), bool(stored.publishingLive));
  const manual = trigger === 'manual';
  return {
    state,
    mismatch,
    makes: manual || makesPosts(state),
    books: postsToInstagram(state),
    refillCapUsd: manual ? null : refillCapUsd('reels', stored.refillCap),
  };
}

/** The gate from reels.settings. */
export async function readReelsNightGate(trigger: RunTrigger): Promise<ReelsNightGate> {
  const { getSetting } = await import('@/lib/reels/music/store');
  const [autoRun, publishingLive, refillCap] = await Promise.all([
    getSetting<unknown>('auto_run'),
    getSetting<unknown>('publishing_live'),
    getSetting<unknown>('pool_refill_cap_usd'),
  ]);
  return reelsNightGate(trigger, { autoRun, publishingLive, refillCap });
}

/** Whether due Text on Screen slots may be released and posted right now (Live only). */
export async function reelsPostsToInstagram(): Promise<boolean> {
  return (await readReelsNightGate('scheduled')).books;
}
