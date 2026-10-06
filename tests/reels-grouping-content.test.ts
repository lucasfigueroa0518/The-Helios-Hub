/** D-265. Content-overlap grouping candidates, offline. No Jev, no database. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMatchPool,
  contentIdeaPairs,
  nearestSources,
  unionCandidates,
  unionIdeaPairs,
} from '@/lib/reels/grouping/content-candidates';
import { poolIdf, storyOverlap, storyTerms } from '@/lib/reels/grouping/story-terms';
import type { ShortlistCandidate } from '@/lib/reels/repository';

// Invented stories. Two describe one event from different angles with little
// headline wording in common; the rest share only a common subject word.
const rows = [
  { id: 'a', headline: 'Regulator opens inquiry after harbor drones crash into ferry', body: 'The port authority of Valdmere opened a formal inquiry on Monday after three delivery drones operated by Skylark Freight collided with a passenger ferry. Valdmere officials said the inquiry will examine Skylark flight logs and the ferry crew statements.' },
  { id: 'b', headline: 'Skylark Freight apologizes to Valdmere ferry passengers', body: 'Skylark Freight apologized to passengers of the Valdmere ferry struck by its delivery drones, and said it would hand flight logs to the port authority inquiry.' },
  { id: 'c', headline: 'Drones are changing how cities deliver groceries', body: 'Across many cities, drones now carry groceries to homes. Analysts expect drone delivery to grow next year as costs fall.' },
  { id: 'd', headline: 'New battery doubles drone flight time', body: 'A lab announced a battery chemistry that doubles drone flight time in tests, with production planned for later.' },
  { id: 'e', headline: 'Drones banned from stadium events', body: 'A sports league banned drones from stadium events this season, citing crowd safety.' },
];

test('the same event told from two angles overlaps far more than stories that only share a subject', () => {
  const pool = buildMatchPool(rows);
  const near = nearestSources(pool, pool.entries.get('a')!.terms, 'a', 5, 0);
  assert.equal(near[0].sourceId, 'b');
  assert.ok(near[0].overlap > 2 * near[1].overlap, `${near[0].overlap} vs ${near[1].overlap}`);
});

test('a word common across the pool weighs less than a word two stories share alone', () => {
  const terms = rows.map((row) => storyTerms(row.headline, row.body));
  const idf = poolIdf(terms);
  assert.ok(idf.weight('valdmere') > idf.weight('drones'));
});

test('overlap is symmetric, bounded, and zero for empty text', () => {
  const pool = buildMatchPool(rows);
  const [a, b] = [pool.entries.get('a')!.terms, pool.entries.get('b')!.terms];
  const ab = storyOverlap(a, b, pool.idf);
  assert.ok(Math.abs(ab - storyOverlap(b, a, pool.idf)) < 1e-12);
  assert.ok(ab > 0 && ab <= 1);
  assert.equal(storyOverlap(storyTerms('', ''), a, pool.idf), 0);
});

test('the floor and the limit bound how many candidates reach Jev', () => {
  const pool = buildMatchPool(rows);
  assert.ok(nearestSources(pool, pool.entries.get('a')!.terms, 'a', 1, 0).length === 1);
  assert.deepEqual(nearestSources(pool, pool.entries.get('a')!.terms, 'a', 5, 0.99), []);
});

test('idea pairs come from their closest members, best first', () => {
  const pool = buildMatchPool(rows);
  const membership = new Map([['idea-1', ['a']], ['idea-2', ['b', 'e']], ['idea-3', ['d']]]);
  const pairs = contentIdeaPairs(pool, membership, 5, 0.12);
  assert.equal(pairs[0].left_id, 'idea-1');
  assert.equal(pairs[0].right_id, 'idea-2');
});

test('the union keeps headline candidates first and lists each source once', () => {
  const c = (id: string, similarity: number) => ({ source_id: id, similarity } as ShortlistCandidate);
  assert.deepEqual(unionCandidates([c('x', 0.5), c('y', 0.4)], [c('y', 0.3), c('z', 0.2)]).map((x) => x.source_id), ['x', 'y', 'z']);
  const p = (l: string, r: string) => ({ left_id: l, right_id: r, similarity: 0.5 });
  assert.equal(unionIdeaPairs([p('a', 'b')], [p('b', 'a'), p('a', 'c')]).length, 2);
});
