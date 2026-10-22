import type { IdeaAdjustment, MoveTag } from '@/lib/social-hub/views/moves';

/**
 * The idea pool standard's pure core (spec 2026-10-21-idea-pool-standard-design).
 *
 * Everything a person does to an idea is a row in social_hub.idea_adjustments.
 * This file turns ideas and those rows into the queue: pinned ideas first (in
 * the order pinned), then everything else by effective score, where a dragged
 * idea's effective score is the key its drop left it at and any other idea's
 * is its machine score. The machine score is never rewritten. Type-only
 * imports, so night workers import it without Next, Jev or a database.
 */

/** Open ideas a type keeps (Stories: per series). Pinned, Yours, Placed and Generated ideas are never dropped for it. */
export const POOL_CAP = 30;

/**
 * The types whose nights already follow the queue (pins, drags, archive). The page shows the new controls only
 * for these; the others keep Promote and Demote until their night workers are converted, so a control never
 * promises what the night will not do. Add a type here in the same change that converts its worker.
 */
export const QUEUE_LIVE: ReadonlySet<string> = new Set(['explainers', 'reels', 'carousels', 'stories']);

/** A drop lands this far above or below its neighbour's effective score. */
const STEP = 0.01;

export type QueueItem = { id: string; score: number | null };

export type QueuedIdea<T> = { item: T; rank: number; pinned: boolean; placed: boolean; effective: number | null };

/** Archive is permanent: any archive row hides the idea. */
export function isArchived(moves: readonly Pick<IdeaAdjustment, 'ideaId' | 'kind'>[], ideaId: string): boolean {
  return moves.some((m) => m.ideaId === ideaId && m.kind === 'archive');
}

/**
 * The queue, best first. `moves` are the active rows, oldest first. Pins
 * (a `pin`, or an old `promote`) lead in the order they were made; a `place`
 * on a pinned idea is ignored while it stays pinned. `demote` has no meaning
 * here. Rows on ideas absent from `items` change nothing. Ties keep the order
 * `items` came in.
 */
export function queueOrder<T extends QueueItem>(items: readonly T[], moves: readonly IdeaAdjustment[]): QueuedIdea<T>[] {
  const here = new Set(items.map((i) => i.id));
  const archived = new Set(moves.filter((m) => m.kind === 'archive' && here.has(m.ideaId)).map((m) => m.ideaId));
  const pinAt = new Map<string, number>();
  const key = new Map<string, number>();
  moves.forEach((m, order) => {
    if (!here.has(m.ideaId)) return;
    if (m.kind === 'pin' || m.kind === 'promote') pinAt.set(m.ideaId, pinAt.get(m.ideaId) ?? order);
    else if (m.kind === 'place' && m.sortKey != null) key.set(m.ideaId, m.sortKey);
  });
  const live = items.filter((i) => !archived.has(i.id));
  const pinned = live.filter((i) => pinAt.has(i.id)).sort((a, b) => pinAt.get(a.id)! - pinAt.get(b.id)!);
  const rest = live
    .filter((i) => !pinAt.has(i.id))
    .map((item, order) => ({ item, order, effective: key.get(item.id) ?? item.score }))
    .sort((a, b) => (b.effective ?? -Infinity) - (a.effective ?? -Infinity) || a.order - b.order);
  const out: QueuedIdea<T>[] = pinned.map((item) => ({ item, rank: 0, pinned: true, placed: false, effective: item.score }));
  for (const r of rest) out.push({ item: r.item, rank: 0, pinned: false, placed: key.has(r.item.id), effective: r.effective });
  return out.map((q, i) => ({ ...q, rank: i + 1 }));
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Where a dragged idea sorts. `others` are the effective scores of the
 * unpinned list without the dragged idea, in display order; `index` is where
 * it was dropped among them; `up` is whether it moved toward the top. Up lands
 * 0.01 above the idea now below it, down 0.01 below the idea now above it;
 * where that would cross a neighbour (a gap under 0.02) it takes the midpoint.
 * Equal neighbours cannot be split by a number: the idea lands next to them.
 */
export function dropKey(others: readonly (number | null)[], index: number, up: boolean): number {
  const hasAbove = index > 0;
  const hasBelow = index < others.length;
  const hi = hasAbove ? others[index - 1] ?? null : null;
  const lo = hasBelow ? others[index] ?? null : null;
  if (!hasAbove && !hasBelow) return 0;
  if (!hasAbove) return round((lo ?? 0) + STEP); // the top
  if (!hasBelow) return round((hi ?? 0) - STEP); // the bottom
  if (hi == null && lo == null) return up ? STEP : 0;
  if (hi == null) return round(lo! + STEP);
  if (lo == null) return round(hi - STEP);
  if (hi - lo > 2 * STEP) return round(up ? lo + STEP : hi - STEP);
  return round((hi + lo) / 2);
}

/**
 * The ideas a type's refill drops to hold the cap: the lowest-ranked
 * unprotected ones, as many as it takes. Protected ideas are never dropped, so
 * a pool full of them stays over the cap.
 */
export function capOverflow<T extends QueueItem>(queued: readonly QueuedIdea<T>[], cap: number, isProtected: (q: QueuedIdea<T>) => boolean): T[] {
  const excess = queued.length - cap;
  if (excess <= 0) return [];
  return queued.filter((q) => !isProtected(q)).slice(-excess).reverse().map((q) => q.item);
}

/** The key for a drop between two neighbours the caller saw (either may be absent: the top or the bottom of the list). */
export function dropKeyBetween(above: number | null | undefined, below: number | null | undefined, up: boolean): number {
  const others: Array<number | null> = [];
  if (above !== undefined) others.push(above);
  if (below !== undefined) others.push(below);
  return dropKey(others, above !== undefined ? 1 : 0, up);
}

/**
 * The chip a hand-moved idea carries in the queue: Pinned (or why the night could not
 * make it), or Placed. Ideas absent from `present` (gone from the pool) get none.
 */
export function queueTags(moves: readonly IdeaAdjustment[], present: ReadonlySet<string>): Map<string, MoveTag> {
  const tags = new Map<string, MoveTag>();
  for (const m of moves) {
    if (!present.has(m.ideaId) || m.kind === 'demote') continue;
    if (m.kind === 'archive') tags.delete(m.ideaId);
    else if (m.kind === 'place') { if (!tags.has(m.ideaId) || tags.get(m.ideaId)!.kind === 'placed') tags.set(m.ideaId, { kind: 'placed', text: 'Placed' }); }
    else tags.set(m.ideaId, m.skipReason != null ? { kind: 'cant', text: `Can’t be made: ${m.skipReason}` } : { kind: 'pinned', text: 'Pinned' });
  }
  return tags;
}

/**
 * A night worker's own list in the queue's order, without disturbing how the worker ranks otherwise. Archived ideas are
 * dropped; pins lead in the order pinned; each placed idea is inserted where its key sorts among the others' scores;
 * everything else keeps the order given. Ids must be in one space (`ids` and `idOf` agree).
 */
export function orderForNight<T>(
  list: readonly T[],
  idOf: (x: T) => string,
  scoreOf: (x: T) => number | null,
  night: { pins: readonly string[]; placed: ReadonlyMap<string, number>; archived: ReadonlySet<string> },
): T[] {
  const live = list.filter((x) => !night.archived.has(idOf(x)));
  const pinOrder = new Map(night.pins.map((id, i) => [id, i]));
  const pinned = live.filter((x) => pinOrder.has(idOf(x))).sort((a, b) => pinOrder.get(idOf(a))! - pinOrder.get(idOf(b))!);
  const rest = live.filter((x) => !pinOrder.has(idOf(x)));
  const placed = rest.filter((x) => night.placed.has(idOf(x))).sort((a, b) => night.placed.get(idOf(b))! - night.placed.get(idOf(a))!);
  const out = rest.filter((x) => !night.placed.has(idOf(x)));
  for (const x of placed) {
    const key = night.placed.get(idOf(x))!;
    const at = out.findIndex((o) => (scoreOf(o) ?? -Infinity) < key);
    out.splice(at < 0 ? out.length : at, 0, x);
  }
  return [...pinned, ...out];
}

/**
 * The queue as a page shows it: the cap's overflow removed (lowest-ranked unprotected ideas), so a type whose pool is not
 * stored by us (a scored slate, a run's shortlist) still shows no more than POOL_CAP open ideas. Pinned, dragged, yours and
 * made ideas are protected, so a pool full of them shows more.
 */
export function capQueued<T extends QueueItem & { yours?: boolean; hasContent?: boolean }>(queued: readonly QueuedIdea<T>[], cap = POOL_CAP): QueuedIdea<T>[] {
  const drop = new Set(capOverflow(queued, cap, (q) => q.pinned || q.placed || q.item.yours === true || q.item.hasContent === true));
  return queued.filter((q) => !drop.has(q.item));
}
