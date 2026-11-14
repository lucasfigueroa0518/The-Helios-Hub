/**
 * Morning Download's outlet signal (Bald-Eagle 2026-11-12, D7 / New 4): how
 * many of the big outlets the collector reads directly carry a story, its
 * spin-offs folded in. One input to the final rank, never the decider.
 *
 * Why not count `source_name`: the "Gemini on Apple CarPlay" story counted 18
 * distinct outlets because every one of its 18 items came through ONE Google
 * News search feed (gnews-ai-products, whose query names that product). A
 * Google News item carries its publisher's <source> name, so the intake's
 * outlet list (scorecards.ts storyGroupOf: distinct raw source_name) turns a
 * single hit on our own search terms into one "outlet" per publisher it
 * relays, the company's own blog ("blog.google") included. The same outlet
 * also arrives under several names (its feed's "Bloomberg Technology" vs.
 * Google News's "Bloomberg.com"; "NYT > Technology"), so raw names don't
 * compare either. Coverage counted that way follows what we search for.
 *
 * The fix: count feeds, not names. An item counts for an outlet only when its
 * own source (`source_id`, the source that stored it) is that outlet's direct
 * feed, which reads the outlet's whole tech/AI section whatever we search for.
 * List membership alone does not count (integration review: a Hacker News
 * item whose `feed_slug` is nyt-tech is a Hacker News item, not an NYT one).
 * A Google News search hit never counts, and each outlet has one name here.
 *
 * Pure read (CLAUDE.md rule 2): one bounded query over the given stories.
 */
import type { IntakeQuery } from './types';

/**
 * The direct big-outlet feeds (intake source id → one outlet name). Reuters has no public RSS, so its feed is a
 * Google News query restricted to reuters.com: still the outlet's own AI coverage, not our topic terms.
 * WSJ: no intake items from feed:wsj-tech in the 14 days before 2026-11-12 (the feed may be failing); kept in the
 * list so it counts again once that feed delivers.
 */
export const BIG_OUTLET_FEEDS: Readonly<Record<string, string>> = {
  'feed:reuters-tech': 'Reuters',
  'feed:bloomberg-tech': 'Bloomberg',
  'feed:wsj-tech': 'The Wall Street Journal',
  'feed:nyt-tech': 'The New York Times',
  'guardian-ai': 'The Guardian',
  'nbc-tech': 'NBC News',
  'cbs-tech': 'CBS News',
  'bbc-tech': 'BBC News',
};

/** The window an item must fall in to count (contract: the last 24 h). */
export const OUTLET_WINDOW_HOURS = 24;

export type OutletItem = { sourceId: string };

/** The big outlet whose own feed stored the item, or null (a search hit, a membership only, or any other source). */
export function bigOutletOf(item: OutletItem): string | null {
  return BIG_OUTLET_FEEDS[item.sourceId] ?? null;
}

/** Distinct big outlets among the items, sorted by name. */
export function bigOutletsOf(items: readonly OutletItem[]): string[] {
  return [...new Set(items.map(bigOutletOf).filter((x): x is string => x !== null))].sort();
}

export type OutletSignal = { count: number; outlets: string[] };

/**
 * One signal per group of intake story ids (a story and its spin-offs), over items first seen since `since`.
 * A story merged into one of the ids is read with it. One query for every group.
 */
export async function outletCounts(q: IntakeQuery, groups: ReadonlyMap<string, readonly string[]>, since: Date): Promise<Map<string, OutletSignal>> {
  const all = [...new Set([...groups.values()].flat())];
  const out = new Map<string, OutletSignal>();
  if (!all.length) {
    for (const k of groups.keys()) out.set(k, { count: 0, outlets: [] });
    return out;
  }
  const { rows } = await q.query<{ story_id: string; merged_into: string | null; source_id: string }>(
    `SELECT i.story_id::text AS story_id, s.merged_into::text AS merged_into, i.source_id
       FROM intake.items i JOIN intake.stories s ON s.id = i.story_id
      WHERE (s.id::text = ANY($1::text[]) OR s.merged_into::text = ANY($1::text[])) AND i.first_seen_at >= $2::timestamptz`,
    [all, since.toISOString()],
  );
  for (const [key, ids] of groups) {
    const mine = new Set(ids);
    const items = rows
      .filter((r) => mine.has(r.story_id) || (r.merged_into !== null && mine.has(r.merged_into)))
      .map((r) => ({ sourceId: r.source_id }));
    const outlets = bigOutletsOf(items);
    out.set(key, { count: outlets.length, outlets });
  }
  return out;
}

/** The contract's single-story form: distinct big outlets carrying these stories since `since`. */
export async function outletCount(q: IntakeQuery, storyIds: readonly string[], since: Date): Promise<OutletSignal> {
  return (await outletCounts(q, new Map([['one', storyIds]]), since)).get('one')!;
}
