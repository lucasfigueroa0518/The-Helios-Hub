// tests/lfd-pick.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { judgedPool, mergeSameEvent, scoreMajor, Selector, slideOrder } from '@/lib/lfd/pick';
import type { LfdCandidate } from '@/lib/lfd/types';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';

let n = 0;
function cand(o: Partial<LfdCandidate> & { headline: string }): LfdCandidate {
  n += 1;
  return { key: `k${n}`, refs: [`r${n}`], origin: 'reels', sourceName: 'Src', url: `https://x.com/${n}`, body: 'b'.repeat(2000), publishedAt: null, net: 0.5, blockbuster: 0, firstSeen: '2026-10-12', alsoFrom: [], major: null, ...o };
}

/** A Jev stub: answers by question-set version and the subject id. */
function jevStub(o: { major?: Record<string, number>; same?: (a: string, b: string) => boolean }): JevAsk {
  return async (req, meta): Promise<JevResult> => {
    const usage = { input_tokens: 100, output_tokens: 0 };
    if (meta.version.startsWith('major-news')) {
      const s = o.major?.[meta.subjectId] ?? 0;
      return { answers: { happened: { noul: s }, news_kind: { noul: s }, blockbuster_entity: { noul: s }, global_relevance: { noul: s }, political_relevance: { noul: s }, speculative: { noul: 0 } }, usage, model: 'stub' };
    }
    const state = req.state as { story_a: { headline: string }; story_b: { headline: string } };
    const same = o.same?.(state.story_a.headline, state.story_b.headline) ?? false;
    return { answers: { same_event: { noul: same ? 0.9 : 0.1 } }, usage, model: 'stub' };
  };
}

test('judged pool: carousel tops, reels top 10 per night plus blockbusters, then feed, capped at 60', () => {
  const reels = Array.from({ length: 15 }, (_, i) => cand({ headline: `R${i}`, firstSeen: '2026-10-12', net: i === 14 ? 0.01 : 0.5, blockbuster: i === 14 ? 1 : 0 }));
  const pool = judgedPool([cand({ headline: 'C0', origin: 'carousel' })], reels, [cand({ headline: 'F0', origin: 'feed' })]);
  assert.equal(pool[0]!.headline, 'C0');
  assert.ok(pool.some((c) => c.headline === 'R14'), 'a blockbuster is always judged');
  assert.equal(pool.filter((c) => c.origin === 'reels').length, 11, 'top 10 by net per night plus the blockbuster');
  assert.equal(pool.at(-1)!.headline, 'F0');
});

test('judged pool: the 60 cap never cuts the fresh feed', () => {
  const carousel = Array.from({ length: 40 }, (_, i) => cand({ headline: `C${i}`, origin: 'carousel' }));
  const reels = Array.from({ length: 40 }, (_, i) => cand({ headline: `R${i}`, firstSeen: `2026-10-${String(1 + (i % 4)).padStart(2, '0')}` }));
  const feed = Array.from({ length: 3 }, (_, i) => cand({ headline: `F${i}`, origin: 'feed' }));
  const pool = judgedPool(carousel, reels, feed);
  assert.ok(pool.length <= 60);
  for (const f of feed) assert.ok(pool.some((c) => c.key === f.key), f.headline);
});

test('scoreMajor sets the major-news@2 score on each candidate', async () => {
  const a = cand({ headline: 'Anthropic Releases Claude Haiku 5.5' });
  const [scored] = await scoreMajor([a], jevStub({ major: { [a.key]: 1 } }));
  assert.ok(scored!.major! > 0.55);
});

test('the same event from reels and a carousel merges into one story that keeps the major score', async () => {
  const fromCarousel = cand({ headline: 'Anthropic Releases Claude Haiku 5.5', origin: 'carousel', major: 0.8, net: null });
  const fromReels = cand({ headline: 'Claude Haiku 5.5 From Anthropic Is 10x Cheaper', net: 0.3, major: null });
  const merged = await mergeSameEvent([fromCarousel, fromReels], jevStub({ same: () => true }));
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.major, 0.8);
  assert.deepEqual(merged[0]!.refs.sort(), [...fromCarousel.refs, ...fromReels.refs].sort());
});

test('selector: up to 3 majors lead, rundown fills to 6, at most 2 per company', async () => {
  const majors = [
    cand({ headline: 'OpenAI Ships A', major: 0.9 }),
    cand({ headline: 'OpenAI Ships B', major: 0.8 }),
    cand({ headline: 'OpenAI Ships C', major: 0.7 }),
    cand({ headline: 'Google Ships D', major: 0.6 }),
    cand({ headline: 'Meta Ships E', major: 0.58 }),
  ];
  const rundown = Array.from({ length: 6 }, (_, i) => cand({ headline: `Niche Story ${i}`, net: 0.9 - i / 10 }));
  const sel = new Selector(majors, rundown, [], jevStub({}));
  const picks = await sel.fill();
  assert.equal(picks.length, 6);
  assert.deepEqual(picks.filter((p) => p.lane === 'major').map((p) => p.headline), ['OpenAI Ships A', 'OpenAI Ships B', 'Google Ships D']);
  assert.deepEqual(picks.filter((p) => p.lane === 'rundown').map((p) => p.headline), ['Niche Story 0', 'Niche Story 1', 'Niche Story 2']);
});

test('selector: a story the previous post covered is passed over', async () => {
  const rundown = [cand({ headline: 'Norway Wants To Ban AI Glasses' }), cand({ headline: 'Bose Brings Back Wired Earbuds' })];
  const sel = new Selector([], rundown, [{ headline: 'Norway Plans AI Glasses Ban', body: '' }], jevStub({ same: (a, b) => a.includes('Norway') && b.includes('Norway') }));
  const picks = await sel.fill();
  assert.deepEqual(picks.map((p) => p.headline), ['Bose Brings Back Wired Earbuds']);
});

test('selector: replacing a dropped major takes the next major, then falls to the rundown', async () => {
  const majors = [cand({ headline: 'Big One', major: 0.9 })];
  const rundown = [cand({ headline: 'Niche A' }), cand({ headline: 'Niche B' })];
  const sel = new Selector(majors, rundown, [], jevStub({}));
  await sel.fill();
  sel.drop(majors[0]!.key);
  const next = await sel.replace('major');
  assert.equal(next, null, 'no rundown left after the fill took both');
  const many = Array.from({ length: 6 }, (_, i) => cand({ headline: `Niche ${i}`, net: 0.9 - i / 10 }));
  const sel2 = new Selector(majors, many, [], jevStub({}));
  await sel2.fill(); // Big One + Niche 0..4
  sel2.drop(majors[0]!.key);
  assert.equal((await sel2.replace('major'))!.headline, 'Niche 5', 'no major left, so the rundown fills the slot');
});

test('selector: a major skipped for the company cap is reconsidered after a drop frees the company', async () => {
  const majors = [
    cand({ headline: 'OpenAI Ships A', major: 0.9 }),
    cand({ headline: 'OpenAI Ships B', major: 0.8 }),
    cand({ headline: 'OpenAI Ships C', major: 0.7 }),
  ];
  const sel = new Selector(majors, [], [], jevStub({}));
  const picks = await sel.fill();
  assert.deepEqual(picks.map((p) => p.headline), ['OpenAI Ships A', 'OpenAI Ships B']);
  sel.drop(majors[0]!.key);
  assert.equal((await sel.replace('major'))!.headline, 'OpenAI Ships C');
});

test('slideOrder: majors by score first, then rundown in rank order', () => {
  const picks = [
    { ...cand({ headline: 'R1', net: 0.9 }), lane: 'rundown' as const },
    { ...cand({ headline: 'M2', major: 0.6 }), lane: 'major' as const },
    { ...cand({ headline: 'M1', major: 0.9 }), lane: 'major' as const },
    { ...cand({ headline: 'R0', net: 0.95 }), lane: 'rundown' as const },
  ];
  assert.deepEqual(slideOrder(picks).map((p) => p.headline), ['M1', 'M2', 'R0', 'R1']);
});
