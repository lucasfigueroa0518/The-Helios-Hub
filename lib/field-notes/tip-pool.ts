/**
 * The Field Notes tip pool keeps the best FIELD_NOTES_POOL_TARGET found tips (Lucas, 2026-11-24: "keep the best 30").
 *
 * The nightly refill used to save every new scored intake story, so the pool grew by ~40 a night (820 waiting on
 * 2026-11-24) against at most ~12 used a week. Now the refill tops the pool up to the target, best score first; when it
 * is full, a new story gets in only by beating the weakest waiting tip, which expires with POOL_TRIM_REASON. A tip
 * selection can never pick (score 0, an old question set, set aside after MAX_TIP_ATTEMPTS, archived from the queue)
 * ranks 0 and always goes. Stories left out stay in the intake (45-day lookback) and are offered again each night.
 *
 * Not counted and never trimmed: a person's seeds and the queue's pinned or dragged tips. A trim is a status change on
 * the type's own candidates only: nothing is scored, enriched or rewritten (CLAUDE.md Rule 2), and an expired tip can
 * be set back to candidate by hand.
 */
import type { HubQuery } from '@/lib/social-hub/db';

import { listWaitingFoundTips } from './store';

export const FIELD_NOTES_POOL_TARGET = 30;
export const POOL_TRIM_REASON = 'pool-trim: a better tip took its place in the best-30 pool';

export type PoolEntry<K> = { key: K; score: number };

/**
 * Pure. Which incoming tips to admit and which waiting tips to expire so the pool holds the best `target`. Ties keep
 * the waiting tip (no churn), then the given order. Nothing scoring 0 or less is kept. `waiting` must already leave
 * out protected tips.
 */
export function planTipPool<K>(o: { waiting: readonly PoolEntry<string>[]; incoming: readonly PoolEntry<K>[]; target: number }): { admit: K[]; expire: string[] } {
  type Entry = { from: 'waiting'; key: string; score: number; i: number } | { from: 'incoming'; key: K; score: number; i: number };
  const all: Entry[] = [
    ...o.waiting.map((w, i): Entry => ({ from: 'waiting', key: w.key, score: w.score, i })),
    ...o.incoming.map((n, i): Entry => ({ from: 'incoming', key: n.key, score: n.score, i })),
  ];
  all.sort((a, b) => b.score - a.score || (a.from === b.from ? a.i - b.i : a.from === 'waiting' ? -1 : 1));
  const kept = new Set<Entry>(all.filter((e) => e.score > 0).slice(0, Math.max(0, o.target)));
  const admit: K[] = [];
  const expire: string[] = [];
  for (const e of all) {
    if (e.from === 'incoming' && kept.has(e)) admit.push(e.key);
    if (e.from === 'waiting' && !kept.has(e)) expire.push(e.key);
  }
  return { admit, expire };
}

/** protectedIds: the queue's pins and dragged tips (not counted, never trimmed). archivedIds: archived from the queue (never picked, so ranked 0). */
export type TipPoolOptions = { target?: number; protectedIds?: ReadonlySet<string>; archivedIds?: ReadonlySet<string> };

/** planTipPool against the stored pool: reads the waiting found tips (protected ones left out). Writes nothing. */
export async function planStoredTipPool<K>(q: HubQuery, incoming: readonly PoolEntry<K>[], opts: TipPoolOptions = {}): Promise<{ admit: K[]; expire: string[] }> {
  const protectedIds = opts.protectedIds ?? new Set<string>();
  const archived = opts.archivedIds ?? new Set<string>();
  const waiting = (await listWaitingFoundTips(q))
    .filter((w) => !protectedIds.has(w.id))
    .map((w) => ({ key: w.id, score: archived.has(w.id) ? 0 : w.rank }));
  return planTipPool({ waiting, incoming, target: opts.target ?? FIELD_NOTES_POOL_TARGET });
}
