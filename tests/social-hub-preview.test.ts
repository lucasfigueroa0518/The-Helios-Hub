import assert from 'node:assert/strict';
import test from 'node:test';

import { costOfPosts, summarize } from '@/lib/social-hub/cost';

import { FIXTURE_NOW, previewDataset } from './fixtures/social-hub/preview-dataset';

test('the preview fixture builds through the real adapters and cost model without errors', () => {
  const d = previewDataset();
  assert.deepEqual(d.errors, []);
  assert.deepEqual(d.costNotes, []);
  const count = (v: string, s?: string) => d.posts.filter((p) => p.vertical === v && (!s || p.status === s)).length;
  for (const v of ['reels', 'explainers', 'carousels', 'stories']) assert.ok(count(v, 'published') > 5, v);
  assert.ok(d.posts.some((p) => p.status === 'scheduled'));
  assert.ok(d.posts.some((p) => p.status === 'cancelled'));
  assert.ok(d.posts.some((p) => p.status === 'ready'));
  const s = summarize(d.cost!, { from: null, to: '2026-12-31' });
  assert.equal(s.itemMicros + s.unattributedMicros, s.ledgerMicros);
  assert.ok(costOfPosts(d.posts.filter((p) => p.status === 'published')).micros > 0);
  assert.equal(FIXTURE_NOW.toISOString(), '2026-10-08T19:00:00.000Z');
  console.log(JSON.stringify({ posts: d.posts.length, ideas: d.ideas.length, sources: d.sources.length, byStatus: Object.fromEntries(['published','scheduled','cancelled','failed','ready','skipped'].map((st) => [st, d.posts.filter((p) => p.status === st).length])) }));
});
