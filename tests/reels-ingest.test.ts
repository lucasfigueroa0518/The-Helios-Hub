/** Ingest rules that decide what reaches the pool. No network, no Jev, no DB. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ARTICLE_FEED_CAP } from '@/lib/reels/config';
import { applyCap } from '@/lib/reels/pipeline/ingest';
import type { Adapter, AdapterItem } from '@/lib/reels/types';

function adapter(overrides: Partial<Adapter> = {}): Adapter {
  return {
    id: 'test',
    name: 'Test',
    type: 'B1',
    bucket: 'B',
    kind: 'dated',
    fetchItems: async () => [],
    ...overrides,
  };
}

function item(index: number, overrides: Partial<AdapterItem> = {}): AdapterItem {
  return {
    canonicalUrl: `https://example.com/${index}`,
    headline: `Story ${index}`,
    body: 'Body',
    publishTime: new Date(2026, 8, 1, 0, index),
    ...overrides,
  };
}

test('a ranked list ingests whole, however long it is', () => {
  const items = Array.from({ length: 40 }, (_, index) => item(index));
  const { kept, overflow } = applyCap(adapter({ kind: 'ranked' }), items);
  assert.equal(kept.length, 40);
  assert.equal(overflow, 0);
});

test('an article feed is capped at the nightly limit', () => {
  const items = Array.from({ length: ARTICLE_FEED_CAP + 7 }, (_, index) => item(index));
  const { kept, overflow } = applyCap(adapter(), items);
  assert.equal(kept.length, ARTICLE_FEED_CAP);
  assert.equal(overflow, 7);
});

test('an article feed under the cap keeps everything and reports no overflow', () => {
  const { kept, overflow } = applyCap(adapter(), [item(1), item(2)]);
  assert.equal(kept.length, 2);
  assert.equal(overflow, 0);
});

test('engagement picks the winners when a source is over its cap', () => {
  const items = [
    item(1, { engagement: { points: 5 } }),
    item(2, { engagement: { points: 400 } }),
    item(3, { engagement: { points: 90 } }),
  ];
  const { kept } = applyCap(adapter({ cap: 2 }), items);
  assert.deepEqual(kept.map((entry) => entry.headline), ['Story 2', 'Story 3']);
});

test('without engagement the newest items win, never a hard floor', () => {
  const items = [
    item(1, { publishTime: new Date('2026-09-01T00:00:00Z') }),
    item(2, { publishTime: new Date('2026-09-03T00:00:00Z') }),
    item(3, { publishTime: new Date('2026-09-02T00:00:00Z') }),
  ];
  const { kept } = applyCap(adapter({ cap: 2 }), items);
  assert.deepEqual(kept.map((entry) => entry.headline), ['Story 2', 'Story 3']);
});

test('the A4 catalog and the generated story are never capped', () => {
  const items = Array.from({ length: 20 }, (_, index) => item(index));
  assert.equal(applyCap(adapter({ kind: 'catalog' }), items).kept.length, 20);
  assert.equal(applyCap(adapter({ kind: 'generated' }), items).kept.length, 20);
});
