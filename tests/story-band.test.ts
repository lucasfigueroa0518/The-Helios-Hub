/**
 * Morning Download band fit and posting rule (lab, 2026-11-23). Offline: pure geometry and pure choosePosts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { choosePosts } from '../scripts/news-ranker-rerank';
import { BAND_CLEAR, BAND_CLEAR_TEXT, BAND_H, BAND_W, CONTAINED_BOTTOM, CONTAINED_TOP, decideBand } from '../scripts/story-crop';

const inside = (w: number, h: number, b: { left: number; right: number; top: number; bottom: number }, essential = b, hasText = false) => {
  const p = decideBand(w, h, essential, hasText);
  const x0 = p.left + b.left * p.drawW, x1 = p.left + b.right * p.drawW, y0 = p.top + b.top * p.drawH, y1 = p.top + b.bottom * p.drawH;
  const [lo, hi] = p.contained ? [CONTAINED_TOP, CONTAINED_BOTTOM] : [0, (hasText ? BAND_CLEAR_TEXT : BAND_CLEAR) * BAND_H];
  return { p, ok: x0 >= -0.5 && x1 <= BAND_W + 0.5 && y0 >= lo - 0.5 && y1 <= hi + 0.5 };
};

test('the subject is never cut, wherever it sits in the picture', () => {
  for (const [w, h] of [[1920, 1080], [1200, 800], [800, 1200], [3000, 900], [600, 600]] as const)
    for (const left of [0, 0.1, 0.4, 0.7]) for (const top of [0, 0.3, 0.6]) for (const size of [0.1, 0.3, 0.6]) {
      const b = { left, right: Math.min(1, left + size), top, bottom: Math.min(1, top + size) };
      assert.ok(inside(w, h, b).ok, `${w}x${h} ${JSON.stringify(b)}`);
    }
});

test('a face at the left of a wide photo stays whole (the Jensen case)', () => {
  const { p, ok } = inside(1920, 1080, { left: 0.05, right: 0.4, top: 0.1, bottom: 0.75 });
  assert.ok(ok);
  assert.ok(p.left <= 0.5, 'the photo still reaches the left edge');
});

test('a small subject in a big photo covers the band with no blur fill', () => {
  assert.equal(decideBand(1920, 1080, { left: 0.45, right: 0.55, top: 0.3, bottom: 0.5 }).covers, true);
});

test('a short photo sits centred between the masthead and the copy, not at the top', () => {
  const p = decideBand(1920, 1080, { left: 0, right: 1, top: 0, bottom: 1 }, true);
  assert.equal(p.contained, true);
  assert.ok(Math.abs(p.top + p.drawH / 2 - (CONTAINED_TOP + CONTAINED_BOTTOM) / 2) < 1);
});

test('a picture with text to read is kept whole', () => {
  const { ok } = inside(1920, 1080, { left: 0, right: 1, top: 0, bottom: 1 }, { left: 0.4, right: 0.6, top: 0.4, bottom: 0.6 }, true);
  assert.ok(ok);
});

const s = (id: string, top_tier: boolean) => ({ id, duplicate_of: null, top_tier, crowds: null });

test('a deep day posts only top stories with good photos', () => {
  const ranked = [s('a', true), s('b', true), s('c', true), s('d', false)];
  const photo = { a: 'good', b: 'usable', c: 'good', d: 'good' } as const;
  assert.deepEqual(choosePosts(ranked, (x) => photo[x.id as keyof typeof photo]), ['a', 'c']);
});

test('to reach the minimum, the stronger story wins over the stronger photo', () => {
  const ranked = [s('a', true), s('b', true), s('c', false), s('d', false)];
  const photo = { a: 'good', b: 'usable', c: 'good', d: 'none' } as const;
  assert.deepEqual(choosePosts(ranked, (x) => photo[x.id as keyof typeof photo]), ['a', 'b']);
});

test('a story with no photo never posts', () => {
  const ranked = [s('a', true), s('b', false), s('c', false)];
  const photo = { a: 'none', b: 'usable', c: 'good' } as const;
  assert.deepEqual(choosePosts(ranked, (x) => photo[x.id as keyof typeof photo]), ['b', 'c']);
});
