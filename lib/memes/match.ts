/**
 * Matching a turn to templates in code (ME-101, ME-102,
 * planning/Memes/UPGRADE_PLAN.md U3). The writer never sees the whole
 * catalog: each kept turn gets a short list of the free cards that carry its
 * type and hold its beats, and the writer may only use those. Picture-carried
 * cards come first (they held up blind, 73% good vs 44%), then cards the lab
 * has not used lately (so no template becomes the default, as Gru's Plan did
 * in 30 of 40 runs), then the more specific cards.
 */
import type { TemplateCard } from './types';
import { activeCards, cardV2 } from './cards-v2';
import type { Turn } from './turns';

export const SHORTLIST_SIZE = 4;

/** A card with a required slot only the viewer can fill ("Me, …") needs a turn that touches the viewer (ME-105). */
export const needsViewer = (card: TemplateCard): boolean =>
  card.slots.some((s) => !s.optional && !s.fixed && !s.derived && s.accepts.length === 1 && s.accepts[0] === 'viewer');

export type MatchOptions = {
  /** Template ids free today (the 90-day gate, ME-40). */
  free: ReadonlySet<string>;
  kind: 'single' | 'landscape' | 'spread';
  /** How often each template appeared in recent lab slates. */
  recent?: ReadonlyMap<string, number>;
  size?: number;
  /** Ignore the beat count (a fallback when nothing else fits). */
  anyBeats?: boolean;
};

/** Every card that may carry this turn, best first. */
export function candidatesFor(turn: Turn, opts: MatchOptions): TemplateCard[] {
  const fits = activeCards().filter((card) => {
    const v2 = cardV2(card.id)!;
    if (!opts.free.has(card.id)) return false;
    if (opts.kind !== 'single' && !card.landscape) return false;
    if (!v2.carries.includes(turn.type)) return false;
    if (needsViewer(card) && !turn.touchesViewer) return false;
    if (!opts.anyBeats && (turn.beats.length < v2.beats[0] || turn.beats.length > v2.beats[1])) return false;
    return true;
  });
  const recent = opts.recent ?? new Map<string, number>();
  const key = (card: TemplateCard) => {
    const v2 = cardV2(card.id)!;
    return [v2.carriedBy === 'picture' ? 0 : 1, Math.min(recent.get(card.id) ?? 0, 3), v2.carries.length, card.rank];
  };
  return fits.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return 0;
  });
}

export type Shortlist = { turn: Turn; cards: TemplateCard[] };

/**
 * One short list per turn. A turn nothing fits gets a second look without
 * the beat count; a turn that still has no card is left out, and the
 * caller says so.
 */
export function shortlists(turns: readonly Turn[], opts: MatchOptions): { lists: Shortlist[]; unmatched: Turn[] } {
  const size = opts.size ?? SHORTLIST_SIZE;
  const lists: Shortlist[] = [];
  const unmatched: Turn[] = [];
  for (const turn of turns) {
    let cards = candidatesFor(turn, opts);
    if (!cards.length) cards = candidatesFor(turn, { ...opts, anyBeats: true });
    if (cards.length) lists.push({ turn, cards: cards.slice(0, size) });
    else unmatched.push(turn);
  }
  return { lists, unmatched };
}
