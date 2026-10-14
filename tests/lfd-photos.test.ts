import assert from 'node:assert/strict';
import test from 'node:test';

import { findPhotos, requestFor } from '@/lib/lfd/photos';
import type { Pick, StoryCopy } from '@/lib/lfd/types';
import type { PhotoFinder, PhotoRequest } from '@/lib/stories/photos';

const pick = { key: 'a', refs: [], origin: 'reels', headline: 'H', sourceName: 'S', url: 'https://s.com/a', body: '', publishedAt: '2026-10-12T10:00:00Z', net: 1, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, lane: 'rundown' } satisfies Pick;
const copy: StoryCopy = { key: 'a', setup: '', headline: 'Bose Brought Back Wired Earbuds', highlight: '', names: [], body: 'b', photo: { kind: 'product', query: 'Bose wired earbuds', subjects: [{ name: 'Bose', type: 'organization' }], alts: [{ kind: 'logo', query: 'Bose logo' }] } };

test('a request carries the writer photo ask, the source page, the date and the 7-day exclude set', () => {
  const exclude = new Set(['https://used.jpg']);
  const req = requestFor(pick, copy, exclude);
  assert.deepEqual(req, { kind: 'product', query: 'Bose wired earbuds', subjects: [{ name: 'Bose', type: 'organization' }], storyDate: '2026-10-12', sourceUrls: ['https://s.com/a'], alts: [{ kind: 'logo', query: 'Bose logo' }], copy: 'Bose Brought Back Wired Earbuds', exclude });
});

test('findPhotos finds the set together and returns null for a story with no usable photo', async () => {
  const seen: PhotoRequest[][] = [];
  const finder: PhotoFinder = {
    usd: 0,
    find: async () => null,
    findSet: async (reqs) => { seen.push(reqs); return reqs.map((r, i) => (i === 0 ? { src: 'https://p.jpg', credit: 'C', kind: 'scene' } : null)); },
  };
  const out = await findPhotos(finder, [{ pick, copy }, { pick: { ...pick, key: 'b' }, copy: { ...copy, key: 'b' } }], new Set());
  assert.equal(seen.length, 1, 'one set call');
  assert.equal(out.photos[0]!.src, 'https://p.jpg');
  assert.equal(out.photos[1], null);
});

/** A finder whose set call fills the trace like the live finder does. */
const tracing = (steps: string[][]): PhotoFinder => ({
  usd: 0,
  find: async () => null,
  findSet: async (reqs, trace) => {
    trace?.push(...steps);
    return reqs.map((_, i) => ({ src: `https://p/${i}.jpg`, credit: 'C', kind: 'scene' }));
  },
});

test('findPhotos returns each story trace; a normal trace keeps its photo', async () => {
  const out = await findPhotos(tracing([['product: "Bose wired earbuds"', 'article photo → winner']]), [{ pick, copy }], new Set());
  assert.equal(out.photos[0]!.src, 'https://p/0.jpg');
  assert.deepEqual(out.traces, [['product: "Bose wired earbuds"', 'article photo → winner']]);
});

test('a photo won by the icon-scene fallback is refused, and the trace says so', async () => {
  const steps = [['company: "Bose"', 'icon scene (newspaper) → "stack of newspapers"', 'stock → winner'], ['product: "x"', 'article photo → winner']];
  const out = await findPhotos(tracing(steps), [{ pick, copy }, { pick: { ...pick, key: 'b' }, copy: { ...copy, key: 'b' } }], new Set());
  assert.equal(out.photos[0], null);
  assert.equal(out.traces[0]!.at(-1), 'lfd: refused icon-scene fallback');
  assert.equal(out.photos[1]!.src, 'https://p/1.jpg');
});

test('a finder that leaves no trace still yields one (empty) trace per story', async () => {
  const finder: PhotoFinder = { usd: 0, find: async () => ({ src: 'https://f.jpg', credit: 'C', kind: 'scene' }) };
  const out = await findPhotos(finder, [{ pick, copy }], new Set());
  assert.equal(out.photos[0]!.src, 'https://f.jpg');
  assert.deepEqual(out.traces, [[]]);
});
