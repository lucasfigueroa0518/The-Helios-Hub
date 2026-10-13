import assert from 'node:assert/strict';
import test from 'node:test';

import { carouselLane, freshFeedLane, lastCarouselRunAt } from '@/lib/lfd/sources';
import type { FetchedArticle } from '@/lib/social/ingest/fetch-feeds';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { seedCarouselRun } from './fixtures/lfd/seed';

test('carousel lane reads shortlists of runs finished since the window start, top 10 each', async () => {
  const { query } = await openHubTestDb();
  await seedCarouselRun(query, '2026-10-08T07:00:00Z', [{ id: 'https://old.com/1', headline: 'Too old', source: 'Old' }]);
  await seedCarouselRun(query, '2026-10-11T07:00:00Z', Array.from({ length: 12 }, (_, i) => ({ id: `https://c.com/${i}`, headline: `Carousel ${i}`, source: 'Wired' })));
  const lane = await carouselLane(query, '2026-10-10T04:00:00Z');
  assert.equal(lane.length, 10);
  assert.equal(lane[0]!.headline, 'Carousel 0');
  assert.equal(lane[0]!.origin, 'carousel');
  assert.deepEqual(lane[0]!.refs, ['https://c.com/0']);
});

test('no carousel run in the window gives an empty lane and a null last run', async () => {
  const { query } = await openHubTestDb();
  assert.deepEqual(await carouselLane(query, '2026-10-10T04:00:00Z'), []);
  assert.equal(await lastCarouselRunAt(query), null);
});

test('fresh feed lane keeps only articles newer than the last carousel run, newest first', async () => {
  const article = (h: string, at: string): FetchedArticle => ({ feedSlug: 'verge', feedKind: 'native', source: 'The Verge', sourceUrl: `https://v.com/${h}`, headline: h, byline: null, body: 'b'.repeat(600), publishedAt: new Date(at) });
  const lane = await freshFeedLane(async () => [
    article('Anthropic ships Claude Haiku 5.5', '2026-10-12T18:00:00Z'),
    article('Before the last run', '2026-10-12T02:00:00Z'),
    article('Newest', '2026-10-12T20:00:00Z'),
  ], new Date('2026-10-12T07:00:00Z'));
  assert.deepEqual(lane.map((c) => c.headline), ['Newest', 'Anthropic ships Claude Haiku 5.5']);
  assert.equal(lane[0]!.origin, 'feed');
});
