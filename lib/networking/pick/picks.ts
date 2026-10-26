/**
 * Per-city picks and pool order (plan M2 step 5, AE-04, AE-27/28). Pure.
 *
 *  - Excluded events are dropped.
 *  - Pinned events go first, best score first, whatever their score or gate: a pin is a
 *    person's call.
 *  - Then partner events (AE-27), best score first, whatever their score or gate.
 *  - Then events that passed every gate and reach the week's bar, by score. The bar is a
 *    percentile of the city's score history and steps down when too few events clear it
 *    (AE-28, `chooseCityPicks`).
 *  - At most one event per organizer (pins and partners excepted among themselves).
 *  - Day spread: when the last pick shares a day with an earlier one, it is swapped for the
 *    best eligible event on a day not yet covered if that event scores within 15% of it.
 *  - At most PICKS_PER_CITY. A city with nothing above the bar and no pin or partner has no picks.
 *  - Ties break on going (more first), then start time (earlier first).
 */
import { normalizeOrgName } from './anchors-roster';

/** Ranks 1 to 4: the city's picks (site badges, hub, history bar). #1 is held back for the site (AE-29). */
export const PICKS_PER_CITY = 4;
/**
 * How deep the post's ranked list runs: the city's 4 picks, then every later event that passed
 * the gates (one per organizer). The history bar chooses the 4 picks; it does not cut the teaser
 * list. `spotlightRanks` takes 3–4 ranks from #2 to the last event on this list.
 */
export const RANK_DEPTH = 20;
/** The last pick is swapped for an event on a new day scoring at least (1 − this) of it. */
export const DAY_SPREAD_WITHIN = 0.15;

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
  /** Local calendar day, "YYYY-MM-DD". */
  localDay: string;
  going: number | null;
  pinned: boolean;
  excluded: boolean;
  /** The partner hosting it (AE-27), or null. */
  partner?: string | null;
};

/** Organizer identity for the one-per-organizer rule: the organizer name, else the series key. */
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
 * next eligible events after the picks (the day-spread swap still acts on the 4th), so the first
 * PICKS_PER_CITY never change with depth.
 */
export function choosePicks<T extends RankInput>(events: readonly T[], bar: number | null = null, depth: number = PICKS_PER_CITY): T[] {
  const ranked = rankCity(events.filter((e) => !e.excluded));
  const picks: T[] = [...ranked.filter((e) => e.pinned), ...ranked.filter((e) => !e.pinned && e.partner != null)].slice(0, PICKS_PER_CITY);
  const organizers = new Set(picks.map((p) => p.organizerKey).filter((k): k is string => k != null));
  const eligible = (e: RankInput) => !e.excluded && !special(e) && e.gate == null && e.score != null && (bar == null || e.score >= bar);
  const pool = ranked.filter(eligible);
  for (const event of pool) {
    if (picks.length >= PICKS_PER_CITY) break;
    if (event.organizerKey && organizers.has(event.organizerKey)) continue;
    picks.push(event);
    if (event.organizerKey) organizers.add(event.organizerKey);
  }

  const lastAt = picks.length - 1;
  if (picks.length === PICKS_PER_CITY && !special(picks[lastAt]!)) {
    const last = picks[lastAt]!;
    const earlier = picks.slice(0, lastAt);
    const days = new Set(earlier.map((p) => p.localDay));
    if (days.has(last.localDay)) {
      const taken = new Set(picks.map((p) => p.eventId));
      const kept = new Set(earlier.map((p) => p.organizerKey).filter((k): k is string => k != null));
      const floor = (last.score ?? 0) * (1 - DAY_SPREAD_WITHIN);
      const swap = pool.find(
        (e) => !taken.has(e.eventId) && !days.has(e.localDay) && !(e.organizerKey && kept.has(e.organizerKey)) && (e.score ?? 0) >= floor,
      );
      if (swap) picks[lastAt] = swap;
    }
  }
  if (depth > picks.length) {
    const taken = new Set(picks.map((p) => p.eventId));
    const owners = new Set(picks.map((p) => p.organizerKey).filter((k): k is string => k != null));
    for (const event of pool) {
      if (picks.length >= depth) break;
      if (taken.has(event.eventId) || (event.organizerKey && owners.has(event.organizerKey))) continue;
      picks.push(event);
      if (event.organizerKey) owners.add(event.organizerKey);
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
 * The post's ranked list: the city's picks first (bar, pins, partners, day spread), then the
 * next events that passed the gates, one per organizer, up to `depth`. Events under the history
 * bar stay on the list so the teasers can span it.
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
