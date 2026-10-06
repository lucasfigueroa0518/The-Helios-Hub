import { dbQuery } from '@/lib/db';
import {
  CONTENT_OVERLAP_FLOOR,
  CONTENT_SHORTLIST_LIMIT,
  IDEA_MERGE_MAX_PAIRS,
  PUBLISHED_STORY_HOLD_DAYS,
  REFERENCE_POOL_HOURS,
} from '@/lib/reels/config';
import { poolIdf, storyOverlap, storyTerms, type Idf, type StoryTerms } from '@/lib/reels/grouping/story-terms';
import type { IdeaMergeCandidate, ShortlistCandidate } from '@/lib/reels/repository';

/**
 * D-265. Grouping candidates by what stories say, beside the headline
 * shortlist. Two gaps closed:
 *
 * - The headline shortlist only proposes pairs whose headlines share wording,
 *   so the same event told from another angle never reached Jev.
 * - The reference pool was 72 hours. A new item about a story we already
 *   published could not join that idea, so URL-only dedupe let it back in.
 *   Members of ideas published in the last PUBLISHED_STORY_HOLD_DAYS are in
 *   the pool here, and joining one holds the item out as already published.
 *
 * One pool is loaded per run and shared by placement and the idea merge.
 */

type PoolEntry = { sourceId: string; terms: StoryTerms };

export type MatchPool = {
  entries: Map<string, PoolEntry>;
  idf: Idf;
};

const POOL_SQL = `
  SELECT s.id, s.headline, left(s.body, 4000) AS body
    FROM reels.sources s
    LEFT JOIN reels.post_idea_members m ON m.source_id = s.id
    LEFT JOIN reels.post_ideas i ON i.id = m.post_idea_id
   WHERE s.drop_reason IS NULL
     AND (
       (s.ingest_time > now() - ($1 || ' hours')::interval
         AND (m.post_idea_id IS NULL OR i.last_joined > now() - ($1 || ' hours')::interval))
       OR m.post_idea_id IN (
         SELECT post_idea_id FROM reels.posting_schedule
          WHERE status = 'published' AND publish_at > now() - ($2 || ' days')::interval)
     )`;

export async function loadMatchPool(): Promise<MatchPool> {
  const { rows } = await dbQuery<{ id: string; headline: string; body: string }>(POOL_SQL, [
    String(REFERENCE_POOL_HOURS),
    String(PUBLISHED_STORY_HOLD_DAYS),
  ]);
  return buildMatchPool(rows);
}

/** Pure. Exposed for tests. */
export function buildMatchPool(rows: ReadonlyArray<{ id: string; headline: string; body: string }>): MatchPool {
  const entries = new Map<string, PoolEntry>();
  for (const row of rows) entries.set(row.id, { sourceId: row.id, terms: storyTerms(row.headline, row.body) });
  return { entries, idf: poolIdf([...entries.values()].map((entry) => entry.terms)) };
}

/** Pure. Pool sources most like this one, best first, above the floor. */
export function nearestSources(
  pool: MatchPool,
  terms: StoryTerms,
  exclude: string,
  limit = CONTENT_SHORTLIST_LIMIT,
  floor = CONTENT_OVERLAP_FLOOR,
): Array<{ sourceId: string; overlap: number }> {
  const scored: Array<{ sourceId: string; overlap: number }> = [];
  for (const entry of pool.entries.values()) {
    if (entry.sourceId === exclude) continue;
    const overlap = storyOverlap(terms, entry.terms, pool.idf);
    if (overlap >= floor) scored.push({ sourceId: entry.sourceId, overlap });
  }
  return scored.sort((a, b) => b.overlap - a.overlap).slice(0, limit);
}

/** Content candidates for one source, in the headline shortlist's shape. */
export async function contentCandidates(
  pool: MatchPool,
  source: { id: string; headline: string; body: string },
): Promise<ShortlistCandidate[]> {
  const near = nearestSources(pool, storyTerms(source.headline, source.body), source.id);
  if (near.length === 0) return [];
  const overlapOf = new Map(near.map((entry) => [entry.sourceId, entry.overlap]));
  const { rows } = await dbQuery<Omit<ShortlistCandidate, 'similarity'>>(
    `SELECT s.id AS source_id, s.canonical_url, s.headline, s.body, s.source_type,
            s.source_name, s.publish_time, m.post_idea_id
       FROM reels.sources s
       LEFT JOIN reels.post_idea_members m ON m.source_id = s.id
      WHERE s.id = ANY($1::uuid[])`,
    [near.map((entry) => entry.sourceId)],
  );
  return rows
    .map((row) => ({ ...row, similarity: overlapOf.get(row.source_id) ?? 0 }))
    .sort((a, b) => b.similarity - a.similarity);
}

/** The headline shortlist plus content candidates, each source once. */
export function unionCandidates(
  headline: readonly ShortlistCandidate[],
  content: readonly ShortlistCandidate[],
): ShortlistCandidate[] {
  const seen = new Set<string>();
  const out: ShortlistCandidate[] = [];
  for (const candidate of [...headline, ...content]) {
    if (seen.has(candidate.source_id)) continue;
    seen.add(candidate.source_id);
    out.push(candidate);
  }
  return out;
}

/**
 * Pure. Idea pairs whose closest members overlap above the floor, best first.
 * `membership` maps each idea to its member source ids.
 */
export function contentIdeaPairs(
  pool: MatchPool,
  membership: ReadonlyMap<string, readonly string[]>,
  limit = IDEA_MERGE_MAX_PAIRS,
  floor = CONTENT_OVERLAP_FLOOR,
): IdeaMergeCandidate[] {
  const ideas = [...membership.entries()]
    .map(([id, members]) => ({ id, terms: members.map((m) => pool.entries.get(m)?.terms).filter((t): t is StoryTerms => !!t) }))
    .filter((idea) => idea.terms.length > 0);
  const pairs: IdeaMergeCandidate[] = [];
  for (let i = 0; i < ideas.length; i += 1) {
    for (let j = i + 1; j < ideas.length; j += 1) {
      let best = 0;
      for (const a of ideas[i].terms) for (const b of ideas[j].terms) best = Math.max(best, storyOverlap(a, b, pool.idf));
      if (best < floor) continue;
      const [left, right] = ideas[i].id < ideas[j].id ? [ideas[i].id, ideas[j].id] : [ideas[j].id, ideas[i].id];
      pairs.push({ left_id: left, right_id: right, similarity: best });
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

/** Current membership of every idea that has a source in the pool. */
export async function loadPoolMembership(pool: MatchPool): Promise<Map<string, string[]>> {
  const { rows } = await dbQuery<{ post_idea_id: string; source_id: string }>(
    `SELECT post_idea_id, source_id FROM reels.post_idea_members WHERE source_id = ANY($1::uuid[])`,
    [[...pool.entries.keys()]],
  );
  const out = new Map<string, string[]>();
  for (const row of rows) out.set(row.post_idea_id, [...(out.get(row.post_idea_id) ?? []), row.source_id]);
  return out;
}

/** Headline pairs plus content pairs, each pair once. */
export function unionIdeaPairs(
  headline: readonly IdeaMergeCandidate[],
  content: readonly IdeaMergeCandidate[],
): IdeaMergeCandidate[] {
  const seen = new Set<string>();
  const out: IdeaMergeCandidate[] = [];
  for (const pair of [...headline, ...content]) {
    const key = pair.left_id < pair.right_id ? `${pair.left_id}|${pair.right_id}` : `${pair.right_id}|${pair.left_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out;
}
