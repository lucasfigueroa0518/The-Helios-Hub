/**
 * Duplicate grouping (spec §5B): same story, many outlets = 1 candidate.
 *
 * Code picks likely neighbours from headline overlap; Jev answers "same
 * news event?" for each pair (same-event@1); union-find merges the pairs
 * at or above the threshold. No Haiku fields.
 */
import { mapPool } from '@/lib/async-pool';
import type { JevAsk } from '@/lib/social/jev/client';
import * as SameEvent from '@/lib/social/jev/questions/same-event.v1';

import { outletKey, outletName } from './outlets';
import type { GroupMember, IngestArticle, StoryGroup } from './types';


export const MAX_NEIGHBOURS = 5;
export const JEV_CONCURRENCY = 8;
const MIN_JACCARD = 0.15;
const MIN_SHARED_NAMES = 2;

const STOPWORDS = new Set(
  'the and for with from that this into over after about says said will its new are has have was not but you your how why what who'.split(' '),
);

function tokens(headline: string): Set<string> {
  return new Set(
    headline
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

/** Capitalised words after the first word: a cheap proxy for shared names. */
function names(headline: string): Set<string> {
  const words = headline.split(/\s+/).slice(1);
  return new Set(words.filter((w) => /^[A-Z][A-Za-z0-9-]+/.test(w)).map((w) => w.replace(/[^A-Za-z0-9-]/g, '').toLowerCase()));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

export type NeighbourPair = [number, number];

/**
 * Candidate pairs by index (i < j). Each article contributes its top
 * MAX_NEIGHBOURS most similar headlines that clear the floor.
 */
export function neighbourPairs(articles: IngestArticle[]): NeighbourPair[] {
  const tok = articles.map((a) => tokens(a.headline));
  const nm = articles.map((a) => names(a.headline));
  const pairs = new Set<string>();
  for (let i = 0; i < articles.length; i++) {
    const scored: Array<{ j: number; sim: number }> = [];
    for (let j = 0; j < articles.length; j++) {
      if (i === j) continue;
      const shared = overlap(tok[i]!, tok[j]!);
      const union = tok[i]!.size + tok[j]!.size - shared;
      const jaccard = union > 0 ? shared / union : 0;
      const sharedNames = overlap(nm[i]!, nm[j]!);
      if (jaccard < MIN_JACCARD && sharedNames < MIN_SHARED_NAMES) continue;
      scored.push({ j, sim: jaccard + 0.15 * sharedNames });
    }
    scored.sort((a, b) => b.sim - a.sim);
    for (const { j } of scored.slice(0, MAX_NEIGHBOURS)) {
      pairs.add(i < j ? `${i},${j}` : `${j},${i}`);
    }
  }
  return [...pairs].map((p) => p.split(',').map(Number) as NeighbourPair).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Native feeds first, then the longest RSS body. */
export function byPreference(articles: IngestArticle[]): IngestArticle[] {
  return [...articles].sort((a, b) => {
    const native = Number(b.feedKind === 'native') - Number(a.feedKind === 'native');
    return native || b.body.length - a.body.length;
  });
}

export function buildGroup(articles: IngestArticle[]): StoryGroup {
  const ordered = byPreference(articles);
  const representative = ordered[0]!;
  const members: GroupMember[] = [...articles]
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .map((a) => ({
      url: a.sourceUrl,
      outlet: outletName(a),
      title: a.headline,
      publishedAt: a.publishedAt,
      feedSlug: a.feedSlug,
    }));
  const outlets: string[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const key = outletKey(m.outlet);
    if (!seen.has(key)) {
      seen.add(key);
      outlets.push(m.outlet);
    }
  }
  return {
    id: representative.sourceUrl,
    members,
    outlets,
    outletCount: outlets.length,
    publishedAt: members[0]!.publishedAt,
    representative,
    articles: ordered,
    body: representative.body,
  };
}

export async function groupArticles(articles: IngestArticle[], jev: JevAsk): Promise<StoryGroup[]> {
  const parent = articles.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // One Jev call per article that has neighbours; it asks about each of them.
  const byAsker = new Map<number, number[]>();
  for (const [i, j] of neighbourPairs(articles)) {
    const list = byAsker.get(i) ?? [];
    list.push(j);
    byAsker.set(i, list);
  }
  const asks = [...byAsker.entries()];
  const answers = await mapPool(asks, JEV_CONCURRENCY, async ([i, js]) => {
    const neighbours = js.map((j) => articles[j]!);
    return jev(
      { state: SameEvent.buildState(articles[i]!, neighbours), questions: SameEvent.buildQuestions(neighbours.length) },
      { version: SameEvent.VERSION, subjectId: articles[i]!.sourceUrl },
    );
  });
  asks.forEach(([i, js], n) => {
    js.forEach((j, k) => {
      const p = answers[n]!.answers[SameEvent.neighbourId(k)]?.noul ?? 0;
      if (p >= SameEvent.THRESHOLDS.SAME_EVENT_MIN) union(i, j);
    });
  });

  const buckets = new Map<number, IngestArticle[]>();
  articles.forEach((a, i) => {
    const root = find(i);
    const list = buckets.get(root) ?? [];
    list.push(a);
    buckets.set(root, list);
  });
  return [...buckets.values()].map(buildGroup);
}
