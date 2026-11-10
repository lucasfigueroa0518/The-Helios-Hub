/** Stories' shared photo finder adopter (PHASE3-CONTRACT.md Owner B). Offline: the harvest engine is stubbed. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HarvestInput, HarvestResult } from '@/lib/reel-ai-drama/harvest/harvest';
import type { HarvestDeps } from '@/lib/reel-ai-drama/harvest/types';
import type { Asset } from '@/lib/reel-ai-drama/types';
import { PHOTO_PROFILES } from '@/lib/photos/profiles';
import { PHOTO_PROFILE_IDS, type PhotoDeps, type PhotoFinderModes } from '@/lib/photos/types';
import type { BuildDeps, BuildResult } from '@/lib/stories/build/common';
import type { PhotoFinder, PhotoRequest } from '@/lib/stories/photos';
import { createSharedPhotoFinder, sharedPhotoSetup, sharedSeriesBuilders } from '@/lib/stories/photos-shared';
import type { Series } from '@/lib/stories/render/types';

const NOW = new Date('2026-11-10T08:00:00Z');
const noNet = (async () => { throw new Error('no network in tests'); }) as unknown as typeof fetch;

function asset(o: Partial<Asset> & { id: string }): Asset {
  return {
    kind: 'person_photo', file: `media/${o.id}.jpg`, url: `https://img.example/${o.id}.jpg`, source_page: null, credit: 'Reuters', license: null, shows: 'a person',
    people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown', width: 1600, height: 1200, phash: null, character_image: false, made: false, upscaled: false, flags: [], ...o,
  };
}

/** A stub engine: the n-th call returns `byCall[n]` (default nothing), spending `usd` each (at most its allowance). */
function engine(byCall: Asset[][], usd = 0.04) {
  const calls: HarvestInput[] = [];
  const run = async (d: HarvestDeps, input: HarvestInput): Promise<HarvestResult> => {
    const assets = byCall[calls.length] ?? [];
    calls.push(input);
    // The engine keeps to the allowance it is given.
    return { inventory: { assets, usable_count: assets.length, counts: {}, kill: null, usd: Math.min(usd, d.capUsd ?? usd) }, rejected: [], notes: [], wants: [], cast: [] };
  };
  return { run, calls };
}

function deps(run: PhotoDeps['run']): PhotoDeps {
  return { harvest: { http: noNet, create: null, loadPrompt: () => '', serperKey: null, photoBank: null, cutouts: [] }, run, now: () => NOW };
}

/** Today's finder stub: records what it was asked, fills every frame. */
function fallback(usd = 0.01) {
  const sets: PhotoRequest[][] = [];
  const finds: PhotoRequest[] = [];
  let spent = 0;
  const photos: PhotoFinder = {
    get usd() { return spent; },
    size: async () => ({ width: 2000, height: 2000 }) as never,
    find: async (req) => { finds.push(req); spent += usd; return { src: `https://old/${encodeURIComponent(req.query)}.jpg`, credit: 'Old', kind: 'scene' }; },
    findSet: async (reqs, trace) => {
      sets.push(reqs);
      spent += usd;
      trace?.push(...reqs.map((r) => [`old: ${r.query}`]));
      return reqs.map((r) => ({ src: `https://old/${encodeURIComponent(r.query)}.jpg`, credit: 'Old', kind: 'scene' as const }));
    },
  };
  return { photos, sets, finds };
}

const held = new Set(['https://used/recent.jpg']);
const req = (query: string, o: Partial<PhotoRequest> = {}): PhotoRequest => ({
  kind: 'person', query, subjects: [{ name: query, type: 'person' }], storyDate: '2026-11-09', sourceUrls: ['https://news.example/a'], exclude: held, ...o,
});

test('shared hit: every frame filled by the shared finder; today\'s finder is never asked; usd adds the shared spend', async () => {
  const e = engine([[asset({ id: 'A', people: ['Ann Lee'] })], [asset({ id: 'B', people: ['Bo Park'] })]]);
  const f = fallback();
  const finder = createSharedPhotoFinder({ profile: PHOTO_PROFILES.md, deps: deps(e.run), fallback: f.photos });
  const trace: string[][] = [];
  const got = await finder.findSet!([req('Ann Lee'), req('Bo Park')], trace);
  assert.deepEqual(got.map((p) => p?.src), ['https://img.example/A.jpg', 'https://img.example/B.jpg']);
  assert.equal(f.sets.length, 0);
  assert.equal(e.calls.length, 2, 'one harvest per frame, serial');
  assert.ok(trace.every((t) => t.length > 0 && t.every((s) => s.startsWith('shared:'))));
  assert.ok(Math.abs(finder.usd - 0.08) < 1e-9);
  assert.ok(Math.abs(finder.sharedUsd - 0.08) < 1e-9);
  assert.equal(finder.size, f.photos.size, 'size is today\'s probe');
});

test('shared miss: only the empty frames go to today\'s finder, in order, the cover still the cover, exclude extended by the shared picks', async () => {
  // Frame 0 (cover) and frame 2 find nothing; frame 1 gets B.
  const e = engine([[], [asset({ id: 'B', people: ['Bo Park'] })], []]);
  const f = fallback();
  const finder = createSharedPhotoFinder({ profile: PHOTO_PROFILES.md, deps: deps(e.run), fallback: f.photos });
  const trace: string[][] = [];
  const reqs = [req('Ann Lee', { cover: true }), req('Bo Park'), req('Cy Diaz')];
  const got = await finder.findSet!(reqs, trace);
  assert.deepEqual(got.map((p) => p?.src), ['https://old/Ann%20Lee.jpg', 'https://img.example/B.jpg', 'https://old/Cy%20Diaz.jpg']);
  assert.equal(f.sets.length, 1);
  const sent = f.sets[0]!;
  assert.deepEqual(sent.map((r) => r.query), ['Ann Lee', 'Cy Diaz']);
  assert.equal(sent[0]!.cover, true);
  assert.equal(sent[1]!.cover, undefined);
  for (const r of sent) {
    assert.ok(r.exclude.has('https://img.example/B.jpg'), 'never a photo the shared finder put in this set');
    assert.ok(r.exclude.has('https://used/recent.jpg'));
  }
  assert.equal(held.size, 1, 'the caller\'s exclude set is not mutated');
  // Traces: the shared steps first, then today's.
  assert.equal(trace.length, 3);
  assert.ok(trace[0]![0]!.startsWith('shared:'));
  assert.equal(trace[0]!.at(-1), 'old: Ann Lee');
  assert.ok(trace[1]!.every((s) => s.startsWith('shared:')));
  assert.equal(trace[2]!.at(-1), 'old: Cy Diaz');
  assert.ok(Math.abs(finder.usd - (0.12 + 0.01)) < 1e-9, 'usd = today\'s + the shared spend');
});

test('cap spent: a post whose budget is gone sends every frame to today\'s finder without calling the harvest', async () => {
  const e = engine([[asset({ id: 'A' })]]);
  const f = fallback();
  const budget = { usd: 0.3, capUsd: 0.3 };
  const finder = createSharedPhotoFinder({ profile: PHOTO_PROFILES.gtn, deps: deps(e.run), fallback: f.photos, budget });
  const trace: string[][] = [];
  const got = await finder.findSet!([req('Ann Lee'), req('Bo Park')], trace);
  assert.equal(e.calls.length, 0);
  assert.deepEqual(got.map((p) => p?.src), ['https://old/Ann%20Lee.jpg', 'https://old/Bo%20Park.jpg']);
  assert.ok(trace.every((t) => t[0]!.includes('cap is spent')));
  // find(): same rule for one request.
  const one = await finder.find(req('Cy Diaz'));
  assert.equal(one?.src, 'https://old/Cy%20Diaz.jpg');
  assert.equal(f.finds.length, 1);
  assert.equal(finder.sharedUsd, 0);
});

test('find: a shared hit returns it; a miss asks today\'s finder with the same request; a passed budget is shared across finds', async () => {
  const e = engine([[asset({ id: 'A', people: ['Ann Lee'] })], []], 0.2);
  const f = fallback();
  const budget = { usd: 0, capUsd: 0.3 };
  const finder = createSharedPhotoFinder({ profile: PHOTO_PROFILES.gtn, deps: deps(e.run), fallback: f.photos, budget });
  assert.equal((await finder.find(req('Ann Lee')))?.src, 'https://img.example/A.jpg');
  assert.equal(f.finds.length, 0);
  const r = req('Bo Park');
  assert.equal((await finder.find(r))?.src, 'https://old/Bo%20Park.jpg');
  assert.equal(f.finds[0], r);
  assert.ok(Math.abs(budget.usd - 0.285) < 1e-9, 'the second find ran on what the first left (less the look headroom)');
  assert.ok(budget.usd <= budget.capUsd + 1e-9);
});

test('a shared finder that throws never throws to its caller: the frames go to today\'s finder, the reason in the trace', async () => {
  const f = fallback();
  const finder = createSharedPhotoFinder({ profile: PHOTO_PROFILES.md, deps: deps(undefined), fallback: f.photos, find: async () => { throw new Error('boom'); } });
  const trace: string[][] = [];
  const got = await finder.findSet!([req('Ann Lee')], trace);
  assert.equal(got[0]?.src, 'https://old/Ann%20Lee.jpg');
  assert.deepEqual(trace[0], ['shared: failed: boom', 'old: Ann Lee']);
  const onSpend: number[] = [];
  const g = createSharedPhotoFinder({ profile: PHOTO_PROFILES.md, deps: deps(engine([[]], 0.05).run), fallback: f.photos, onSpend: (u) => onSpend.push(u) });
  await g.find(req('Bo Park'));
  assert.deepEqual(onSpend, [0.05], 'the revision meter hears the shared spend');
});

/* ── the worker's per-series wiring ─────────────────────────────────────────────────────────── */

const allLegacy = (): PhotoFinderModes => Object.fromEntries(PHOTO_PROFILE_IDS.map((id) => [id, 'legacy'])) as PhotoFinderModes;
const noQuery = { query: async () => { throw new Error('the stub readModes is used'); } };

function stubBuilders() {
  const seen: Array<{ series: Series; photos: PhotoFinder }> = [];
  const mk = (series: Series) => async (d: BuildDeps): Promise<BuildResult> => {
    seen.push({ series, photos: d.photos });
    await d.photos.find(req('Ann Lee'));
    await d.photos.find(req('Bo Park'));
    return { ok: false, skip: 'stub', candidates: [] };
  };
  return { seen, builders: { morning_download: mk('morning_download'), ai_trivia: mk('ai_trivia'), free_vs_paid: mk('free_vs_paid') } };
}

test('legacy (default, garbage, or a read error): no wrapped builders, and the shared deps are never built', async () => {
  let built = 0;
  const make = (readModes: () => Promise<PhotoFinderModes>) => ({ readModes, deps: async () => { built += 1; return deps(undefined); }, profiles: PHOTO_PROFILES });
  const { builders } = stubBuilders();
  assert.equal(await sharedSeriesBuilders({ query: noQuery, builders, make: make(async () => allLegacy()) }), undefined);
  assert.equal(await sharedSeriesBuilders({ query: noQuery, builders, make: make(async () => { throw new Error('no table'); }) }), undefined);
  assert.equal(await sharedSeriesBuilders({ query: noQuery, builders, make: make(async () => ({ md: 'yes' }) as unknown as PhotoFinderModes) }), undefined);
  assert.equal(built, 0);
  // Owner A's real switch over a database that errors: legacy too.
  assert.equal(await sharedSeriesBuilders({ query: noQuery, builders, make: { deps: async () => { built += 1; return deps(undefined); } } }), undefined);
  assert.equal(built, 0);
  assert.equal(await sharedPhotoSetup(noQuery, 'lfd'), null);
});

test('shared for one series: only that series is wrapped, its finds share one per-build budget, the shared spend is the set\'s cost row', async () => {
  const e = engine([[asset({ id: 'A', people: ['Ann Lee'] })], []], 0.05);
  const costs: Array<{ setId: string; usd: number }> = [];
  const { seen, builders } = stubBuilders();
  const wrapped = await sharedSeriesBuilders({
    query: noQuery,
    builders,
    recordCost: async (d, usd) => { costs.push({ setId: d.setId, usd }); },
    make: { readModes: async () => ({ ...allLegacy(), gtn: 'shared' }), profiles: PHOTO_PROFILES, deps: async () => deps(e.run) },
  });
  assert.deepEqual(Object.keys(wrapped ?? {}), ['ai_trivia'], 'MD and FvP keep today\'s builder (no key)');
  const today = fallback();
  const d = { photos: today.photos, setId: 'set-1' } as unknown as BuildDeps;
  await wrapped!.ai_trivia!(d);
  assert.equal(seen[0]!.series, 'ai_trivia');
  assert.notEqual(seen[0]!.photos, today.photos, 'the build sees the shared finder in front');
  assert.equal(e.calls.length, 2);
  assert.equal(today.finds.length, 1, 'only the shared miss went to today\'s finder');
  assert.equal(costs.length, 1);
  assert.equal(costs[0]!.setId, 'set-1');
  assert.ok(Math.abs(costs[0]!.usd - 0.1) < 1e-9);
  assert.ok(Math.abs(seen[0]!.photos.usd - (today.photos.usd + 0.1)) < 1e-9, 'the build\'s photo usd covers both');
});

test('review fix 3: single find calls split the post budget across the frames to come (GTN/FvP: 2 frames)', async () => {
  const caps: number[] = [];
  const run = async (d: HarvestDeps): Promise<HarvestResult> => {
    caps.push(d.capUsd ?? 0);
    return { inventory: { assets: [], usable_count: 0, counts: {}, kill: null, usd: d.capUsd ?? 0 }, rejected: [], notes: [], wants: [], cast: [] };
  };
  const budget = { usd: 0, capUsd: 0.3 };
  const f = fallback();
  const finder = createSharedPhotoFinder({ profile: PHOTO_PROFILES.gtn, deps: deps(run), fallback: f.photos, budget, frames: 2 });
  await finder.find(req('question'));
  await finder.find(req('answer'));
  assert.equal(caps.length, 2, 'both frames reach the shared finder');
  // Frame 1 gets half of $0.30 (minus the look headroom); frame 2 gets what is left.
  assert.ok(Math.abs(caps[0]! - (0.15 - 0.015)) < 1e-9, `frame 1 cap ${caps[0]}`);
  assert.ok(caps[1]! > 0.1, `frame 2 still has money (${caps[1]})`);
  assert.ok(budget.usd <= 0.3 + 1e-9, `post total ${budget.usd}`);
});
