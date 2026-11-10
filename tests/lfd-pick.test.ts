// tests/lfd-pick.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { judgedPool, mergeSameEvent, scoreMajor, Selector, slideOrder } from '@/lib/lfd/pick';
import type { LfdCandidate } from '@/lib/lfd/types';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';

let n = 0;
function cand(o: Partial<LfdCandidate> & { headline: string }): LfdCandidate {
  n += 1;
  return { key: `k${n}`, refs: [`r${n}`], origin: 'reels', sourceName: 'Src', url: `https://x.com/${n}`, body: 'b'.repeat(2000), publishedAt: null, net: 0.5, blockbuster: 0, firstSeen: '2026-10-12', alsoFrom: [], major: null, builder: null, eventDate: null, ...o };
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

test('scoreMajor runs up to 8 judgments at once and keeps the input order', async () => {
  const list = Array.from({ length: 20 }, (_, i) => cand({ headline: `Story ${i}` }));
  let inFlight = 0;
  let peak = 0;
  const base = jevStub({ major: Object.fromEntries(list.map((c, i) => [c.key, i / 20])) });
  const slow: JevAsk = async (req, meta) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 20 - (Number(meta.subjectId.slice(1)) % 7) * 2));
    inFlight -= 1;
    return base(req, meta);
  };
  const scored = await scoreMajor(list, slow);
  assert.deepEqual(scored.map((c) => c.key), list.map((c) => c.key));
  assert.ok(scored[19]!.major! > scored[1]!.major!);
  assert.ok(peak > 1 && peak <= 8, `peak concurrency ${peak}`);
});

test('scoreMajor reuses scores it already has instead of asking Jev again', async () => {
  const a = cand({ headline: 'Already Judged' });
  const b = cand({ headline: 'Not Yet Judged' });
  const asked: string[] = [];
  const base = jevStub({ major: { [b.key]: 1 } });
  const counting: JevAsk = async (req, meta) => { asked.push(meta.subjectId); return base(req, meta); };
  const scored = await scoreMajor([a, b], counting, new Map([[a.key, 0.42]]));
  assert.deepEqual(asked, [b.key]);
  assert.equal(scored[0]!.major, 0.42);
});

test('unused walks leftover majors then rundown, skipping keys already used', () => {
  const majors = [cand({ headline: 'M1', major: 0.9, origin: 'carousel' }), cand({ headline: 'M2', major: 0.8, origin: 'carousel' }), cand({ headline: 'M3', major: 0.7, origin: 'carousel' })];
  const rundown = [cand({ headline: 'R1', net: 3, origin: 'reels' }), cand({ headline: 'R2', net: 2, origin: 'reels' })];
  const sel = new Selector(majors, rundown, [], jevStub({}));
  assert.deepEqual(sel.unused(8, [majors[0]!.key]).map((c) => c.headline), ['M2', 'M3', 'R1', 'R2']);
  const taken = sel.adopt(majors[1]!, 'major');
  assert.equal(taken.headline, 'M2');
  assert.equal(sel.picks[0]!.key, majors[1]!.key);
});

test('a shared common headline word alone does not trigger a same-event check', async () => {
  let calls = 0;
  const base = jevStub({ same: () => true });
  const counting: JevAsk = async (req, meta) => { calls += 1; return base(req, meta); };
  const merged = await mergeSameEvent([
    cand({ headline: 'Startup Launches New Model For Lawyers' }),
    cand({ headline: 'Retailer Launches Model Shopping Assistant' }),
  ], counting);
  assert.equal(calls, 0);
  assert.equal(merged.length, 2);
});

/* ── Builder lane (central intake Phase 1) ─────────────────────────────────────────────── */

const NOW = new Date('2026-11-10T08:00:00Z');
const fresh = '2026-11-08T00:00:00.000Z';

test('lead queue: builders are uncapped and taken by margin beside majors; majors stay at most 3', async () => {
  const leads = [
    cand({ headline: 'Major Story A', major: 0.9 }), // margin 0.35
    cand({ headline: 'Major Story B', major: 0.85 }), // 0.30
    cand({ headline: 'Major Story C', major: 0.8 }), // 0.25
    cand({ headline: 'Major Story D', major: 0.79 }), // 0.24: capped
    cand({ headline: 'Builder One', builder: 0.98, eventDate: fresh }), // 0.33 (bar 0.65)
    cand({ headline: 'Builder Two', builder: 0.92, eventDate: fresh }), // 0.27
    cand({ headline: 'Builder Three', builder: 0.8, eventDate: null }), // 0.15: unknown date passes
    cand({ headline: 'Builder Four', builder: 0.7, eventDate: fresh }), // 0.05
  ];
  const rundown = Array.from({ length: 4 }, (_, i) => cand({ headline: `Niche Story ${i}`, net: 0.9 - i / 10 }));
  const sel = new Selector(leads, rundown, [], jevStub({}), [], NOW);
  const picks = await sel.fill();
  assert.deepEqual(picks.map((p) => [p.headline, p.lane]), [
    ['Major Story A', 'major'],
    ['Builder One', 'builder'],
    ['Major Story B', 'major'],
    ['Builder Two', 'builder'],
    ['Major Story C', 'major'],
    ['Builder Three', 'builder'],
  ]);
  assert.equal(picks.filter((p) => p.lane === 'major').length, 3);
  assert.deepEqual(sel.top('builder', 10).map((c) => c.headline), ['Builder One', 'Builder Two', 'Builder Three', 'Builder Four']);
  assert.deepEqual(sel.top('major', 10).map((c) => c.headline), ['Major Story A', 'Major Story B', 'Major Story C', 'Major Story D']);
});

test('lead queue: builders alone may fill all six slots (no reserved slot, no cap)', async () => {
  const leads = Array.from({ length: 7 }, (_, i) => cand({ headline: `Builder Story ${i}`, builder: 0.95 - i / 100, eventDate: fresh }));
  const picks = await new Selector(leads, [cand({ headline: 'Niche Story' })], [], jevStub({}), [], NOW).fill();
  assert.equal(picks.length, 6);
  assert.ok(picks.every((p) => p.lane === 'builder'));
});

test('lead queue: an 8-day-old builder is not a lead; its major score still counts', async () => {
  const old = '2026-11-02T00:00:00.000Z';
  const leads = [
    cand({ headline: 'Old Builder', builder: 0.99, eventDate: old }),
    cand({ headline: 'Old Builder With Major', builder: 0.99, major: 0.6, eventDate: old }),
  ];
  const sel = new Selector(leads, [cand({ headline: 'Niche Story' })], [], jevStub({}), [], NOW);
  const picks = await sel.fill();
  assert.deepEqual(picks.map((p) => [p.headline, p.lane]), [['Old Builder With Major', 'major'], ['Niche Story', 'rundown']]);
  assert.deepEqual(sel.top('builder', 10), []);
});

test('legacy (no builder scores): the lineup equals today\'s majors-then-rundown rule', async () => {
  const majors = [
    cand({ headline: 'Alpha Corp Ships A', major: 0.7 }),
    cand({ headline: 'Beta Corp Ships B', major: 0.9 }),
    cand({ headline: 'Gamma Corp Ships C', major: 0.55 }),
    cand({ headline: 'Delta Corp Ships D', major: 0.6 }),
    cand({ headline: 'Below Bar', major: 0.54 }),
  ];
  const rundown = Array.from({ length: 5 }, (_, i) => cand({ headline: `Niche Story ${i}`, net: 0.5 + i / 10 }));
  const picks = await new Selector(majors, rundown, [], jevStub({}), [], NOW).fill();
  // Today: majors above 0.55 by score, at most 3; the rundown (blockbuster, then net) fills to 6.
  assert.deepEqual(picks.map((p) => p.headline), ['Beta Corp Ships B', 'Alpha Corp Ships A', 'Delta Corp Ships D', 'Niche Story 4', 'Niche Story 3', 'Niche Story 2']);
  assert.ok(picks.slice(0, 3).every((p) => p.lane === 'major'));
  assert.deepEqual(slideOrder(picks, NOW).map((p) => p.headline), picks.map((p) => p.headline));
});

test('replacement: same lane first, then the lead queue, then the rundown', async () => {
  // Builders: a dropped builder takes the next builder; with none left, the lead queue, then the rundown.
  const builders = Array.from({ length: 7 }, (_, i) => cand({ headline: `Builder Story ${i}`, builder: 0.95 - i / 100, eventDate: fresh }));
  const sel = new Selector(builders, [cand({ headline: 'Niche Story A' })], [], jevStub({}), [], NOW);
  await sel.fill(); // Builder Story 0..5
  sel.drop(builders[0]!.key);
  assert.equal((await sel.replace('builder'))!.headline, 'Builder Story 6');
  sel.drop(builders[1]!.key);
  assert.equal((await sel.replace('builder'))!.headline, 'Niche Story A', 'no lead left: the rundown');

  // A rundown drop with the rundown spent: the lead queue (a major the cap had held back, now under the cap).
  const majors = [cand({ headline: 'Major One', major: 0.9 }), cand({ headline: 'Major Two', major: 0.8 }), cand({ headline: 'Major Three', major: 0.7 }), cand({ headline: 'Major Four', major: 0.6 })];
  const rundown = [cand({ headline: 'Niche Story R' })];
  const sel2 = new Selector(majors, rundown, [], jevStub({}), [], NOW);
  assert.deepEqual((await sel2.fill()).map((p) => p.headline), ['Major One', 'Major Two', 'Major Three', 'Niche Story R']);
  sel2.drop(majors[0]!.key);
  sel2.drop(rundown[0]!.key);
  const next = await sel2.replace('rundown');
  assert.deepEqual([next!.headline, next!.lane], ['Major Four', 'major']);
});

test('replacement: a dropped major takes the next major before a builder or the rundown', async () => {
  const leads = [
    cand({ headline: 'Major One', major: 0.9 }),
    cand({ headline: 'Major Two', major: 0.8 }),
    cand({ headline: 'Major Three', major: 0.7 }),
    cand({ headline: 'Major Four', major: 0.6 }),
  ];
  const sel = new Selector(leads, [cand({ headline: 'Niche Story A' }), cand({ headline: 'Niche Story B' }), cand({ headline: 'Niche Story C' }), cand({ headline: 'Niche Story D' })], [], jevStub({}), [], NOW);
  await sel.fill();
  sel.drop(leads[0]!.key);
  assert.equal((await sel.replace('major'))!.headline, 'Major Four', 'the capped fourth major fills the freed major slot');
  const sel2 = new Selector([leads[0]!, cand({ headline: 'Builder Spare', builder: 0.7, eventDate: fresh })], [cand({ headline: 'Niche Story Q' })], [], jevStub({}), [], NOW);
  await sel2.fill(); // Major One, Builder Spare, Niche Story Q
  sel2.drop(leads[0]!.key);
  assert.equal(await sel2.replace('major'), null);
});
