/**
 * Carousels and the shared photo finder (central intake Phase 3, CI-30): in 'shared' mode the design stage fills
 * slots from lib/photos first, today's finder fills the rest with the shared picks excluded, and legacy mode is
 * byte-identical. The revision's shared step likewise. Offline: findPhotos is a stub, the needs mapper is the real
 * (pure) one, and today's finder runs on the photo fixtures' fake web, stub Jev, tags and close-up checks.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce, TC_URL } from '@/fixtures/social/briefs';
import { sifDraft } from '@/fixtures/social/drafts';
import { createFakeHttp, SIF_WEB } from '@/fixtures/social/photo-http';
import { fitOkFor } from '@/fixtures/social/render-text';
import type { findPhotos } from '@/lib/photos/find';
import { PHOTO_PROFILES } from '@/lib/photos/profiles';
import type { PhotoDeps as SharedPhotoDeps, PhotoFinderModes, PhotoNeed } from '@/lib/photos/types';
import { sharedFindPhoto } from '@/lib/revisions/descriptions/carousels-live';
import type { OfferInput, PhotoBank } from '@/lib/media-library/bank';
import type { JevAnswer, JevAsk } from '@/lib/social/jev/client';
import * as PhotoFit from '@/lib/social/jev/questions/photo-fit.v2';
import * as Identity from '@/lib/social/jev/questions/subject-identity.v1';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v5';
import { createDesignStage, type DesignDeps, type SharedPhotoStep } from '@/lib/social/pipeline/design-stage';
import { carouselSharedPhotos } from '@/lib/social/pipeline/live-stages';
import type { Brief as PipelineBrief, Draft, ScoredCandidate } from '@/lib/social/pipeline/types';
import type { TagSheet, TileTag } from '@/lib/social/photos/tag-sheet';
import type { VisionCheck, VisionVerdict } from '@/lib/social/photos/vision';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import { fillDraft } from '@/lib/social/writer/draft';
import type { Photo as SharedPhoto } from '@/lib/stories/render/types';

// ── today's finder, offline (the design-bank test's fixtures) ───────────────
const IDENTITY: Record<string, { person: number; match: (d: string) => number }> = {
  'Donald Trump': { person: 0.98, match: (d) => (d.includes('president') ? 0.96 : 0.02) },
  'Jay Clayton': { person: 0.97, match: (d) => (d.includes('SEC') ? 0.93 : 0.03) },
  Cursor: { person: 0.03, match: () => 0.8 },
};
const jev: JevAsk = async (req, meta) => {
  const answers: Record<string, JevAnswer> = {};
  if (meta.version === Identity.VERSION) {
    const state = req.state as ReturnType<typeof Identity.buildState>;
    const a = IDENTITY[state.subject.name] ?? { person: 0.5, match: () => 0.01 };
    answers.is_person = { noul: a.person };
    state.candidates.forEach((c, k) => (answers[Identity.matchId(k)] = { noul: a.match(c.description) }));
  } else if (meta.version === Prescreen.VERSION) {
    const state = req.state as ReturnType<typeof Prescreen.buildState>;
    state.candidates.forEach((_, k) => {
      answers[Prescreen.fitId(k)] = { noul: 0.9 };
      answers[Prescreen.peopleId(k)] = { noul: 0.05 };
    });
  } else if (meta.version === PhotoFit.VERSION) {
    const state = req.state as ReturnType<typeof PhotoFit.buildState>;
    state.tiles.forEach((_, k) => (answers[PhotoFit.fitId(k)] = { noul: 0.9 }));
  } else {
    for (const id of Object.keys(req.questions)) answers[id] = { noul: id.startsWith('repeats_') ? 0.05 : 0.9 };
  }
  return { answers, usage: { input_tokens: 300, output_tokens: 0 }, model: 'stub-jev' };
};
const verdict: VisionVerdict = { what_it_shows: 'a wall clock on a desk', shows_requested: true, shows_requested_confidence: 0.9, person_prominent: false, landmark_visible: false, story_logo: false, logo_seen: null, named_institution: false, mostly_text_banner: false };

const WH_SRC = 'https://techcrunch.com/wp-content/uploads/2026/09/whitehouse-signing.jpg';
const pages = (): PageReadOk[] => [{
  ok: true, url: TC_URL, resolvedUrl: TC_URL, title: 'Trump unveils', byline: null, publishedTime: '2026-10-04T12:00:00Z', text: 'x', truncated: false,
  photos: [{ src: WH_SRC, caption: 'President Trump signs the order. (Official White House Photo by Daniel Torok)', credit: null, alt: null, from: 'figure', width: 1200 }],
}];

/** Counts today's finder's paid steps (the close-up checks and sheet tags), so a test can see it never ran. */
function designDeps(counts = { vision: 0, tags: 0 }): Omit<DesignDeps, 'bank'> {
  const { http } = createFakeHttp({ ...SIF_WEB, stocksnapCount: { 'wall clock': 2, 'legal documents': 2, 'pen and paper': 2, 'smartphone screen': 2 } });
  const sharpHttp = (async (u: string | URL | Request) => {
    const url = String(u instanceof Request ? u.url : u);
    if (/upload\.wikimedia\.org|stock\.example|techcrunch\.com/.test(url)) {
      const sharp = (await import('sharp')).default;
      return new Response(new Uint8Array(await sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()));
    }
    return http(u as string);
  }) as typeof fetch;
  const vision: VisionCheck = async () => (counts.vision++, { ok: true, pass: true, verdict, costUsd: 0.003 });
  const tagSheet: TagSheet = async (_png, n) => (counts.tags++, { ok: true, costUsd: 0.004, tiles: Array.from({ length: n }, (_, i): TileTag => ({ tile: i + 1, tags: ['wall clock'], person: false, landmark: false, logo: false, named_place: false, text_banner: false })) });
  return { jev, http: sharpHttp, tagSheet, vision, fitCheck: async (post) => fitOkFor(post) };
}

async function runDesign(over: Partial<DesignDeps> = {}, counts?: { vision: number; tags: number }) {
  const parsed = briefSuperIntelligenceForce();
  const submission = sifDraft();
  const draft: Draft = { storyId: 's1', submission, filled: fillDraft(submission, parsed) };
  const brief: PipelineBrief = { storyId: 's1', parsed, raw: '', pages: pages() };
  const story = { id: 's1', title: 't', url: TC_URL, outlets: ['TechCrunch'], publishedAt: new Date('2026-10-04T12:00:00Z') } as ScoredCandidate;
  return createDesignStage({ ...designDeps(counts), now: () => new Date('2026-10-05T03:00:00Z'), ...over })(draft, brief, story);
}

// ── the shared finder, stubbed ──────────────────────────────────────────────
const OPEN = 'Photo: Wikimedia Commons, CC BY-SA 4.0';
const shot = (src: string, credit = OPEN, kind: SharedPhoto['kind'] = 'person'): SharedPhoto => ({ src, credit, kind });
const stubDeps = { harvest: {} as never, now: () => new Date('2026-10-05T03:00:00Z') } as SharedPhotoDeps;

type Calls = { needs: PhotoNeed[]; exclude: ReadonlySet<string> | null; n: number };
/** A findPhotos stub: `bySlot` answers per need id (slot name); each call spends $0.05 of the post budget. */
function stubFind(bySlot: Record<string, SharedPhoto>, calls: Calls): typeof findPhotos {
  return async (needs, _profile, _deps, opts) => {
    calls.n++;
    calls.needs.push(...needs);
    calls.exclude = opts.exclude;
    opts.budget.usd += 0.05;
    return { photos: needs.map((n) => bySlot[n.id] ?? null), traces: needs.map((n) => [`shared: stub ${n.id}`]) };
  };
}
const step = (bySlot: Record<string, SharedPhoto>, calls: Calls): SharedPhotoStep => ({ profile: PHOTO_PROFILES.carousel, deps: stubDeps, find: stubFind(bySlot, calls) });
const newCalls = (): Calls => ({ needs: [], exclude: null, n: 0 });
const urlsOf = (r: Awaited<ReturnType<typeof runDesign>>) => (r.ok ? r.value.photos.map((t) => t.photo?.url ?? null) : []);

test('legacy: a run whose switch resolves to null deep-equals a run with no switch at all, and the shared finder is never called', async () => {
  const plain = await runDesign();
  let asked = 0;
  const legacy = await runDesign({ sharedPhotos: async () => (asked++, null) });
  assert.ok(plain.ok);
  assert.equal(asked, 1);
  assert.deepEqual(legacy, plain);
  // A switch getter that throws is legacy too.
  assert.deepEqual(await runDesign({ sharedPhotos: async () => { throw new Error('settings down'); } }), plain);
});

test('shared fills a slide; the other slots go to today\'s finder with the shared pick excluded and kept', async () => {
  const plain = await runDesign();
  assert.ok(plain.ok);
  // Take a photo today's finder put on an inner slide, and have the shared finder pick it for slide 3 instead.
  const legacy = urlsOf(plain);
  const k = legacy.findIndex((u, i) => i >= 1 && i !== 2 && u);
  assert.ok(k >= 1, 'today\'s finder filled an inner slide');
  const taken = legacy[k]!;
  const calls = newCalls();
  const r = await runDesign({ sharedPhotos: async () => step({ 'slide 3': shot(taken) }, calls) });
  assert.ok(r.ok);
  assert.equal(calls.n, 1, 'one shared call for the post');
  assert.deepEqual(calls.needs.map((n) => n.id), ['cover', 'slide 2', 'slide 3', 'slide 4', 'slide 5', 'slide 6', 'slide 7']);
  assert.ok(calls.needs[0]!.cover, 'the cover need is the cover');
  const traces = r.value.photos;
  assert.equal(traces.length, plain.value.photos.length, 'same shape: cover + every slide');
  assert.equal(traces[2]!.photo?.url, taken, 'slide 3 keeps the shared pick');
  assert.equal(traces[2]!.via, 'article');
  assert.ok(traces[2]!.steps.includes('shared: stub slide 3'));
  assert.equal(urlsOf(r).filter((u) => u === taken).length, 1, 'today\'s finder never reuses the shared pick');
  assert.ok(traces[0]!.photo, 'the cover still gets today\'s photo');
  assert.ok(traces[0]!.steps.some((s) => /^shared: \$0\.0500 of the post's \$0\.30 spent$/.test(s)));
  assert.ok(traces[1]!.steps.some((s) => /shared: no photo → today's finder/.test(s)), 'a miss says it went to today\'s finder');
  assert.ok(r.value.render.slides.some((sl) => sl.photoUrl === taken), 'the shared pick is rendered (so the used-photo log records it)');
});

test('shared fills the cover: today\'s finder fills the slides only, never promotes one to the cover, and the bank keeps render positions', async () => {
  const offers: OfferInput[] = [];
  const bank: PhotoBank = { reader: { mode: async () => 'off' as const, find: async () => [] }, offer: (input) => void offers.push(input), drain: async () => {} };
  const calls = newCalls();
  const cover = 'https://upload.wikimedia.org/shared/cover-trump.jpg';
  const r = await runDesign({ bank, sharedPhotos: async () => step({ cover: shot(cover) }, calls) });
  assert.ok(r.ok);
  assert.equal(r.value.photos[0]!.photo?.url, cover);
  assert.ok(!r.value.photos[0]!.steps.some((s) => /promotion/.test(s)));
  assert.ok(r.value.photos.slice(1).some((t) => t.photo), 'today\'s finder still fills slides');
  assert.ok(!r.value.photos.slice(1).some((t) => t.steps.some((s) => /went to the cover/.test(s))), 'no slide gave its photo to the cover');
  assert.equal(r.value.render.slides[0]!.photoUrl, cover);
  const slides = offers[0]!.items.map((i) => i.slide);
  assert.ok(slides.length && slides.every((n) => n >= 2 && n <= 7), `vetted slides are the post's inner positions (${[...new Set(slides)].join(',')})`);
  for (const t of r.value.photos.slice(1)) {
    if (!t.photo) continue;
    const at = r.value.photos.indexOf(t) + 1;
    assert.ok(offers[0]!.items.some((i) => i.slide === at && i.outcome === 'picked' && i.candidate.url === t.photo!.url), `slide ${at}'s winner offered at its own position`);
  }
});

test('shared fills every slot: today\'s finder never runs, and the shared spend is in the stage\'s cost', async () => {
  const counts = { vision: 0, tags: 0 };
  const calls = newCalls();
  const all = Object.fromEntries(['cover', 'slide 2', 'slide 3', 'slide 4', 'slide 5', 'slide 6', 'slide 7'].map((s, i) => [s, shot(`https://upload.wikimedia.org/shared/${i}.jpg`)]));
  const r = await runDesign({ sharedPhotos: async () => step(all, calls) }, counts);
  assert.ok(r.ok);
  assert.deepEqual(counts, { vision: 0, tags: 0 }, 'no close-up check, no sheet');
  assert.deepEqual(urlsOf(r), Object.values(all).map((p) => p.src));
  assert.ok(r.costUsd >= 0.05 && r.value.costUsd === r.costUsd, `the $0.05 shared spend is counted ($${r.costUsd})`);
});

test('a shared pick that fails C6 (agency credit) or is a logo goes to today\'s finder; a shared photo that fails to load is swapped like any other', async () => {
  const calls = newCalls();
  const r = await runDesign({ sharedPhotos: async () => step({ cover: shot('https://x.example/getty.jpg', 'Getty Images'), 'slide 5': shot('https://x.example/logo.png', OPEN, 'logo') }, calls) });
  assert.ok(r.ok);
  assert.ok(!urlsOf(r).includes('https://x.example/getty.jpg') && !urlsOf(r).includes('https://x.example/logo.png'));
  assert.ok(r.value.photos[0]!.steps.some((s) => /can't be used: C6: rejected credit/.test(s)));
  assert.ok(r.value.photos[4]!.steps.some((s) => /can't be used: a logo/.test(s)));

  const bad = 'https://upload.wikimedia.org/shared/broken.jpg';
  let checks = 0;
  const fitCheck: DesignDeps['fitCheck'] = async (post) => {
    checks++;
    const ok = fitOkFor(post);
    return post.slides.some((sl) => sl.photoUrl === bad) ? { ...ok, ok: false, problems: [`image failed to load: ${bad}`] } : ok;
  };
  const swapped = await runDesign({ fitCheck, sharedPhotos: async () => step({ 'slide 2': shot(bad) }, newCalls()) });
  assert.ok(swapped.ok, 'the post still ships');
  assert.ok(checks >= 2);
  assert.ok(!swapped.value.render.slides.some((sl) => sl.photoUrl === bad));
  assert.ok(swapped.value.checks.photoReplacements.some((x) => /slide 2: image failed to load/.test(x)));
});

test('carouselSharedPhotos: the switch decides, a read error or a deps error means today\'s finder', async () => {
  const q = (value: unknown) => async () => ({ rows: [{ value }] });
  let built = 0;
  const deps = async () => (built++, stubDeps);
  assert.equal(await carouselSharedPhotos({ query: q({ carousel: 'legacy', lfd: 'shared' }), deps }), null);
  assert.equal(await carouselSharedPhotos({ query: async () => ({ rows: [] }), deps }), null);
  assert.equal(await carouselSharedPhotos({ query: async () => { throw new Error('relation "intake.settings" does not exist'); }, deps }), null);
  assert.equal(built, 0, 'no shared deps are built in legacy mode');
  const on = await carouselSharedPhotos({ query: q({ carousel: 'shared' }), deps });
  assert.equal(on?.profile, PHOTO_PROFILES.carousel);
  assert.equal(on?.deps, stubDeps);
  const origError = console.error;
  console.error = () => {};
  try {
    assert.equal(await carouselSharedPhotos({ query: q({ carousel: 'shared' }), deps: async () => { throw new Error('no key'); } }), null);
  } finally {
    console.error = origError;
  }
});

// ── the carousel revision's shared step ─────────────────────────────────────
function meter() {
  let spent = 0;
  return { m: { spend: (usd: number) => void (spent += usd), stopped: () => false, halt: (): never => { throw new Error('halt'); } }, spent: () => spent };
}
const revisionInput = (over: { exclude?: Set<string>; hint?: string } = {}) => {
  const parsed = briefSuperIntelligenceForce();
  return { brief: parsed, filled: fillDraft(sifDraft(), parsed), slide: 3, exclude: over.exclude ?? new Set<string>(), ...(over.hint ? { hint: over.hint } : {}) };
};
const modes = (carousel: 'shared' | 'legacy') => async () => ({ lfd: 'legacy', md: 'legacy', gtn: 'legacy', fvp: 'legacy', carousel }) as PhotoFinderModes;

test('revision: legacy never calls the shared finder; a read error is legacy', async () => {
  const calls = newCalls();
  const { m, spent } = meter();
  assert.equal(await sharedFindPhoto(revisionInput(), m, { modes: modes('legacy'), photoDeps: async () => stubDeps, find: stubFind({ 'slide 3': shot('https://u/x.jpg') }, calls) }), null);
  assert.equal(await sharedFindPhoto(revisionInput(), m, { modes: async () => { throw new Error('db down'); }, photoDeps: async () => stubDeps, find: stubFind({}, calls) }), null);
  assert.equal(calls.n, 0);
  assert.equal(spent(), 0);
});

test('revision: shared hit for the slide (hint as its query), charged to the meter; excluded, logo and C6 failures fall to today\'s search', async () => {
  const calls = newCalls();
  const { m, spent } = meter();
  const hit = await sharedFindPhoto(revisionInput({ hint: 'courthouse steps' }), m, { modes: modes('shared'), photoDeps: async () => stubDeps, find: stubFind({ 'slide 3': shot('https://upload.wikimedia.org/s3.jpg') }, calls) });
  assert.equal(hit?.url, 'https://upload.wikimedia.org/s3.jpg');
  assert.equal(hit?.source, 'article');
  assert.equal(calls.needs.length, 1);
  assert.equal(calls.needs[0]!.id, 'slide 3');
  assert.equal(calls.needs[0]!.query, 'courthouse steps');
  assert.ok(Math.abs(spent() - 0.05) < 1e-9);
  const miss = (p: SharedPhoto, exclude?: Set<string>) => sharedFindPhoto(revisionInput({ exclude }), m, { modes: modes('shared'), photoDeps: async () => stubDeps, find: stubFind({ 'slide 3': p }, newCalls()) });
  assert.equal(await miss(shot('https://u/agency.jpg', 'Reuters')), null);
  assert.equal(await miss(shot('https://u/logo.png', OPEN, 'logo')), null);
  assert.equal(await miss(shot('https://u/used.jpg'), new Set(['https://u/used.jpg'])), null);
  const thrown = await sharedFindPhoto(revisionInput(), m, { modes: modes('shared'), photoDeps: async () => stubDeps, find: async () => { throw new Error('boom'); } });
  assert.equal(thrown, null, 'a throwing shared finder leaves the slide to today\'s search');
});
