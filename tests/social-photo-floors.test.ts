// Photo rules (Tommy and Lucas, 2026-10-14): no logo-only covers, 1080 on the cover's short side, 600 on every
// other slide (a logo exempt there), and a size read from the image when its source doesn't state one.
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Candidate } from '@/lib/social/photos/find';
import { newPickState, pickForSlide, slotAllows, type Scored } from '@/lib/social/photos/pick';
import { clearsFloor, minShortSide } from '@/lib/social/photos/size';
import type { VisualRequest } from '@/lib/social/writer/draft';

const cand = (over: Partial<Candidate>): Candidate => ({ url: `u${Math.random()}`, credit: 'c', source: 'stock', width: 2000, height: 1500, qid: null, subject: null, lane: 'openverse', date: null, title: '', verified: true, ...over });
const scored = (c: Candidate): Scored => ({ cand: c, tags: null, fit: null });
const v = (kind: VisualRequest['kind'], query: string): VisualRequest => ({ kind, query });
const cover = { kind: 'cover' as const, speaker: null };
const story = { kind: 'story' as const, speaker: null };

test('floors: 1080 on the cover, 600 on a slide, none for a logo on a slide', () => {
  assert.equal(minShortSide('cover', 'article'), 1080);
  assert.equal(minShortSide('story', 'article'), 600);
  assert.equal(minShortSide('stat', 'openverse'), 600);
  assert.equal(minShortSide('story', 'logo'), 0);
});

test('the cover never takes a logo; a slide still may', () => {
  const logo = cand({ lane: 'logo', source: 'logo' });
  assert.equal(slotAllows(cover, logo), false);
  assert.equal(slotAllows(story, logo), true);
});

test('a photo under the cover floor is skipped for the next one, and the step says why', async () => {
  const small = cand({ url: 'https://a/small.jpg', width: 960, height: 518 });
  const big = cand({ url: 'https://a/big.jpg', width: 2400, height: 1600 });
  const out = await pickForSlide({ slot: cover, requests: [{ request: v('event', 'launch'), scored: [scored(small), scored(big)] }] }, newPickState(), {}, [], 0.5);
  assert.equal(out.winner?.cand.url, big.url);
  assert.ok(out.steps.some((s) => /too small for a cover \(960×518; needs 1080/.test(s)));
});

test('a slide takes a 600 photo the cover would refuse; under 600 it goes to the icon', async () => {
  const mid = cand({ url: 'https://a/mid.jpg', width: 900, height: 700 });
  assert.equal((await pickForSlide({ slot: story, requests: [{ request: v('event', 'x'), scored: [scored(mid)] }] }, newPickState(), {}, [], 0.5)).winner?.cand.url, mid.url);
  const tiny = cand({ url: 'https://a/tiny.jpg', width: 868, height: 488 });
  const none = await pickForSlide({ slot: story, requests: [{ request: v('event', 'x'), scored: [scored(tiny)] }] }, newPickState(), {}, [], 0.5);
  assert.equal(none.winner, null);
  assert.equal(none.via, 'icon');
});

test('an unknown size is read from the image; an image that cannot be read is skipped; no probe passes as before', async () => {
  const article = cand({ url: 'https://a/article.jpg', lane: 'article', source: 'article', width: 1200, height: null });
  const probe = async (url: string) => (url === article.url ? { w: 1200, h: 675 } : null);
  assert.deepEqual(await clearsFloor(article, 1080, probe), { ok: false, size: '1200×675' });
  assert.deepEqual(await clearsFloor(article, 600, probe), { ok: true, size: '1200×675' });
  assert.deepEqual(await clearsFloor({ ...article, url: 'https://a/gone.jpg' }, 600, probe), { ok: false, size: "couldn't be read" });
  assert.equal((await clearsFloor(article, 1080, undefined)).ok, true);
  const out = await pickForSlide({ slot: cover, requests: [{ request: v('company', 'Acme'), scored: [scored(article)] }] }, newPickState(), { size: probe }, [], 0.5);
  assert.equal(out.winner, null);
});
