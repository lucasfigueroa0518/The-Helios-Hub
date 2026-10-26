import { QUEUE_LIVE } from '@/lib/social-hub/queue';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * The shared queue (spec docs/superpowers/specs/2026-10-14-shared-queue-design.md §1):
 * one rule for the Content page, Run now / Make it and all four night workers.
 *
 *   Promote  "make this next". In each queue (a type; for Stories, a series:
 *            each series builds its own set) the oldest idea whose latest
 *            move is a promote goes first tonight. Other promotes wait in
 *            their score place: one a night, oldest first.
 *   Demote   the idea sinks below every idea that isn't demoted.
 *
 * The latest move on an idea wins; a promote's place in line is the time of
 * that latest move. A promote the night couldn't make (skipReason) steps aside
 * for the next. Moves always come oldest first. Pure, with a type-only
 * import, so workers import it without Next, Jev or a database.
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
   * Idea pool standard (2026-10-21), for types on the queue (lib/social-hub/queue.ts QUEUE_LIVE): every pin the night may
   * make, in the order pinned (a pin a worker skipped steps aside); the ideas a person archived; and where a drag left
   * each placed idea. Types not on the queue see `pins` as just their promote and nothing else.
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

/** The queue a move waits in: its type, or for a Stories pool idea its series. */
export function moveScope(m: Move): string {
  if (m.ideaId.startsWith('stories:pool:')) return m.ideaId.split(':').slice(0, 3).join(':');
  return m.vertical ?? '';
}

/** Each idea's latest move, in the order of those latest moves (oldest first). */
export function latestMoves<M extends Move>(moves: readonly M[]): M[] {
  const last = new Map<string, M>();
  for (const m of moves) {
    // Placements and archives are the pool standard's (lib/social-hub/queue.ts); they never shadow a promote or demote.
    if (m.kind === 'place' || m.kind === 'archive') continue;
    last.delete(m.ideaId);
    last.set(m.ideaId, m);
  }
  return [...last.values()];
}

/**
 * Per queue, the oldest idea whose latest move is a promote: what the night makes first.
 * A promote with a recorded skip steps aside (the next one is tonight's); re-promoting
 * writes a new move with no skip, so it is eligible again.
 */
export function tonightPromotes<M extends Move>(moves: readonly M[]): M[] {
  const taken = new Set<string>();
  const out: M[] = [];
  for (const m of latestMoves(moves)) {
    if ((m.kind !== 'promote' && m.kind !== 'pin') || m.skipReason != null || taken.has(moveScope(m))) continue;
    taken.add(moveScope(m));
    out.push(m);
  }
  return out;
}

/** A type's promote for tonight (Reels, Explainers, Carousels; Stories use tonightPromotes, one per series). */
export function tonightPromote<M extends Move>(moves: readonly M[], vertical: string): M | null {
  return tonightPromotes(moves.filter((m) => m.vertical === vertical))[0] ?? null;
}

/** Ideas of a type whose latest move is a demote. */
export function demotedIds<M extends Move>(moves: readonly M[], vertical: string): Set<string> {
  return new Set(latestMoves(moves.filter((m) => m.vertical === vertical)).filter((m) => m.kind === 'demote').map((m) => m.ideaId));
}

export function tonightMoves<M extends Move & { sortKey?: number | null }>(moves: readonly M[], vertical: string): TonightMoves<M> {
  if (!QUEUE_LIVE.has(vertical)) {
    const promote = tonightPromote(moves, vertical);
    return { promote, demoted: demotedIds(moves, vertical), pins: promote ? [promote] : [], archived: new Set<string>(), placed: new Map<string, number>() };
  }
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

/** A ranked list in tonight's order: each queue's promote first, demoted ideas last. */
export function applyMoves<T extends { id: string }>(ranked: readonly T[], moves: readonly Move[]): T[] {
  // Only moves on ideas in this list count: an absent promote must not hold its queue's slot.
  const present = new Set(ranked.map((x) => x.id));
  const here = moves.filter((m) => present.has(m.ideaId));
  const demoted = new Set(latestMoves(here).filter((m) => m.kind === 'demote').map((m) => m.ideaId));
  return orderTonight(ranked, (x) => x.id, new Set(tonightPromotes(here).map((m) => m.ideaId)), demoted);
}

/** The native id an idea id ends with (`reels:idea:<id>` → `<id>`; colons inside the ref are kept). */
export function ideaRef(ideaId: string): string {
  return ideaId.split(':').slice(2).join(':');
}

/** What the page says about a moved idea. */
export type MoveTag = { kind: 'tonight' | 'waiting' | 'cant' | 'demoted' | 'pinned' | 'placed'; text: string };

/**
 * One tag per moved idea of a type (spec §7), latest move per idea:
 * the promote the night makes first is "Tonight"; other promotes are
 * "Promoted · waiting"; a promote a worker skipped has stepped aside and reads
 * "Can’t be made: <reason>" until a person re-promotes or demotes it; demoted
 * ideas are "Demoted". Stories get one "Tonight" per series.
 * `present` (idea ids of the type) drops moves on ideas that are gone. `now` is kept for callers; a recorded skip stands until the idea is re-moved.
 */
export function moveTags(moves: readonly IdeaAdjustment[], vertical: Vertical, _now: Date, present?: ReadonlySet<string>): Map<string, MoveTag> {
  // Only moves on ideas the hub knows count (as applyMoves): an absent promote must not hold Tonight.
  const mine = moves.filter((m) => m.vertical === vertical && (!present || present.has(m.ideaId)));
  const tonight = new Set(tonightPromotes(mine).map((m) => m.ideaId));
  const tags = new Map<string, MoveTag>();
  for (const m of latestMoves(mine)) {
    if (m.kind === 'demote') tags.set(m.ideaId, { kind: 'demoted', text: 'Demoted' });
    else if (m.skipReason != null) tags.set(m.ideaId, { kind: 'cant', text: `Can’t be made: ${m.skipReason}` });
    else if (tonight.has(m.ideaId)) tags.set(m.ideaId, { kind: 'tonight', text: 'Tonight' });
    else tags.set(m.ideaId, { kind: 'waiting', text: 'Promoted · waiting' });
  }
  return tags;
}
