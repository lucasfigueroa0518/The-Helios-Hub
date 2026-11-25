import assert from 'node:assert/strict';
import test from 'node:test';

import { keepWithMedia, lfdMedia, mdMedia, promoteGolden, type VideoTier } from '@/lib/news-ranker/media-ladder';

test('MD ladder: golden video, then photo, then good video, else drop', () => {
  assert.equal(mdMedia({ video: 'golden', photo: true }), 'video');
  assert.equal(mdMedia({ video: 'good', photo: true }), 'photo');
  assert.equal(mdMedia({ video: 'none', photo: true }), 'photo');
  assert.equal(mdMedia({ video: 'good', photo: false }), 'video');
  assert.equal(mdMedia({ video: 'none', photo: false }), null);
});

test('LFD ladder: golden video, then meme, then photo, else drop', () => {
  assert.equal(lfdMedia({ video: 'golden', meme: true, photo: true }), 'video');
  assert.equal(lfdMedia({ video: 'good', meme: true, photo: true }), 'meme');
  assert.equal(lfdMedia({ video: 'none', meme: false, photo: true }), 'photo');
  assert.equal(lfdMedia({ video: 'good', meme: false, photo: false }), null);
});

test('promoteGolden: golden stories in the window post, picks fill, editorial order kept', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const tiers: Record<string, VideoTier> = { c: 'good', f: 'golden', i: 'golden' };
  const tier = (s: string) => tiers[s] ?? 'none';
  const out = promoteGolden(order, ['a', 'b', 'c'], { window: 8, max: 3, tier });
  // f is golden in the window and comes in ahead of the lowest pick; i is outside the window; good c never promotes.
  assert.deepEqual(out.map((p) => p.story), ['a', 'b', 'f']);
  assert.deepEqual(out.map((p) => p.promoted), [false, false, true]);
  // Room left: nobody is pushed out.
  assert.deepEqual(promoteGolden(order, ['a', 'b'], { window: 8, max: 5, tier }).map((p) => p.story), ['a', 'b', 'f']);
  // A pick that is itself golden is not "promoted".
  assert.deepEqual(promoteGolden(order, ['f'], { window: 8, max: 5, tier }), [{ story: 'f', promoted: false }]);
});

test('keepWithMedia: media-less stories drop unless the day would fall under the minimum', () => {
  assert.deepEqual(keepWithMedia(['photo', null, 'video', null], 2), [0, 2]);
  assert.deepEqual(keepWithMedia([null, 'photo', null], 2), [0, 1]);
  assert.deepEqual(keepWithMedia([null, null], 2), [0, 1]);
});
