import type { Vertical } from '@/lib/social-hub/types';

/**
 * A night worker's view of a person's moves on a type's ideas (idea pool standard 2026-10-21; every type is on
 * the shared queue, lib/social-hub/queue.ts): pins in the order pinned (an old Promote counts as a pin; a pin
 * the night couldn't make, skipReason, steps aside), archived ideas, and where a drag left each placed idea.
 * Moves always come oldest first. Pure, with type-only imports, so workers import it without Next, Jev or a database.
 */

/** A person's Promote / Demote. `nyDate` is the day it was made; it steers until used (consumed_at, B8). `createdAt` is ISO. */
export type IdeaAdjustment = {
  id: string;
  vertical: Vertical;
  ideaId: string;
  nyDate: string;
  kind: 'promote' | 'demote' | 'pin' | 'place' | 'archive';
  createdAt: string;
  /** `place` only: where a drag left the idea in the queue (lib/social-hub/queue.ts dropKey). */
  sortKey?: number | null;
  /** Why the last night couldn't make this promote (a worker wrote it), and when (ISO). */
  skipReason?: string | null;
  skippedAt?: string | null;
};

/** The part of a move the rule reads. The Stories build passes bare pool keys of one series (no vertical). */
export type Move = { ideaId: string; kind: 'promote' | 'demote' | 'pin' | 'place' | 'archive'; vertical?: string; skipReason?: string | null };

/** Tonight's moves for one type: the one promote it makes first, and the ideas that sink. */
export type TonightMoves<M extends Move = IdeaAdjustment> = {
  /** The first pin: the one a worker that makes a single promoted idea a night takes. */
  promote: M | null;
  demoted: ReadonlySet<string>;
  /**
   * Idea pool standard (2026-10-21): every pin the night may make, in the order pinned (a pin a worker skipped steps
   * aside); the ideas a person archived; and where a drag left each placed idea.
   */
  pins: M[];
  archived: ReadonlySet<string>;
  placed: ReadonlyMap<string, number>;
};

/** No moves: what a worker uses when it can't read them (today's behavior). */
export const NO_MOVES: TonightMoves<never> = { promote: null, demoted: new Set<string>(), pins: [], archived: new Set<string>(), placed: new Map<string, number>() };

/** A type's moves, oldest first. */
export function movesFor(adjustments: readonly IdeaAdjustment[], vertical: Vertical): IdeaAdjustment[] {
  return adjustments.filter((a) => a.vertical === vertical).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function tonightMoves<M extends Move & { sortKey?: number | null }>(moves: readonly M[], vertical: string): TonightMoves<M> {
  const mine = moves.filter((m) => m.vertical === vertical);
  const archived = new Set(mine.filter((m) => m.kind === 'archive').map((m) => m.ideaId));
  // An idea's latest pin row, in the order those rows were made (the order pinned); a skipped pin steps aside for the night.
  const lastPin = new Map<string, M>();
  const demoted = new Set<string>();
  for (const m of mine) {
    if (m.kind === 'pin' || m.kind === 'promote') { lastPin.delete(m.ideaId); lastPin.set(m.ideaId, m); demoted.delete(m.ideaId); }
    else if (m.kind === 'demote') { lastPin.delete(m.ideaId); demoted.add(m.ideaId); }
  }
  const pinned = new Set(lastPin.keys());
  const pins = [...lastPin.values()].filter((m) => m.skipReason == null && !archived.has(m.ideaId));
  const placed = new Map<string, number>();
  for (const m of mine) if (m.kind === 'place' && m.sortKey != null && !pinned.has(m.ideaId) && !archived.has(m.ideaId)) placed.set(m.ideaId, m.sortKey);
  return { promote: pins[0] ?? null, demoted: new Set([...demoted].filter((id) => !archived.has(id))), pins, archived, placed };
}

/** Stable: the promoted first, then everything not demoted, then the demoted, each in the order given. */
export function orderTonight<T>(list: readonly T[], idOf: (x: T) => string, promoted: ReadonlySet<string> | readonly string[], demoted: ReadonlySet<string>): T[] {
  // An array is an order of its own (the order pinned); a set keeps the list's order.
  if (Array.isArray(promoted)) {
    const order = new Map((promoted as readonly string[]).map((id, i) => [id, i]));
    const lead = list.filter((x) => order.has(idOf(x))).sort((a, b) => order.get(idOf(a))! - order.get(idOf(b))!);
    const rest = orderTonight(list.filter((x) => !order.has(idOf(x))), idOf, new Set<string>(), demoted);
    return [...lead, ...rest];
  }
  const first: T[] = [];
  const middle: T[] = [];
  const last: T[] = [];
  for (const x of list) {
    const id = idOf(x);
    if ((promoted as ReadonlySet<string>).has(id)) first.push(x);
    else if (demoted.has(id)) last.push(x);
    else middle.push(x);
  }
  return [...first, ...middle, ...last];
}

/** The native id an idea id ends with (`reels:idea:<id>` → `<id>`; colons inside the ref are kept). */
export function ideaRef(ideaId: string): string {
  return ideaId.split(':').slice(2).join(':');
}

/** What the page says about a moved idea. */
export type MoveTag = { kind: 'tonight' | 'waiting' | 'cant' | 'demoted' | 'pinned' | 'placed'; text: string };
