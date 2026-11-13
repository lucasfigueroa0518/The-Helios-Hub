/**
 * Per-city picks and pool order (plan M2 step 5, AE-04, AE-27/28, AE-36). Pure.
 *
 *  - Excluded events are dropped.
 *  - Pinned events go first, best score first, whatever their score or gate: a pin is a
 *    person's call.
 *  - Then partner events (AE-27), best score first, whatever their score or gate.
 *  - Then events that passed every gate and reach the week's bar, by score. The bar is a
 *    percentile of the city's score history and steps down when too few events clear it
 *    (AE-28, `chooseCityPicks`).
 *  - One organizer may hold several picks (AE-36).
 *  - No day spread: the list is honest score order, whatever day the events fall on (AE-39).
 *  - At most PICKS_PER_CITY, the city's top 10 for the week. A city with nothing above the bar and no pin or partner has no picks.
 *  - Ties break on going (more first), then start time (earlier first).
 */
import { normalizeOrgName } from './anchors-roster';

/**
 * Ranks 1 to 10: the city's top 10 for the week (AE-36). Every one is badged on the site
 * (AE-37), and the post's teasers come only from them (AE-38). #1 is held back for the site.
 */
export const PICKS_PER_CITY = 10;
/**
 * How deep the post's ranked list runs: the top 10 and nothing past it (AE-38).
 * `spotlightRanks` takes 3–4 ranks from #2 to the last event on this list.
 */
export const RANK_DEPTH = PICKS_PER_CITY;

/** History bar tiers, strictest first: the share of the city's past scores an event must be in the top of. */
export const BAR_TIERS = [
  { tier: 'top30', top: 0.3 },
  { tier: 'top40', top: 0.4 },
  { tier: 'top50', top: 0.5 },
  { tier: 'gates', top: 1 },
] as const;
export type BarTier = (typeof BAR_TIERS)[number]['tier'];

export type RankInput = {
  eventId: string;
  score: number | null;
  /** Failed gates, or null when the event passed. */
  gate: string | null;
  /** Normalized organizer identity; null means unknown, never a match. */
  organizerKey: string | null;
  /** ISO instant. */
  startAt: string;
  going: number | null;
  pinned: boolean;
  excluded: boolean;
  /** The partner hosting it (AE-27), or null. */
  partner?: string | null;
};

/** Organizer identity (shown in the hub): the organizer name, else the series key. */
export function organizerKey(event: { organizerName: string | null; seriesKey: string | null }): string | null {
  const name = event.organizerName ? normalizeOrgName(event.organizerName) : '';
  if (name) return `name:${name}`;
  return event.seriesKey ? `series:${event.seriesKey}` : null;
}

/** Score (null last), then going, then start. */
export function compareRank(a: RankInput, b: RankInput): number {
  const sa = a.score ?? Number.NEGATIVE_INFINITY;
  const sb = b.score ?? Number.NEGATIVE_INFINITY;
  if (sa !== sb) return sb - sa;
  const ga = a.going ?? 0;
  const gb = b.going ?? 0;
  if (ga !== gb) return gb - ga;
  const ta = Date.parse(a.startAt);
  const tb = Date.parse(b.startAt);
  if (ta !== tb) return ta - tb;
  return a.eventId.localeCompare(b.eventId);
}

/** The pool's order within a city: by score, gated events last. Pins, partners and excludes do not move rank. */
export function rankCity<T extends RankInput>(events: readonly T[]): T[] {
  return [...events].sort(compareRank);
}

/**
 * The score at the top `top` share of `history` (0.3 → the 70th percentile), or null when the
 * tier has no bar (`top` 1) or there is no history.
 */
export function percentileBar(history: readonly number[], top: number): number | null {
  if (top >= 1 || !history.length) return null;
  const sorted = [...history].sort((a, b) => a - b);
  const at = (1 - top) * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

const special = (e: RankInput) => e.pinned || e.partner != null;

/**
 * `bar` null: any event that passed the gates is eligible. `depth` past PICKS_PER_CITY appends the
 * next eligible events after the picks, so the first PICKS_PER_CITY never change with depth.
 */
export function choosePicks<T extends RankInput>(events: readonly T[], bar: number | null = null, depth: number = PICKS_PER_CITY): T[] {
  const ranked = rankCity(events.filter((e) => !e.excluded));
  const picks: T[] = [...ranked.filter((e) => e.pinned), ...ranked.filter((e) => !e.pinned && e.partner != null)].slice(0, PICKS_PER_CITY);
  const eligible = (e: RankInput) => !e.excluded && !special(e) && e.gate == null && e.score != null && (bar == null || e.score >= bar);
  const pool = ranked.filter(eligible);
  for (const event of pool) {
    if (picks.length >= PICKS_PER_CITY) break;
    picks.push(event);
  }
  if (depth > picks.length) {
    const taken = new Set(picks.map((p) => p.eventId));
    for (const event of pool) {
      if (picks.length >= depth) break;
      if (taken.has(event.eventId)) continue;
      picks.push(event);
    }
  }
  return picks;
}

export type CityPicks<T> = { picks: T[]; tier: BarTier; bar: number | null };

/**
 * AE-28: the strictest tier whose bar (a percentile of the city's past scores) yields a full
 * set of picks; the loosest tier ("gates") takes whatever passed the gates.
 */
export function chooseCityPicks<T extends RankInput>(events: readonly T[], history: readonly number[]): CityPicks<T> {
  let last: CityPicks<T> | null = null;
  for (const { tier, top } of BAR_TIERS) {
    const bar = percentileBar(history, top);
    if (top < 1 && bar == null) continue;
    const picks = choosePicks(events, bar);
    last = { picks, tier, bar };
    if (picks.length >= PICKS_PER_CITY) return last;
  }
  return last ?? { picks: choosePicks(events, null), tier: 'gates', bar: null };
}

/**
 * The post's ranked list: the city's picks first (bar, pins, partners), then the
 * next events that passed the gates, up to `depth` (RANK_DEPTH, the top 10). When the bar left
 * fewer than 10 picks, events under it fill the list so the teasers can span it.
 */
export function extendDeck<T extends RankInput>(picks: readonly T[], ranked: readonly T[], depth = RANK_DEPTH): T[] {
  if (picks.length < 2) return [...picks];
  const extra = choosePicks(ranked, null, depth);
  const seen = new Set(picks.map((p) => p.eventId));
  const deck = [...picks];
  for (const event of extra) {
    if (deck.length >= depth) break;
    if (seen.has(event.eventId)) continue;
    deck.push(event);
    seen.add(event.eventId);
  }
  return deck;
}
