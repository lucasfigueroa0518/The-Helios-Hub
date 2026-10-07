/**
 * Sixth round (Tommy, 2026-10-07): the two-tier photo search, ranking, the
 * contact sheet, the fit check, the pick, and Jev's buckets and variants
 * (photo spec §4; slide buckets spec). Offline: Wikidata, Commons and
 * Openverse are a fake; Jev, the Haiku sheet tags and the close-up vision
 * check are stubs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce, TC_URL } from '@/fixtures/social/briefs';
import { sifDraft } from '@/fixtures/social/drafts';
import { commonsUrl, createFakeHttp, SIF_WEB, stockUrl, type FakeWeb } from '@/fixtures/social/photo-http';
import type { JevAsk, JevAnswer } from '@/lib/social/jev/client';
import * as Identity from '@/lib/social/jev/questions/subject-identity.v1';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v4';
import * as PhotoFit from '@/lib/social/jev/questions/photo-fit.v1';
import { articlePhotosFor } from '@/lib/social/photos/article-list';
import { photosForDraft } from '@/lib/social/photos/design';
import { newSearchContext, searchVisual, type Candidate, type PhotoDeps } from '@/lib/social/photos/find';
import { newPickState, pickForSlide, slotAllows, type Scored } from '@/lib/social/photos/pick';
import { compareCandidates, dateMs, rankCandidates } from '@/lib/social/photos/rank';
import { buildSheets, TILES_PER_SHEET } from '@/lib/social/photos/sheet';
import { checkTiles, type TagSheet, type TileTag } from '@/lib/social/photos/tag-sheet';
import type { VisionCheck, VisionVerdict } from '@/lib/social/photos/vision';
import { TEMPLATES, allowedTemplates, type SlideFacts } from '@/lib/social/render/buckets';
import { toRenderPost } from '@/lib/social/render/from-draft';
import { chooseLayout } from '@/lib/social/render/layout';
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import { fillDraft, type VisualRequest } from '@/lib/social/writer/draft';

// ── Stubs ────────────────────────────────────────────────────────────────

const IDENTITY: Record<string, { person: number; match: (d: string) => number }> = {
  'Donald Trump': { person: 0.98, match: (d) => (d.includes('president') ? 0.96 : 0.02) },
  'Jay Clayton': { person: 0.97, match: (d) => (d.includes('SEC') ? 0.93 : 0.03) },
  'Sam Smith': { person: 0.96, match: () => 0.05 },
};

const usage = { input_tokens: 300, output_tokens: 0 };

/** Jev for every set the pipeline asks: identity, pre-screen, fit, layout. `calls` records each set's version. */
function stubJev(calls: string[] = [], choose: (labels: string[], version: string) => string = (l) => l[0]!): JevAsk {
  return async (req, meta) => {
    calls.push(meta.version);
    const answers: Record<string, JevAnswer> = {};
    if (meta.version === Identity.VERSION) {
      const state = req.state as ReturnType<typeof Identity.buildState>;
      const a = IDENTITY[state.subject.name];
      if (!a) throw new Error(`stub: no identity for ${state.subject.name}`);
      answers.is_person = { noul: a.person };
      state.candidates.forEach((c, k) => (answers[Identity.matchId(k)] = { noul: a.match(c.description) }));
    } else if (meta.version === Prescreen.VERSION) {
      const state = req.state as ReturnType<typeof Prescreen.buildState>;
      state.candidates.forEach((c, k) => {
        answers[Prescreen.fitId(k)] = { noul: /off topic/.test(c.title) ? 0.1 : 0.9 };
        answers[Prescreen.peopleId(k)] = { noul: /people|crowd/.test(c.title) ? 0.9 : 0.05 };
      });
    } else if (meta.version === PhotoFit.VERSION) {
      const state = req.state as ReturnType<typeof PhotoFit.buildState>;
      state.tiles.forEach((t, k) => (answers[PhotoFit.fitId(k)] = { noul: t.tags.some((x) => /fruit|blank/.test(x)) ? 0.05 : 0.9 }));
    } else {
      for (const [id, q] of Object.entries(req.questions)) {
        const labels = Object.keys((q as { criteria: Record<string, unknown> }).criteria);
        const pick = choose(labels, meta.version);
        answers[id] = { choice: pick, probabilities: Object.fromEntries(labels.map((l) => [l, l === pick ? 0.8 : 0.2 / Math.max(1, labels.length - 1)])) };
      }
    }
    return { answers, usage, model: 'stub-jev' };
  };
}

const verdict = (over: Partial<VisionVerdict> = {}): VisionVerdict => ({ what_it_shows: 'x', shows_requested: true, shows_requested_confidence: 0.9, person_prominent: false, landmark_visible: false, story_logo: false, logo_seen: null, named_institution: false, mostly_text_banner: false, ...over });
/** Close-up check: passes unless the URL contains a word in `fail`. */
const stubVision = (fail: string[] = [], asked: string[] = []): VisionCheck => async ({ url }) => {
  asked.push(url);
  const bad = fail.some((f) => url.includes(f));
  return { ok: true, pass: !bad, verdict: verdict(bad ? { shows_requested: false } : {}), costUsd: 0.003 };
};
/** Sheet tags: every tile tagged "server racks" unless its number is in `fruit`. */
const stubTags = (fruit: number[] = []): TagSheet => async (_png, n) => ({ ok: true, costUsd: 0.004, tiles: Array.from({ length: n }, (_, i): TileTag => ({ tile: i + 1, tags: fruit.includes(i + 1) ? ['red apple', 'fruit'] : ['server racks'], person: false, landmark: false, logo: false, named_place: false, text_banner: false })) });

const WH_SRC = 'https://techcrunch.com/wp-content/uploads/2026/09/whitehouse-signing.jpg';
const GETTY_SRC = 'https://techcrunch.com/wp-content/uploads/2026/09/GettyImages-2297764008.jpg';
function pages(publishedTime: string | null = '2026-10-04T12:00:00Z'): PageReadOk[] {
  return [{
    ok: true, url: TC_URL, resolvedUrl: TC_URL, title: 'Trump unveils', byline: null, publishedTime, text: 'x', truncated: false,
    photos: [
      { src: GETTY_SRC, caption: null, credit: 'Image Credits:Kevin Dietsch / Staff / Getty Images', alt: null, from: 'figure' },
      { src: WH_SRC, caption: 'President Trump signs the order. (Official White House Photo by Daniel Torok)', credit: null, alt: null, from: 'figure', width: 1200 },
    ],
  }];
}

const web = (over: Partial<FakeWeb> = {}): FakeWeb => ({ ...SIF_WEB, ...over });
function ctxFor(brief: Brief = briefSuperIntelligenceForce(), withPages = true, opts: { recent?: Set<string> } = {}) {
  const kinds = new Map(brief.subjects.map((s) => [s.name, s.type ?? null]));
  const p = withPages ? pages() : [];
  return newSearchContext(brief, p, { photos: articlePhotosFor(brief, p, kinds), kinds, storyDate: '2026-10-04', ...opts });
}
const v = (kind: VisualRequest['kind'], query: string): VisualRequest => ({ kind, query });

// ── Ranking (photo spec §4 step 3) ────────────────────────────────────────

const cand = (over: Partial<Candidate>): Candidate => ({ url: `u${Math.random()}`, credit: 'c', source: 'stock', width: 1000, height: 1000, qid: null, subject: null, lane: 'openverse', date: null, title: '', verified: false, ...over });

test('ranking: dated photos rank above undated ones for people, companies, events and products; the closest date wins', () => {
  const near = cand({ date: '2026-10-01', width: 800 });
  const far = cand({ date: '2024-05-01', width: 4000 });
  const undated = cand({ date: null, width: 6000 });
  assert.deepEqual(rankCandidates([undated, far, near], 'event', '2026-10-04', false), [near, far, undated]);
});

test('ranking: within 12 days (cover: 35) the bigger image wins; thematic, setting and logo always by size', () => {
  const a = cand({ date: '2026-10-01', width: 800, height: 800 });
  const b = cand({ date: '2026-09-22', width: 3000, height: 2000 }); // 9 days apart
  assert.equal(compareCandidates(a, b, 'person', '2026-10-04', false) > 0, true, 'b is bigger, within 12 days');
  const c = cand({ date: '2026-09-05', width: 3000, height: 2000 }); // 26 days from a
  assert.equal(compareCandidates(a, c, 'person', '2026-10-04', false) < 0, true, 'more than 12 days: the closer date');
  assert.equal(compareCandidates(a, c, 'person', '2026-10-04', true) > 0, true, 'a cover: within 35 days, the bigger image');
  const old = cand({ date: '1999-01-01', width: 4000, height: 3000 });
  assert.deepEqual(rankCandidates([a, old], 'thematic', '2026-10-04', false), [old, a], 'thematic: size only');
  assert.equal(dateMs('2026'), Date.UTC(2026, 6, 1), 'a bare year counts as 1 July');
});

// ── Sources and routing (tier 2) ──────────────────────────────────────────

test('person: the verified Wikidata main photo, then article photos whose caption names them; never P180 alone, never by tags', async () => {
  const { http } = createFakeHttp(web());
  const r = await searchVisual(v('person', 'Donald Trump'), ctxFor(), { jev: stubJev(), http }, { tags: ['S1'] });
  assert.deepEqual(r.candidates.map((c) => c.lane).sort(), ['article', 'headshot']);
  assert.ok(r.candidates.every((c) => c.verified));
  assert.equal(r.candidates.find((c) => c.lane === 'headshot')!.url, commonsUrl('Donald Trump official portrait.jpg'));
  assert.ok(!r.candidates.some((c) => c.url === commonsUrl('Trump at rally.jpg')), 'a depicts photo only as a second photo (needs the face detector)');
  assert.equal(r.candidates.find((c) => c.lane === 'article')!.date, '2026-10-04', "an article photo carries its page's date");
  assert.ok(!r.candidates.some((c) => c.url === GETTY_SRC), 'agency photos never make the list');
});

test('person: a failed identity check finds nothing (never another person)', async () => {
  const b = briefSuperIntelligenceForce();
  b.subjects.push({ id: 'S4', name: 'Sam Smith', role: 'AI researcher', type: 'person' });
  const { http } = createFakeHttp(web());
  const r = await searchVisual(v('person', 'Sam Smith'), ctxFor(b, false), { jev: stubJev(), http }, { tags: ['S4'] });
  assert.deepEqual(r.candidates, []);
  assert.equal(r.identity?.ok, false);
});

test('thematic: the StockSnap lane first, then Commons search, then Openverse; the metadata pre-screen drops people; at most 2 kept, biggest first', async () => {
  const { http, calls } = createFakeHttp(web({ stocksnapCount: { 'server racks': 1 }, stockCount: { 'server racks': 3 } }));
  const jevCalls: string[] = [];
  const r = await searchVisual(v('thematic', 'server racks'), ctxFor(), { jev: stubJev(jevCalls), http }, {});
  assert.equal(r.candidates.length, 2);
  assert.equal(r.candidates[0]!.lane, 'stocksnap', 'the StockSnap close-up is the biggest');
  assert.ok(calls.some((c) => /api\.openverse\.org.*source=stocksnap%2Crawpixel/.test(c)), 'the lane searches StockSnap and rawpixel only');
  assert.ok(calls.some((c) => /commons\.wikimedia\.org.*srsearch=server\+racks\+filetype%3Abitmap/.test(c)), 'Commons is searched directly');
  assert.ok(jevCalls.filter((x) => x === Prescreen.VERSION).length >= 2, 'every lane is pre-screened');
});

test('event and product: article photos naming a tagged subject; the bare query never matches a person by name', async () => {
  const { http } = createFakeHttp(web());
  const r = await searchVisual(v('event', 'order signing'), ctxFor(), { jev: stubJev(), http }, { tags: ['S1'] });
  assert.ok(r.candidates.some((c) => c.url === WH_SRC && c.lane === 'article'));
  const untagged = await searchVisual(v('event', 'order signing'), ctxFor(), { jev: stubJev(), http }, { tags: [] });
  assert.ok(!untagged.candidates.some((c) => c.lane === 'article'), 'no tags: no article photo');
});

test('7-day rule: a stock photo used in the last 7 days is out; a headshot on a story slide is exempt; a cover never repeats one', async () => {
  const { http } = createFakeHttp(web({ stockCount: { 'wall clock': 1 } }));
  const recent = new Set([stockUrl('wall clock', 1), commonsUrl('Donald Trump official portrait.jpg')]);
  const stock = await searchVisual(v('thematic', 'wall clock'), ctxFor(briefSuperIntelligenceForce(), false, { recent }), { jev: stubJev(), http }, {});
  assert.deepEqual(stock.candidates, []);
  const story = await searchVisual(v('person', 'Donald Trump'), ctxFor(briefSuperIntelligenceForce(), false, { recent }), { jev: stubJev(), http }, { tags: ['S1'] });
  assert.equal(story.candidates[0]?.lane, 'headshot');
  const cover = await searchVisual(v('person', 'Donald Trump'), ctxFor(briefSuperIntelligenceForce(), false, { recent }), { jev: stubJev(), http }, { tags: ['S1'], cover: true });
  assert.deepEqual(cover.candidates, [], 'the same photo on both covers (fixed case §7)');
});

test('a request the Writer check dropped (empty query) searches nothing', async () => {
  const r = await searchVisual(v('thematic', ''), ctxFor(), { jev: stubJev() }, {});
  assert.deepEqual(r.candidates, []);
});

// ── The sheet, its tags and the fit check (step 4) ────────────────────────

test('sheet: tiles in order, at most 16 per sheet; a photo that does not load is a blank tile, reported', async () => {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 0, b: 0 } } }).png().toBuffer();
  const http = (async (u: string) => (String(u).includes('broken') ? new Response('no', { status: 404 }) : new Response(new Uint8Array(png)))) as unknown as typeof fetch;
  const urls = Array.from({ length: 18 }, (_, i) => (i === 3 ? 'https://x/broken.jpg' : `https://x/${i}.jpg`));
  const sheets = await buildSheets(urls, { http });
  assert.equal(TILES_PER_SHEET, 16);
  assert.deepEqual(sheets.map((s) => s.urls.length), [16, 2]);
  assert.deepEqual(sheets[0]!.urls, urls.slice(0, 16));
  assert.deepEqual(sheets[0]!.failed, [4]);
  const meta = await sharp(sheets[0]!.png).metadata();
  assert.deepEqual([meta.width, meta.height], [1536, 1536]);
});

test('sheet tags: exactly one entry per tile, routed by tile number; a count or order mismatch is an error', () => {
  const t = (tile: number) => ({ tile, tags: ['x'], person: false, landmark: false, logo: false, named_place: false, text_banner: false });
  const ok = checkTiles({ tiles: [t(2), t(1), t(3)] }, 3);
  assert.ok(Array.isArray(ok) && ok.map((x) => x.tile).join() === '1,2,3', 'sorted by tile');
  assert.match(String(checkTiles({ tiles: [t(1), t(2)] }, 3)), /2 tiles tagged, 3 on the sheet/);
  assert.match(String(checkTiles({ tiles: [t(1), t(1), t(2)] }, 3)), /tile 1 tagged twice/);
  assert.match(String(checkTiles({ tiles: [t(1), t(2), t(4)] }, 3)), /out of range: 4/);
});

// ── The pick (step 5) ─────────────────────────────────────────────────────

const scored = (c: Candidate, fit: number | null = 0.9, tags: Partial<TileTag> | null = {}): Scored => ({ cand: c, fit, tags: tags ? { tile: 1, tags: ['x'], person: false, landmark: false, logo: false, named_place: false, text_banner: false, ...tags } : null });

test('pick: the best that passes, then the second, then the fallback request, then the icon; tags that miss the request are out', async () => {
  const a = cand({ url: 'https://s/apple-fruit.jpg', title: 'apple' });
  const b = cand({ url: 'https://s/apple-store.jpg', title: 'store' });
  const f = cand({ url: 'https://s/fallback.jpg', title: 'fallback' });
  const out = await pickForSlide({ slot: { kind: 'story', speaker: null }, requests: [{ request: v('product', 'Apple iPhone'), scored: [scored(a, 0.1), scored(b, 0.9)] }, { request: v('thematic', 'smartphone'), scored: [scored(f)] }] }, newPickState(), { vision: stubVision() }, [], 0.5);
  assert.equal(out.winner?.cand.url, b.url);
  assert.ok(out.steps.some((s) => /don't fit "Apple iPhone"/.test(s)), 'the homonym is caught by the fit check');
  const fb = await pickForSlide({ slot: { kind: 'story', speaker: null }, requests: [{ request: v('product', 'Apple iPhone'), scored: [scored(a, 0.1)] }, { request: v('thematic', 'smartphone'), scored: [scored(f)] }] }, newPickState(), { vision: stubVision() }, [], 0.5);
  assert.equal(fb.winner?.cand.url, f.url);
  assert.deepEqual(fb.request, v('thematic', 'smartphone'));
  const none = await pickForSlide({ slot: { kind: 'quote', speaker: null }, requests: [{ request: v('thematic', 'x'), scored: [] }] }, newPickState(), {}, [], 0.5);
  assert.equal(none.via, 'type-led');
});

test('pick: an unverified winner must pass the close-up check (once per photo per request per post); a flagged verified photo too', async () => {
  const asked: string[] = [];
  const vision = stubVision(['bad'], asked);
  const bad = cand({ url: 'https://s/bad.jpg' });
  const good = cand({ url: 'https://s/good.jpg' });
  const state = newPickState();
  const out = await pickForSlide({ slot: { kind: 'story', speaker: null }, requests: [{ request: v('thematic', 'servers'), scored: [scored(bad), scored(good)] }] }, state, { vision }, [], 0.5);
  assert.equal(out.winner?.cand.url, good.url);
  assert.deepEqual(asked, [bad.url, good.url]);
  state.prev = null;
  await pickForSlide({ slot: { kind: 'story', speaker: null }, requests: [{ request: v('thematic', 'servers'), scored: [scored(bad)] }] }, state, { vision }, [], 0.5);
  assert.equal(asked.length, 2, 'the bad photo is not checked twice');
  const verifiedFlagged = cand({ url: 'https://s/bad-hq.jpg', lane: 'hq', source: 'hq', verified: true });
  const r = await pickForSlide({ slot: { kind: 'story', speaker: null }, requests: [{ request: v('company', 'Acme'), scored: [scored(verifiedFlagged, null, { named_place: true })] }] }, newPickState(), { vision }, [], 0.5);
  assert.equal(r.winner, null, 'flagged → close-up → fails');
});

test('pick: never the previous slide\'s photo; stock never twice in a post; stat slides never a person or logo; quotes never another person', async () => {
  const s = cand({ url: 'https://s/1.jpg' });
  const state = newPickState();
  const first = await pickForSlide({ slot: { kind: 'story', speaker: null }, requests: [{ request: v('thematic', 'x'), scored: [scored(s)] }] }, state, {}, [], 0.5);
  assert.equal(first.winner?.cand.url, s.url);
  const again = await pickForSlide({ slot: { kind: 'story', speaker: null }, requests: [{ request: v('thematic', 'x'), scored: [scored(s)] }] }, state, {}, [], 0.5);
  assert.equal(again.winner, null);
  state.prev = 'other';
  const later = await pickForSlide({ slot: { kind: 'story', speaker: null }, requests: [{ request: v('thematic', 'x'), scored: [scored(s)] }] }, state, {}, [], 0.5);
  assert.equal(later.winner, null, 'stock is never reused within a post');
  const head = cand({ lane: 'headshot', source: 'commons', verified: true, subject: 'Jane Doe' });
  const logoC = cand({ lane: 'logo', source: 'logo', verified: true });
  assert.equal(slotAllows({ kind: 'stat', speaker: null }, head), false);
  assert.equal(slotAllows({ kind: 'stat', speaker: null }, logoC), false);
  assert.equal(slotAllows({ kind: 'quote', speaker: 'Jane Doe' }, head), true);
  assert.equal(slotAllows({ kind: 'quote', speaker: 'Someone Else' }, head), false);
  assert.equal(slotAllows({ kind: 'cover', speaker: null }, logoC), true);
});

// ── The whole post (photosForDraft) ───────────────────────────────────────

function deps(over: Partial<PhotoDeps> = {}, w: Partial<FakeWeb> = {}, jevCalls: string[] = []): PhotoDeps {
  const { http } = createFakeHttp(web({ stocksnapCount: { 'wall clock': 2, 'legal documents': 2, 'pen and paper': 2, 'smartphone screen': 2 }, ...w }));
  const sharpHttp = (async (u: string | URL | Request) => {
    const url = String(u instanceof Request ? u.url : u);
    if (/upload\.wikimedia\.org|stock\.example|techcrunch\.com/.test(url)) {
      const sharp = (await import('sharp')).default;
      return new Response(new Uint8Array(await sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()));
    }
    return http(u as string);
  }) as typeof fetch;
  return { jev: stubJev(jevCalls), http: sharpHttp, tagSheet: stubTags(), vision: stubVision(), ...over };
}

test('photosForDraft: every request searched, one sheet tagged, every slide picked; tags travel with the winner; costs reported', async () => {
  const brief = briefSuperIntelligenceForce();
  const draft = fillDraft(sifDraft(), brief);
  let sheets = 0;
  const tagSheet: TagSheet = async (png, n) => { sheets++; return stubTags()(png, n); };
  const p = await photosForDraft(draft, brief, pages(), deps({ tagSheet }), { storyDate: '2026-10-04' });
  assert.ok(sheets >= 1);
  const all = [p.cover, ...p.slides];
  assert.equal(all.length, 7);
  assert.equal(p.cover.via, 'article', "the cover asks for Trump: the dated news photo of him (the story's day) outranks his undated portrait");
  assert.equal(p.cover.photo?.url, WH_SRC);
  assert.equal(p.slides[1]!.photo?.url, commonsUrl('Jay Clayton SEC.jpg'), 'Clayton the SEC chairman, never the basketball player');
  assert.equal(p.slides[2]!.via, 'headshot', "the quote slide: its speaker's headshot (by speaker ID)");
  assert.equal(p.slides[3]!.photo?.source, 'stock', 'the stat slide: its scene');
  assert.deepEqual(p.slides[3]!.tags, ['server racks']);
  all.slice(1).forEach((t, i) => assert.ok(!t.photo || t.photo.url !== all[i]!.photo?.url, `slides ${i + 1} and ${i + 2} differ`));
  assert.ok(p.costUsd.tags > 0 && p.costUsd.vision > 0);
});

test('photosForDraft: every online source failing → every slide still gets its icon (or a type-led quote)', async () => {
  const brief = briefSuperIntelligenceForce();
  const draft = fillDraft(sifDraft(), brief);
  const offline = { jev: stubJev(), http: (async () => { throw new Error('offline'); }) as unknown as typeof fetch };
  const p = await photosForDraft(draft, brief, [], offline);
  for (const t of [p.cover, ...p.slides]) {
    assert.ok(t.via === 'icon' || t.via === 'type-led', `${t.request.query}: ${t.via}`);
    assert.equal(t.photo, null);
  }
});

// ── Buckets and variants (slide buckets spec) ─────────────────────────────

const facts = (over: Partial<SlideFacts>): SlideFacts => ({ bucket: 'story', photo: 'scene', speakerPhoto: false, wide: false, sharpBleed: true, sharpBackdrop: true, headlineChars: 40, bodyChars: 120, quoteChars: 0, ...over });

test('variants: code keeps those the slide can take and the post has not used', () => {
  const ids = (f: SlideFacts, used: string[] = []) => allowedTemplates(f, new Set(used as never)).map((t) => t.id);
  assert.deepEqual(ids(facts({})), ['story-photo-below', 'story-photo-top', 'story-full-bleed', 'story-landing']);
  assert.deepEqual(ids(facts({ photo: 'person' })), ['story-photo-below', 'story-photo-top', 'story-landing'], 'a person photo never full bleed unless framed');
  assert.deepEqual(ids(facts({ photo: 'none' })), ['story-landing', 'story-text-top', 'story-text-low']);
  assert.deepEqual(ids(facts({ bodyChars: 220 }), ['story-photo-below']), ['story-photo-top'], 'long copy: no full bleed, no landing; used ones are out');
  assert.deepEqual(ids(facts({ bucket: 'stat', photo: 'person' })), ['stat-plain'], 'a person never behind a number');
  assert.deepEqual(ids(facts({ bucket: 'quote', speakerPhoto: true, photo: 'person' })), ['quote-speaker']);
  assert.ok(TEMPLATES.every((t) => t.look.length > 10), 'every variant tells Jev how it looks');
});

test('layout: exactly one spread when a text pair has a wide scene; Jev picks among several; each variant used once, then the least recently used', async () => {
  const brief = briefSuperIntelligenceForce();
  const draft = fillDraft(sifDraft(), brief);
  const wide = (url: string) => ({ url, credit: 'A, CC BY · via flickr', source: 'stock' as const, width: 3000, height: 1800, qid: null, subject: null });
  const trace = (photo: ReturnType<typeof wide> | null) => ({ request: v('thematic', 'x'), photo, via: photo ? ('openverse' as const) : ('icon' as const), icon: 'clock', identity: null, steps: [], alternates: [] });
  // Slides 5 and 6 (draft indexes 4, 5) are neighbouring text slides; slide 5's photo is wide.
  const photos = { cover: trace(null), slides: draft.slides.map((_, i) => trace(i === 4 ? wide(`https://s/w${i}.jpg`) : null)) };
  const calls: string[] = [];
  const layout = await chooseLayout(draft, photos, stubJev(calls));
  assert.equal(layout.spreadAt, 4, 'the one qualifying pair: slides 6–7');
  assert.equal(layout.templates[5], layout.templates[6], 'both halves share one variant');
  assert.ok(layout.templates[5]!.startsWith('spread-'));
  assert.ok(calls.includes('slide-variant@1'), 'Jev picks the variant when 2+ remain');
  const post = toRenderPost(draft, { cover: null, slides: photos.slides.map((t) => t.photo) }, { source: 's', sourceUrl: 'u', publishedAt: 'p' }, layout);
  assert.deepEqual([post.slides[5]!.panoramaSide, post.slides[6]!.panoramaSide], ['left', 'right']);
  assert.ok(post.slides.slice(0, -1).every((s) => s.template), 'every slide carries its template');
  // No variant repeats until the bucket runs out.
  const storyTemplates = layout.templates.filter((t) => t.startsWith('story-'));
  assert.equal(new Set(storyTemplates).size, storyTemplates.length);
});

test('layout: two qualifying pairs → Jev picks the spread (slide-bucket@1); none → no spread, logged', async () => {
  const brief = briefSuperIntelligenceForce();
  const d = sifDraft();
  d.slides[2]!.type = 'text'; d.slides[2]!.quote_id = null; d.slides[2]!.quote_excerpt = null; d.slides[2]!.body = { text: 'A short line.', facts: ['F1'] };
  const draft = fillDraft(d, brief);
  const wide = (url: string) => ({ url, credit: 'A, CC BY · via flickr', source: 'stock' as const, width: 3000, height: 1800, qid: null, subject: null });
  const trace = (photo: ReturnType<typeof wide> | null) => ({ request: v('thematic', 'x'), photo, via: photo ? ('openverse' as const) : ('icon' as const), icon: 'clock', identity: null, steps: [], alternates: [] });
  const photos = { cover: trace(null), slides: draft.slides.map((_, i) => trace(i === 1 || i === 4 ? wide(`https://s/w${i}.jpg`) : null)) };
  const calls: string[] = [];
  const layout = await chooseLayout(draft, photos, stubJev(calls, (labels, version) => (version === 'slide-bucket@1' ? labels[1]! : labels[0]!)));
  assert.ok(calls.includes('slide-bucket@1'));
  assert.equal(layout.spreadAt, 4, 'Jev picked the second pair');
  const none = await chooseLayout(draft, { cover: trace(null), slides: draft.slides.map(() => trace(null)) }, stubJev());
  assert.equal(none.spreadAt, null);
  assert.ok(none.log.some((l) => /spread: none/.test(l)));
});

test('a Commons search photo is a scene (stat backdrop, full bleed, spreads) and, like every searched scene, never repeats in a post', async () => {
  const { photoKindOf } = await import('@/lib/social/render/from-draft');
  const c = cand({ url: 'https://upload.wikimedia.org/racks.jpg', source: 'commons-search', lane: 'commons-search' });
  assert.equal(photoKindOf(c), 'scene');
  const state = newPickState();
  const first = await pickForSlide({ slot: { kind: 'stat', speaker: null }, requests: [{ request: v('thematic', 'server racks'), scored: [scored(c)] }] }, state, {}, [], 0.5);
  assert.equal(first.winner?.cand.url, c.url);
  state.prev = 'something else';
  const later = await pickForSlide({ slot: { kind: 'story', speaker: null }, requests: [{ request: v('thematic', 'server racks'), scored: [scored(c)] }] }, state, {}, [], 0.5);
  assert.equal(later.winner, null);
});

// ── Adaptive framing (premium polish, 2026-10-07) ─────────────────────────

import { BLEED_MAX_UPSCALE, SHARP_UPSCALE, coverScale, fillsSharp, matteBox, panelTreatment } from '@/lib/social/render/framing';

test('framing: a photo fills a panel only when sharp and mostly kept; small or far-off shapes get a matte, never enlarged past 1.25×', () => {
  const panel = { w: 888, h: 500 };
  assert.equal(panelTreatment({ w: 3000, h: 1800 }, panel), 'fill', 'big, close shape');
  assert.equal(panelTreatment({ w: 683, h: 1024 }, panel), 'matte', 'a small portrait in a landscape panel');
  assert.equal(panelTreatment({ w: 600, h: 340 }, panel), 'matte', 'right shape, too small: 1.48× would pixelate');
  assert.equal(panelTreatment(null, panel), 'matte', 'unknown size: never risk blowing it up');
  const box = matteBox({ w: 400, h: 600 }, panel);
  assert.ok(box.w <= 400 * SHARP_UPSCALE && box.h <= 420, JSON.stringify(box));
});

test('framing: full bleed and spreads only within 1.5× enlargement; a small scene cover is framed, not blown up', () => {
  assert.equal(fillsSharp({ w: 1024, h: 683 }, { w: 1080, h: 1350 }), false, `${coverScale({ w: 1024, h: 683 }, { w: 1080, h: 1350 }).toFixed(2)}× > ${BLEED_MAX_UPSCALE}`);
  assert.equal(fillsSharp({ w: 3600, h: 2400 }, { w: 1080, h: 1350 }), true);
  assert.equal(fillsSharp({ w: 3600, h: 2400 }, { w: 2160, h: 1350 }), true, 'a big 3:2 photo spreads');
  const ids = (f: SlideFacts) => allowedTemplates(f, new Set()).map((t) => t.id);
  assert.deepEqual(ids(facts({ bucket: 'cover', sharpBleed: false })), ['cover-split'], 'a small scene: the framed split cover');
  assert.ok(!ids(facts({ sharpBleed: false })).includes('story-full-bleed'));
  assert.deepEqual(ids(facts({ bucket: 'stat', sharpBackdrop: false })), ['stat-plain'], 'too small even for a darkened backdrop');
});
