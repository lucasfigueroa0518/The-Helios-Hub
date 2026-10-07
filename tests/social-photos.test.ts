/**
 * M5 basic photos + M6 render adapter, offline: fake Wikidata / Commons /
 * Openverse (fixtures/social/photo-http.ts) and stubbed Jev. No network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce, TC_URL } from '@/fixtures/social/briefs';
import { sifDraft } from '@/fixtures/social/drafts';
import { commonsUrl, createFakeHttp, SIF_WEB, stockUrl } from '@/fixtures/social/photo-http';
import type { JevAsk } from '@/lib/social/jev/client';
import * as Identity from '@/lib/social/jev/questions/subject-identity.v1';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v2';
import { createDesignStage } from '@/lib/social/pipeline/design-stage';
import type { Brief as PipelineBrief, Draft, ScoredCandidate } from '@/lib/social/pipeline/types';
import { classifyCredit } from '@/lib/social/photos/credit';
import { photosForDraft } from '@/lib/social/photos/design';
import { findPhoto, newPhotoContext, STOCK_MIN_SHORT_SIDE, stockQueries, type Photo } from '@/lib/social/photos/find';
import { checkIdentity } from '@/lib/social/photos/identity';
import { fitOkFor } from '@/fixtures/social/render-text';
import { MAX_PHOTOS_PER_POST, pickStarter, STARTER_SET, starterUrl } from '@/lib/social/photos/starter-set';
import { layoutOf, rotateLayouts } from '@/lib/social/render/layout-rotation';
import type { SlideCopy } from '@/lib/social/render/types';
import { toRenderPost } from '@/lib/social/render/from-draft';
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import { fillDraft, type DraftSubmission } from '@/lib/social/writer/draft';

// ── Stub Jev: answers from the state it is shown ─────────────────────────

type IdentityState = ReturnType<typeof Identity.buildState>;

/** subject name → { person: P(is person), match: description → P(match) }. */
type IdentityAnswers = Record<string, { person: number; match: (description: string) => number }>;

/** Stock pre-screen stub: fits unless the title says "off topic"; people when the title names them. */
function prescreenAnswers(req: { state: unknown }): Record<string, { noul: number }> {
  const state = req.state as ReturnType<typeof Prescreen.buildState>;
  const out: Record<string, { noul: number }> = {};
  state.candidates.forEach((c, k) => {
    out[Prescreen.fitId(k)] = { noul: /off topic/.test(c.title) ? 0.1 : 0.9 };
    out[Prescreen.peopleId(k)] = { noul: /people|soldier|students/.test(`${c.title} ${c.tags.join(' ')}`) ? 0.9 : 0.05 };
    out[Prescreen.landmarkId(k)] = { noul: /Eiffel|Capitol|Times Square/.test(c.title) ? 0.9 : 0.05 };
  });
  return out;
}

function identityJev(answers: IdentityAnswers, calls: string[] = [], prescreens: string[] = []): JevAsk {
  return async (req, meta) => {
    if (meta.version === Prescreen.VERSION) {
      prescreens.push(meta.subjectId);
      return { answers: prescreenAnswers(req), usage: { input_tokens: 300, output_tokens: 0 }, model: 'stub-jev' };
    }
    assert.equal(meta.version, Identity.VERSION);
    calls.push(meta.subjectId);
    const state = req.state as IdentityState;
    const a = answers[state.subject.name];
    if (!a) throw new Error(`stub Jev: no identity answers for ${state.subject.name}`);
    const out: Record<string, { noul: number }> = { is_person: { noul: a.person } };
    state.candidates.forEach((c, k) => { out[Identity.matchId(k)] = { noul: a.match(c.description) }; });
    return { answers: out, usage: { input_tokens: 400, output_tokens: 0 }, model: 'stub-jev' };
  };
}

const SIF_ANSWERS: IdentityAnswers = {
  'Donald Trump': { person: 0.98, match: (d) => (d.includes('president') ? 0.96 : 0.02) },
  'Jay Clayton': { person: 0.97, match: (d) => (d.includes('SEC') ? 0.93 : 0.03) },
  // Jev wrongly accepts the screen cursor; the P31 check must still stop it.
  Cursor: { person: 0.03, match: () => 0.8 },
  'Sam Smith': { person: 0.96, match: () => 0.05 },
};

const GETTY_SRC = 'https://techcrunch.com/wp-content/uploads/2026/09/GettyImages-2297764008.jpg';
const WH_SRC = 'https://techcrunch.com/wp-content/uploads/2026/09/whitehouse-signing.jpg';
const FANJOY_SRC = 'https://techcrunch.com/wp-content/uploads/2026/09/fanjoy.jpg';

function pages(): PageReadOk[] {
  return [{
    ok: true, url: TC_URL, resolvedUrl: TC_URL, title: 'Trump unveils', byline: null, publishedTime: null, text: 'x', truncated: false,
    photos: [
      { src: GETTY_SRC, caption: null, credit: 'Image Credits:Kevin Dietsch / Staff / Getty Images', alt: null, from: 'figure' },
      { src: WH_SRC, caption: 'President Trump signs the order. (Official White House Photo by Daniel Torok)', credit: null, alt: null, from: 'figure' },
      // The page reader filed a credit-only caption as the caption.
      { src: FANJOY_SRC, caption: 'Benjamin Fanjoy/Getty Images', credit: null, alt: null, from: 'figure' },
    ],
  }];
}

function briefWith(extraSubjects: Array<Omit<Brief['subjects'][number], 'id'>> = []): Brief {
  const b = briefSuperIntelligenceForce();
  b.subjects.push(...extraSubjects.map((x, i) => ({ id: `S${b.subjects.length + i + 1}`, ...x })));
  return b;
}

const deps = (jevCalls: string[] = []) => {
  const fake = createFakeHttp(SIF_WEB);
  return { fake, deps: { jev: identityJev(SIF_ANSWERS, jevCalls), http: fake.http } };
};

// ── Credit check ─────────────────────────────────────────────────────────

test('credit: agency credits are rejected wherever they sit', () => {
  const page = TC_URL;
  const orgs = ['OpenAI', 'Google'];
  const v = (caption: string | null, credit: string | null, p: string | null = page) => classifyCredit({ caption, credit, page: p, organizations: orgs }).verdict;
  assert.equal(v(null, 'Image Credits:Kevin Dietsch / Staff / Getty Images'), 'rejected');
  assert.equal(v('Benjamin Fanjoy/Getty Images', null), 'rejected', 'credit-only caption');
  assert.equal(v('Both photos: Kent Nishimura/AFP via Getty Images', null), 'rejected');
  assert.equal(v('Trump speaks. (AP Photo/Evan Vucci)', null), 'rejected');
  assert.equal(v(null, 'REUTERS/Kevin Lamarque'), 'rejected');
  assert.equal(v(null, 'Courtesy of OpenAI / Getty Images'), 'rejected', 'rejection wins');
});

test("credit: the outlet's own staff photos are rejected", () => {
  assert.equal(classifyCredit({ caption: null, credit: 'Photo by Amelia Holowaty Krales / The Verge', page: 'https://www.theverge.com/a/b', organizations: [] }).verdict, 'rejected');
  assert.equal(classifyCredit({ caption: null, credit: 'Image: CNBC', page: 'https://www.cnbc.com/x', organizations: [] }).verdict, 'rejected');
});

test('credit: company, government and open licences are allowed; the rest is unknown', () => {
  const v = (caption: string | null, credit: string | null) => classifyCredit({ caption, credit, page: TC_URL, organizations: ['OpenAI', 'Google'] }).verdict;
  assert.equal(v(null, 'Courtesy of OpenAI'), 'allowed');
  assert.equal(v('The new chip. Photo: Google', null), 'allowed');
  assert.equal(v(null, 'Official White House Photo by Daniel Torok'), 'allowed');
  assert.equal(v(null, 'Gage Skidmore, CC BY-SA 2.0'), 'allowed');
  assert.equal(v(null, 'Photo: John Smith'), 'unknown');
  assert.equal(v(null, null), 'unknown');
  // A caption that only mentions the company isn't a credit.
  assert.equal(v('Sam Altman, OpenAI CEO, at the event', null), 'unknown');
});

// ── Identity check ───────────────────────────────────────────────────────

test('identity: the resolver match is confirmed by Jev and P31', async () => {
  const { deps: d } = deps();
  const r = await checkIdentity({ name: 'Donald Trump', role: 'President of the United States' }, briefWith(), d);
  assert.ok(r.ok);
  assert.equal(r.qid, 'Q22686');
  assert.equal(r.type, 'person');
});

test('identity: Jev picks the right namesake when the resolver cannot decide', async () => {
  const { deps: d } = deps();
  const r = await checkIdentity({ name: 'Jay Clayton', role: 'national intelligence director' }, briefWith(), d);
  assert.ok(r.ok);
  assert.equal(r.qid, 'Q6163829');
});

test('identity: P31 stops a wrong-type entry even when Jev says it matches (Cursor → screen cursor)', async () => {
  const { deps: d } = deps();
  const r = await checkIdentity({ name: 'Cursor', role: 'AI coding company' }, briefWith([{ name: 'Cursor', role: 'AI coding company' }]), d);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /not an organization/);
});

test('identity: a namesake that does not fit the brief fails', async () => {
  const { deps: d } = deps();
  const r = await checkIdentity({ name: 'Sam Smith', role: 'OpenAI researcher' }, briefWith([{ name: 'Sam Smith', role: 'OpenAI researcher' }]), d);
  assert.equal(r.ok, false);
  assert.equal((r as { type: string | null }).type, 'person');
});

// ── Finding photos ───────────────────────────────────────────────────────

test('fixture slides get a photo from the right source', async () => {
  const { deps: d } = deps();
  const draft = fillDraft(sifDraft(), briefWith());
  draft.slides[1]!.image = { kind: 'article', value: WH_SRC };
  const p = await photosForDraft(draft, briefWith(), pages(), d);
  assert.equal(p.cover.photo?.source, 'commons');
  assert.equal(p.cover.photo?.url, commonsUrl('Donald Trump official portrait.jpg'));
  assert.equal(p.cover.photo?.qid, 'Q22686');
  assert.match(p.cover.photo!.credit, /Gage Skidmore, CC BY-SA 4\.0 · Wikimedia Commons/);
  assert.equal(p.slides[0]!.photo?.url, commonsUrl('Jay Clayton SEC.jpg'), 'Clayton the SEC chairman, never the basketball player');
  assert.equal(p.slides[1]!.photo?.source, 'article');
  assert.match(p.slides[1]!.photo!.credit, /Official White House Photo/);
  assert.equal(p.slides[3]!.photo?.source, 'stock');
  assert.equal(p.slides[3]!.photo?.url, stockUrl('wall clock', 1));
});

test('an agency-credited article photo is rejected, including a credit-only caption; the story slide renders text-only', async () => {
  const { deps: d } = deps();
  const ctx = newPhotoContext(briefWith(), pages());
  for (const src of [GETTY_SRC, FANJOY_SRC]) {
    const t = await findPhoto({ kind: 'article', value: src }, ctx, d);
    assert.ok(t.steps.some((s) => /credit rejected: agency/.test(s)));
    assert.equal(t.via, 'text-only');
  }
  const unknown = await findPhoto({ kind: 'article', value: 'https://example.com/not-on-any-page.jpg' }, ctx, d);
  assert.ok(unknown.steps.some((s) => /not found in the pages read/.test(s)));
  assert.equal(unknown.via, 'text-only');
});

test('request first: a rejected article photo never falls back to someone named on the slide', async () => {
  const jevCalls: string[] = [];
  const { deps: d } = deps(jevCalls);
  const t = await findPhoto({ kind: 'article', value: GETTY_SRC }, newPhotoContext(briefWith(), pages()), d, { text: ['Jay Clayton chairs the force.'], speaker: null, slot: 'split' });
  assert.equal(t.via, 'text-only');
  assert.deepEqual(jevCalls, [], 'no identity check: nobody was looked up');
});

test('empty request: the subject named in the slide text is used', async () => {
  const { deps: d } = deps();
  const t = await findPhoto({ kind: 'subject', value: '' }, newPhotoContext(briefWith(), []), d, { text: ['Clayton will chair it'], speaker: null, slot: 'split' });
  assert.ok(t.steps.includes('empty request; subject from slide text: Jay Clayton'));
  assert.equal(t.via, 'subject');
  assert.equal(t.photo?.url, commonsUrl('Jay Clayton SEC.jpg'));
});

test('quote: the round spot only for a subject request naming the speaker; a stock request is a background', async () => {
  const { deps: d } = deps();
  const ctx = newPhotoContext(briefWith(), []);
  const speaker = await findPhoto({ kind: 'subject', value: 'Donald Trump' }, ctx, d, { text: ['His pitch'], speaker: 'Donald Trump', slot: 'quote' });
  assert.equal(speaker.via, 'subject');
  assert.equal(speaker.photo?.subject, 'Donald Trump');
  const scene = await findPhoto({ kind: 'stock', value: 'flag on a pole' }, ctx, d, { text: ['His pitch'], speaker: 'Donald Trump', slot: 'quote' });
  assert.equal(scene.via, 'stock');
});

test('stock: the request, then its first two words, then text-only on a story slide (no neutral scenes)', async () => {
  assert.deepEqual(stockQueries('laptop warning screen'), ['laptop warning screen', 'laptop warning']);
  assert.deepEqual(stockQueries('wall clock'), ['wall clock']);
  const fake = createFakeHttp({ ...SIF_WEB, stockCount: { 'laptop warning screen': 0 } });
  const d = { jev: identityJev(SIF_ANSWERS), http: fake.http };
  const two = await findPhoto({ kind: 'stock', value: 'laptop warning screen' }, newPhotoContext(briefWith(), []), d);
  assert.equal(two.photo?.url, stockUrl('laptop warning', 1));
  const none = createFakeHttp({ ...SIF_WEB, stockCount: { 'nothing here at all': 0, 'nothing here': 0 } });
  const t = await findPhoto({ kind: 'stock', value: 'nothing here at all' }, newPhotoContext(briefWith(), []), { jev: identityJev(SIF_ANSWERS), http: none.http });
  assert.equal(t.via, 'text-only');
  assert.equal(none.calls.filter((c) => c.includes('openverse')).length, 2);
});

test('people photos: Wikidata main image (P18) only, never P180 "depicts"', async () => {
  const { deps: d, fake } = deps();
  const ctx = newPhotoContext(briefWith(), []);
  const first = await findPhoto({ kind: 'subject', value: 'Donald Trump' }, ctx, d);
  assert.equal(first.photo?.url, commonsUrl('Donald Trump official portrait.jpg'));
  const second = await findPhoto({ kind: 'subject', value: 'Donald Trump' }, ctx, d);
  assert.equal(second.via, 'text-only', 'P18 already used; never the P180 rally photo');
  assert.ok(!fake.calls.some((c) => /haswbstatement/.test(decodeURIComponent(c))), 'no depicts search');
});

test('a failed identity check: never another person; a story slide renders text-only', async () => {
  const { deps: d } = deps();
  const brief = briefWith([{ name: 'Sam Smith', role: 'OpenAI researcher' }, { name: 'Cursor', role: 'AI coding company' }]);
  const ctx = newPhotoContext(brief, []);
  for (const name of ['Sam Smith', 'Cursor']) {
    const t = await findPhoto({ kind: 'subject', value: name }, ctx, d);
    assert.equal(t.via, 'text-only', name);
    assert.equal(t.photo, null);
    assert.equal(t.identity?.ok, false);
  }
});

test('every fixture slide gets a photo; each subject is checked once', async () => {
  const jevCalls: string[] = [];
  const { deps: d } = deps(jevCalls);
  const p = await photosForDraft(fillDraft(sifDraft(), briefWith()), briefWith(), pages(), d);
  const all = [p.cover, ...p.slides];
  for (const t of all) assert.ok(t.photo && t.via, `${t.request.kind}: ${t.request.value}`);
  assert.equal(new Set(all.map((t) => t.photo!.url)).size, all.length, 'no repeats');
  assert.deepEqual(jevCalls.sort(), ['Donald Trump', 'Jay Clayton']);
});

test('every online source failing: the cover still gets a starter photo; story slides render text-only', async () => {
  const offline = { jev: identityJev(SIF_ANSWERS), http: (async () => { throw new Error('offline'); }) as unknown as typeof fetch };
  const sub = sifDraft();
  // 8 story slides + cover = the most a post can have.
  sub.slides.push({ ...sub.slides[0]!, image: { kind: 'stock', value: 'extra one' } }, { ...sub.slides[1]!, image: { kind: 'stock', value: 'extra two' } });
  const p = await photosForDraft(fillDraft(sub, briefWith()), briefWith(), [], offline);
  const all = [p.cover, ...p.slides];
  assert.equal(all.length, MAX_PHOTOS_PER_POST);
  assert.equal(p.cover.via, 'starter');
  for (const t of p.slides) {
    assert.equal(t.via, 'text-only', `${t.request.value}`);
    assert.equal(t.photo, null);
  }
});

test('starter set: big enough for a full post, every file on disk, verifiable credit', async () => {
  const { existsSync } = await import('node:fs');
  assert.ok(STARTER_SET.length >= MAX_PHOTOS_PER_POST);
  for (const p of STARTER_SET) {
    assert.ok(existsSync(`public${starterUrl(p.file)}`), p.file);
    assert.match(p.page, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/, p.file);
    assert.ok(['CC0', 'Public domain'].includes(p.license), p.file);
  }
  assert.match(pickStarter(new Set(), { request: 'server room', brief: null })!.photo.credit, /^Rsparks3 \(CC0\) · Wikimedia Commons$/);
});

// ── Render adapter (M6) ──────────────────────────────────────────────────

test('render: every slide type maps to the renderer fields, quotes and numbers exact', () => {
  const brief = briefWith();
  const draft = fillDraft(sifDraft(), brief);
  const photo = { url: 'https://x/p.jpg', credit: 'Jane Doe, CC BY · via flickr', source: 'stock' as const, width: 1, height: 1, qid: null, subject: null };
  const post = toRenderPost(draft, { cover: photo, slides: draft.slides.map((_, i) => (i === 3 ? photo : null)) }, { source: 'TechCrunch', sourceUrl: TC_URL, publishedAt: '2026-10-04T12:00:00Z' });
  assert.equal(post.slides.length, 1 + draft.slides.length + 1);
  assert.equal(post.slides[0]!.layoutVariant, 'cover');
  assert.equal(post.slides[0]!.headline![0]!.text, draft.cover);
  assert.equal(post.slides[0]!.photoCredit, photo.credit);
  const quote = post.slides[3]!;
  assert.equal(quote.layoutVariant, 'quote');
  assert.equal(quote.quoteText![0]!.text, draft.slides[2]!.quote!.text);
  assert.equal(quote.quoteBy, 'Donald Trump');
  const stat = post.slides[4]!;
  assert.equal(stat.layoutVariant, 'stat');
  assert.equal(stat.title![0]!.text, '120 days');
  assert.match(stat.numberNote!, /time the task force has/);
  assert.equal(stat.photoUrl, photo.url);
  assert.equal(post.slides.at(-1)!.layoutVariant, 'follow');
  assert.equal(post.slides.at(-1)!.storySpecificLine, draft.follow);
  assert.equal(post.caption, draft.caption.text);
  assert.equal(post.attributionBlock, `Photos: ${photo.credit}`, 'each credit once');
  assert.ok(post.slides.every((s) => s.altText));
});

test('design stage: photos + render post, Jev identity cost charged', async () => {
  const { deps: d } = deps();
  const parsed = briefWith();
  const submission: DraftSubmission = sifDraft();
  const draft: Draft = { storyId: 's1', submission, filled: fillDraft(submission, parsed) };
  const brief: PipelineBrief = { storyId: 's1', parsed, raw: '', pages: pages() };
  const story = { id: 's1', title: 't', url: TC_URL, outlets: ['TechCrunch'], publishedAt: new Date('2026-10-04T12:00:00Z') } as ScoredCandidate;
  const r = await createDesignStage({ ...d, fitCheck: async (post) => fitOkFor(post) })(draft, brief, story);
  assert.ok(r.ok);
  assert.equal(r.value.photos.length, 1 + submission.slides.length);
  assert.equal(r.value.render.slides[0]!.photoUrl, commonsUrl('Donald Trump official portrait.jpg'));
  assert.equal(r.value.render.source, 'TechCrunch');
  assert.ok(r.costUsd > 0 && r.costUsd < 0.001, `identity cost ${r.costUsd}`);
});

test('preview: a stubbed post renders every slide with its photo and credit', async () => {
  const React = await import('react');
  const { createElement } = React;
  // tsconfig keeps JSX as "preserve" for Next; tsx then compiles it to classic React.createElement.
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SlideTemplate } = await import('@/lib/social/render/SlideTemplate');
  const brief = briefWith();
  const sub = sifDraft();
  sub.slides[5] = { ...sub.slides[5]!, type: 'landing', body: null };
  const draft = fillDraft(sub, brief);
  const photo = (i: number) => ({ url: `/social/stock/p${i}.jpg`, credit: `Credit ${i}`, source: 'stock' as const, width: null, height: null, qid: null, subject: null });
  const post = toRenderPost(draft, { cover: photo(0), slides: draft.slides.map((_, i) => photo(i + 1)) }, { source: 'TechCrunch', sourceUrl: TC_URL, publishedAt: '2026-10-04T12:00:00Z' });
  post.slides.forEach((s, i) => {
    const html = renderToStaticMarkup(createElement(SlideTemplate, { post, position: i }));
    assert.match(html, /data-slide-ready="true"/, `slide ${i}`);
    if (s.layoutVariant === 'follow') return;
    assert.ok(html.includes(`/social/stock/p${i}.jpg`), `slide ${i} (${s.layoutVariant}) shows its photo`);
    assert.ok(html.includes(`Credit ${i}`), `slide ${i} (${s.layoutVariant}) shows its credit`);
  });
});

// ── Layout rotation (spec §5.3) ──────────────────────────────────────────

const textSlide = (n: number, photo = true): SlideCopy => ({
  position: n, layoutVariant: 'text', headline: [{ text: `H${n}`, role: 'narrative' }], body: [{ text: `B${n}`, role: 'narrative' }],
  altText: `H${n}`, ...(photo ? { photoUrl: `/p${n}.jpg`, photoCredit: 'c' } : {}),
});

test('rotation: no 3 consecutive slides share a layout, and no words change', () => {
  const slides: SlideCopy[] = [{ position: 0, layoutVariant: 'cover', altText: 'c', photoUrl: '/c.jpg' }, ...[1, 2, 3, 4, 5, 6].map((n) => textSlide(n))];
  const r = rotateLayouts(slides);
  const layouts = r.slides.map(layoutOf);
  for (let i = 2; i < layouts.length; i++) assert.ok(!(layouts[i] === layouts[i - 1] && layouts[i] === layouts[i - 2]), layouts.join(','));
  assert.ok(r.changes.length > 0);
  r.slides.forEach((s, i) => {
    assert.deepEqual(s.headline, slides[i]!.headline);
    assert.deepEqual(s.body, slides[i]!.body);
    assert.equal(s.photoUrl, slides[i]!.photoUrl);
  });
});

test('rotation: a run it cannot break (three stats) is reported, not forced', () => {
  const stat = (n: number): SlideCopy => ({ position: n, layoutVariant: 'stat', title: [{ text: '1', role: 'narrative' }], altText: 's', photoUrl: `/s${n}.jpg` });
  const r = rotateLayouts([stat(1), stat(2), stat(3)]);
  assert.equal(r.changes.length, 0);
  assert.equal(r.unresolved.length, 1);
});

test('render: a photo-on-top text slide renders', async () => {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SlideTemplate } = await import('@/lib/social/render/SlideTemplate');
  const post = { format: 'carousel', storyType: 'tech', source: 's', sourceUrl: 'u', publishedAt: 'p', issueNumber: 0, caption: 'c',
    slides: [{ position: 0, layoutVariant: 'cover', headline: [{ text: 'X', role: 'narrative' }], altText: 'x' }, { ...textSlide(1), photoPlacement: 'top' }] } as const;
  const html = renderToStaticMarkup(React.createElement(SlideTemplate, { post: post as never, position: 1 }));
  assert.match(html, /helios-text--photo-top/);
});

test('design stage: a render that does not fit is set aside as render-failed', async () => {
  const { deps: d } = deps();
  const parsed = briefWith();
  const submission: DraftSubmission = sifDraft();
  const draft: Draft = { storyId: 's1', submission, filled: fillDraft(submission, parsed) };
  const brief: PipelineBrief = { storyId: 's1', parsed, raw: '', pages: [] };
  const story = { id: 's1', title: 't', url: TC_URL, outlets: ['TechCrunch'], publishedAt: new Date('2026-10-04T12:00:00Z') } as ScoredCandidate;
  const fitCheck = async () => ({ ok: false, problems: [], slideText: [], violations: [{ slide: 5, element: 'div.helios-stat__number', text: '120 days', over: { left: 0, top: 0, right: 0, bottom: 140 } }] });
  const r = await createDesignStage({ ...d, fitCheck })(draft, brief, story);
  assert.equal(r.ok, false);
  assert.equal((r as { reasonCode: string }).reasonCode, 'render-failed');
  assert.match((r as { detail: string }).detail, /slide 5 div\.helios-stat__number/);
});

test('quote slide: the round speaker spot only for a verified photo of the speaker', () => {
  const brief = briefWith();
  const draft = fillDraft(sifDraft(), brief);
  const at = (photo: Photo) => toRenderPost(draft, { cover: null, slides: draft.slides.map((_, i) => (i === 2 ? photo : null)) }, { source: 's', sourceUrl: TC_URL, publishedAt: 'p' }).slides.find((s) => s.layoutVariant === 'quote')!;
  const base = { url: '/x.jpg', credit: 'c', width: 1, height: 1 };
  assert.equal(at({ ...base, source: 'commons', qid: 'Q22686', subject: 'Donald Trump' }).photoIsSpeaker, true);
  assert.equal(at({ ...base, source: 'commons', qid: 'Q6163829', subject: 'Jay Clayton' }).photoIsSpeaker, false, 'someone else');
  assert.equal(at({ ...base, source: 'starter', qid: null, subject: null }).photoIsSpeaker, false, 'a scene');
});

// ── Slots: where the photo is drawn decides the chain (Tommy, 2026-10-06) ──

test('stat background: the stock scene wins; subject and article photos are skipped', async () => {
  const { deps: d } = deps();
  const ctx = newPhotoContext(briefWith(), pages());
  const t = await findPhoto({ kind: 'subject', value: 'Donald Trump' }, ctx, d, { text: ['Trump has 120 days'], speaker: null, slot: 'backdrop' });
  assert.notEqual(t.via, 'subject');
  assert.ok(t.steps.includes('subject photo skipped: the stat background is a scene'));
  const a = await findPhoto({ kind: 'article', value: WH_SRC }, ctx, d, { text: [], speaker: null, slot: 'backdrop' });
  assert.notEqual(a.via, 'article');
  const s = await findPhoto({ kind: 'stock', value: 'wall clock' }, ctx, d, { text: ['Donald Trump'], speaker: null, slot: 'backdrop' });
  assert.equal(s.via, 'stock');
});

test('quote: only the speaker, never another person named on the slide', async () => {
  const { deps: d } = deps();
  const ctx = newPhotoContext(briefWith(), []);
  const t = await findPhoto({ kind: 'subject', value: 'Jay Clayton' }, ctx, d, { text: ['Jay Clayton'], speaker: 'Not In Subjects', slot: 'quote' });
  assert.notEqual(t.via, 'subject');
  assert.equal(t.photo, null, 'no usable speaker photo: text-only');
});

test('stock size: only thumbnails are rejected (short side under 600px)', async () => {
  const seen: number[] = [];
  const stock = async (_q: string, o: { minShortSide: number }) => {
    seen.push(o.minShortSide);
    return [{ url: 'https://s/flickr.jpg', foreignLandingUrl: '', mime: 'image/jpeg', width: 1024, height: 683, license: 'by', creator: 'A', source: 'flickr' }];
  };
  const d = { jev: identityJev(SIF_ANSWERS), stock };
  for (const slot of ['split', 'backdrop'] as const) {
    const t = await findPhoto({ kind: 'stock', value: 'x' }, newPhotoContext(briefWith(), []), d, { text: [], speaker: null, slot });
    assert.equal(t.via, 'stock', slot);
  }
  assert.deepEqual([...new Set(seen)], [STOCK_MIN_SHORT_SIDE]);
  assert.equal(STOCK_MIN_SHORT_SIDE, 600);
});

// ── Stock pre-screen (spec §5A #6) ───────────────────────────────────────

const ov = (title: string, tags: string[] = []) => ({ url: `https://s/${title.replace(/\W+/g, '-')}.jpg`, foreignLandingUrl: '', mime: 'image/jpeg', width: 1024, height: 683, license: 'by', creator: 'A', source: 'flickr', title, tags });

test('pre-screen: a result that likely shows people is skipped for one that fits and shows no one', async () => {
  const prescreens: string[] = [];
  const stock = async () => [ov('server room maintenance', ['soldier']), ov('server room off topic'), ov('server racks')];
  const t = await findPhoto({ kind: 'stock', value: 'server room' }, newPhotoContext(briefWith(), []), { jev: identityJev(SIF_ANSWERS, [], prescreens), stock });
  assert.equal(t.photo?.url, 'https://s/server-racks.jpg');
  assert.deepEqual(prescreens, ['server room']);
  assert.ok(t.steps.some((s) => /pre-screen "server room": .*people 0\.90.*✓/.test(s)), t.steps.join(' | '));
});

test('pre-screen: nothing passes → the two-word search, then text-only on a story slide', async () => {
  const queries: string[] = [];
  const stock = async (q: string) => { queries.push(q); return [ov('students at laptops'), ov('people in a lab')]; };
  const t = await findPhoto({ kind: 'stock', value: 'student laptop campus' }, newPhotoContext(briefWith(), []), { jev: identityJev(SIF_ANSWERS), stock });
  assert.deepEqual(queries, ['student laptop campus', 'student laptop']);
  assert.equal(t.via, 'text-only');
});

// ── M8a layout system ────────────────────────────────────────────────────

import { draftSlides, SPREAD_MIN_ASPECT } from '@/lib/social/render/from-draft';

async function renderSlideHtml(post: Parameters<typeof import('@/lib/social/render/SlideTemplate').SlideTemplate>[0]['post'], i: number) {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SlideTemplate } = await import('@/lib/social/render/SlideTemplate');
  return renderToStaticMarkup(React.createElement(SlideTemplate, { post, position: i }));
}

const basePost = (slides: SlideCopy[]) => ({ format: 'carousel' as const, storyType: 'tech' as const, source: 's', sourceUrl: 'u', publishedAt: 'p', issueNumber: 0, caption: 'c', slides });
const span = (text: string) => [{ text, role: 'narrative' as const }];

test('M8a: the quote layout shows its headline and body; the landing layout shows its body', async () => {
  const quote: SlideCopy = { position: 0, layoutVariant: 'quote', headline: span('His pitch'), body: span('He said it on Sunday.'), quoteText: span('we lead'), quoteBy: 'Trump', altText: 'q' };
  const landing: SlideCopy = { position: 1, layoutVariant: 'landing', headline: span('Pro costs more'), body: span('Google gave no reason.'), altText: 'l' };
  const post = basePost([quote, landing]);
  const q = await renderSlideHtml(post, 0);
  for (const t of ['His pitch', 'He said it on Sunday.', 'we lead', 'Trump']) assert.ok(q.includes(t), t);
  const l = await renderSlideHtml(post, 1);
  assert.ok(l.includes('Google gave no reason.'));
  assert.ok(/data-fit-min/.test(q) && /data-fit-min/.test(l), 'every text block is a fit region');
});

test('M8a rule 3: a subject photo never goes full bleed under text; it renders in its own region', async () => {
  const img: SlideCopy = { position: 0, layoutVariant: 'image', headline: span('H'), altText: 'a', photoUrl: '/p.jpg', photoKind: 'subject' };
  const html = await renderSlideHtml(basePost([img]), 0);
  assert.ok(!html.includes('helios-image'), 'not the full-bleed layout');
  assert.ok(html.includes('helios-split__photo'));
  const cover: SlideCopy = { position: 0, layoutVariant: 'cover', headline: span('H'), altText: 'a', photoUrl: '/p.jpg', photoKind: 'subject' };
  assert.ok((await renderSlideHtml(basePost([cover]), 0)).includes('helios-cover--split'));
  const scene: SlideCopy = { ...cover, photoKind: 'scene' };
  const sceneHtml = await renderSlideHtml(basePost([scene]), 0);
  assert.ok(sceneHtml.includes('helios-cover--bleed') && sceneHtml.includes('data-scrim="gradient"'), 'scene full bleed, on a scrim');
});

test('M8a rule 3 in rotation: a subject photo is never rotated to full bleed', () => {
  const slides: SlideCopy[] = [1, 2, 3].map((n) => ({ ...textSlide(n), photoKind: 'subject' as const }));
  const r = rotateLayouts(slides);
  assert.ok(r.slides.every((s) => layoutOf(s) !== 'full-bleed'), r.changes.join('; '));
});

test('M8a spreads: a wide scene photo spans two slides; a subject or narrow photo falls back to normal slides', () => {
  const b = briefWith();
  const sub = sifDraft();
  sub.slides[0]!.spread_with_next = true;
  const d = fillDraft(sub, b);
  const wide: Photo = { url: '/wide.jpg', credit: 'c, CC0', source: 'starter', width: 3200, height: Math.floor(3200 / SPREAD_MIN_ASPECT), qid: null, subject: null };
  const s1 = draftSlides(d, { cover: null, slides: [wide, null, null, null, null, null] });
  assert.equal(s1[1]!.panoramaSide, 'left');
  assert.equal(s1[2]!.panoramaSide, 'right');
  assert.equal(s1[2]!.photoUrl, '/wide.jpg');
  const narrow = { ...wide, width: 1600, height: 1200 };
  assert.equal(draftSlides(d, { cover: null, slides: [narrow, null, null, null, null, null] })[1]!.panoramaSide, undefined);
  const person = { ...wide, source: 'commons' as const };
  assert.equal(draftSlides(d, { cover: null, slides: [person, null, null, null, null, null] })[1]!.panoramaSide, undefined);
});

// ── M8c: 7-day rule, starter fallback, photo bank ────────────────────────

import { bankMatches, checkBankEntry, pickFromBank, type BankEntry } from '@/lib/social/photos/bank';
import { createInMemoryUsedPhotoLog, NO_REPEAT_DAYS } from '@/lib/social/photos/used-photos';

test('used-photo log: only uses within 7 days count', async () => {
  const log = createInMemoryUsedPhotoLog([
    { url: '/a.jpg', usedAt: '2026-10-01T12:00:00Z', storyId: 's', slide: 1 },
    { url: '/b.jpg', usedAt: '2026-09-28T12:00:00Z', storyId: 's', slide: 1 },
  ]);
  const recent = await log.recent(new Date('2026-10-06T12:00:00Z'));
  assert.equal(NO_REPEAT_DAYS, 7);
  assert.deepEqual([...recent], ['/a.jpg']);
});

test('7-day rule: a photo used in the last 7 days is never picked, from any source', async () => {
  const { deps: d } = deps();
  const recent = new Set([commonsUrl('Donald Trump official portrait.jpg'), stockUrl('wall clock', 1), starterUrl(STARTER_SET[0]!.file)]);
  const ctx = newPhotoContext(briefWith(), [], { recent });
  const trump = await findPhoto({ kind: 'subject', value: 'Donald Trump' }, ctx, d);
  assert.notEqual(trump.photo?.url, commonsUrl('Donald Trump official portrait.jpg'));
  const clock = await findPhoto({ kind: 'stock', value: 'wall clock' }, ctx, d);
  assert.equal(clock.photo?.url, stockUrl('wall clock', 2));
  assert.notEqual(trump.photo?.url, starterUrl(STARTER_SET[0]!.file), 'starter set included');
});

test('starter-pool-exhausted: when every eligible starter photo was used this week, the least recently used one, logged', async () => {
  const offline = { jev: identityJev(SIF_ANSWERS), http: (async () => { throw new Error('offline'); }) as unknown as typeof fetch };
  const recent = new Set(STARTER_SET.map((p) => starterUrl(p.file)));
  const lastUsed = new Map(STARTER_SET.map((p, i) => [starterUrl(p.file), `2026-10-0${(i % 5) + 1}T00:00:00Z`]));
  lastUsed.set(starterUrl(STARTER_SET.find((p) => p.topics.includes('US Congress'))!.file), '2026-09-01T00:00:00Z'); // off-topic: never used, however old
  const t = await findPhoto({ kind: 'stock', value: 'x' }, newPhotoContext(briefWith(), [], { recent, lastUsed }), offline, { text: [], speaker: null, slot: 'split', cover: true });
  assert.equal(t.via, 'starter');
  assert.equal(lastUsed.get(t.photo!.url), '2026-10-01T00:00:00Z');
  assert.ok(t.steps.some((s) => s.startsWith('starter-pool-exhausted')));
});

const entry = (e: Partial<BankEntry>): BankEntry => ({ id: 'e', url: '/social/bank/e.jpg', kind: 'scene', qid: null, event: null, tags: [], credit: 'Courtesy of OpenAI', licence: 'press kit', source: 'x', width: 2000, height: 1300, faces: false, addedAt: '2026-10-06', ...e });

test('bank: person and company photos only for the same Wikidata id; company photos with faces skipped', () => {
  const openai = entry({ id: 'o', url: '/o.jpg', kind: 'company', qid: 'Q21708200' });
  assert.ok(bankMatches(openai, { qid: 'Q21708200' }));
  assert.ok(!bankMatches(openai, { qid: 'Q116758847' }));
  assert.ok(!bankMatches({ ...openai, faces: true }, { qid: 'Q21708200' }), 'company photos never show people');
  assert.ok(!bankMatches(entry({ kind: 'scene', tags: ['openai office'] }), { qid: 'Q21708200' }), 'never by name or tag');
  assert.ok(bankMatches(entry({ kind: 'event', event: 'nyc-hearing' }), { event: 'nyc-hearing' }));
  assert.ok(!bankMatches(entry({ kind: 'event', event: 'nyc-hearing' }), { event: 'other' }));
});

test('bank: scenes by tag; least recently used first; never this post or the last 7 days', () => {
  const a = entry({ id: 'a', url: '/a.jpg', tags: ['server room'] });
  const b = entry({ id: 'b', url: '/b.jpg', tags: ['data center servers'] });
  const lastUsed = new Map([['/a.jpg', '2026-09-20'], ['/b.jpg', '2026-09-25']]);
  assert.equal(pickFromBank([a, b], { scene: 'server racks' }, new Set(), lastUsed)?.id, 'a');
  assert.equal(pickFromBank([a, b], { scene: 'server racks' }, new Set(['/a.jpg']), lastUsed)?.id, 'b');
  assert.equal(pickFromBank([a, b], { scene: 'wall clock' }, new Set(), lastUsed), null);
});

test('bank in the chain: a subject with no usable main image gets its bank photo; credit passes C6', async () => {
  const { deps: d } = deps();
  const b = briefWith([{ name: 'OpenAI', role: 'AI company' }]);
  const web = { ...SIF_WEB, search: { ...SIF_WEB.search, OpenAI: ['Q21708200'] }, entities: { ...SIF_WEB.entities, Q21708200: { id: 'Q21708200', label: 'OpenAI', description: 'American artificial intelligence research organization', human: false, organization: true, files: [] } } };
  const answers = { ...SIF_ANSWERS, OpenAI: { person: 0.02, match: () => 0.95 } };
  const bank = [entry({ id: 'o', url: '/social/bank/openai/office.jpg', kind: 'company', qid: 'Q21708200' })];
  const t = await findPhoto({ kind: 'subject', value: 'OpenAI' }, newPhotoContext(b, [], { bank }), { jev: identityJev(answers), http: createFakeHttp(web).http });
  void d;
  assert.equal(t.via, 'bank');
  assert.equal(t.photo?.url, '/social/bank/openai/office.jpg');
  const { checkPhotoCredit } = await import('@/lib/social/mechanical/checks');
  assert.deepEqual(checkPhotoCredit(t.photo!, 'slide 2', b), []);
});

test('bank seed check: required fields, Wikidata ids, and no faces in company photos', () => {
  assert.deepEqual(checkBankEntry(entry({ kind: 'company', qid: 'Q21708200' })), []);
  assert.match(checkBankEntry(entry({ kind: 'company', qid: null })).join(), /Wikidata id/);
  assert.match(checkBankEntry(entry({ kind: 'company', qid: 'Q1', faces: true })).join(), /shows a face/);
  assert.match(checkBankEntry(entry({ kind: 'scene', tags: [] })).join(), /tags/);
});

// ── Starter set: every photo is story-specific (Tommy, 2026-10-06) ──────

import { briefTopics, pickStarter as pickStarterFn, pickStarterLeastRecent, topicsIn, type StarterTopic } from '@/lib/social/photos/starter-set';

const topicsOf = (url: string) => STARTER_SET.find((s) => starterUrl(s.file) === url)!.topics;

test('starter set: 41 photos, every one tagged with at least one topic', () => {
  assert.equal(STARTER_SET.length, 41);
  assert.ok(STARTER_SET.every((p) => p.topics.length > 0));
  assert.deepEqual(topicsOf(starterUrl('library-bookshelves-in-hove-libr.jpg')), ['Copyright, publishing and training data']);
  assert.deepEqual(topicsOf(starterUrl('empty-lecture-hall-gfp-lecture-hall.jpg')), ['Education']);
  assert.deepEqual(topicsOf(starterUrl('warehouse-fema-37526-florida-logis.jpg')), ['Trade and supply chain']);
});

test('per slide: the IMAGE request first, then the brief\'s main topic, then the AI-compute default (no-topic-match)', () => {
  const b = briefWith();
  b.the_news.text = 'Google raised the price of its Gemini plans.';
  const fromRequest = pickStarterFn(new Set(), { request: 'wind turbines at dusk', brief: b })!;
  assert.equal(fromRequest.match, 'request');
  assert.ok(topicsOf(fromRequest.photo.url).includes('Energy and power'));
  const fromBrief = pickStarterFn(new Set(), { request: 'abstract mood', brief: b })!;
  assert.equal(fromBrief.match, 'brief');
  assert.ok(topicsOf(fromBrief.photo.url).includes('Money, funding and business'));
  const none = briefWith();
  none.the_news.text = 'Trump announced a Super Intelligence Force.';
  const fallback = pickStarterFn(new Set(), { request: 'abstract mood', brief: none })!;
  assert.equal(fallback.match, 'no-topic-match');
  assert.ok(topicsOf(fallback.photo.url).includes('AI compute and data centers'));
});

test('a photo never lands off-topic: a general story never gets a Congress, stock-market or surveillance photo', () => {
  const b = briefWith();
  b.the_news.text = 'Trump announced a Super Intelligence Force.';
  const taken = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const p = pickStarterFn(taken, { request: 'abstract mood', brief: b })!;
    for (const t of ['US Congress', 'stock markets', 'surveillance'] as StarterTopic[]) assert.ok(!topicsOf(p.photo.url).includes(t));
    taken.add(p.photo.url);
  }
  const congress = briefWith();
  congress.the_news.text = 'The U.S. Senate passed an AI bill on Tuesday.';
  assert.ok(topicsOf(pickStarterFn(new Set(), { request: 'abstract mood', brief: congress })!.photo.url).includes('US Congress'));
});

test('starter-pool-exhausted: never a repeat within a post; widens instead', () => {
  const b = briefWith();
  b.the_news.text = 'Trump announced a Super Intelligence Force.';
  const used = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const p = pickStarterLeastRecent(used, new Map(), { request: 'abstract mood', brief: b });
    assert.ok(!used.has(p.photo.url), `repeat at ${i}`);
    used.add(p.photo.url);
  }
});

test('topics come from plain words; "NYC lawmakers" is not Congress', () => {
  const b = briefWith();
  b.the_news.text = 'NYC Council lawmakers questioned AI companies at a hearing.';
  assert.ok(!briefTopics(b).includes('US Congress'));
  assert.ok(topicsIn('Nvidia shares fell 5% on the Nasdaq').includes('stock markets'));
  assert.ok(topicsIn('The city expands CCTV and facial recognition').includes('surveillance'));
  assert.deepEqual(topicsIn('abstract mood'), []);
});

// ── Photo rule: IMAGE none, spreads, text-only rotation, landmarks (Tommy, 2026-10-06) ──

import { checkDraft as checkDraftFn, DraftValidationError } from '@/lib/social/writer/draft';

const draftErrors = (edit: (d: ReturnType<typeof sifDraft>) => void): string[] => {
  const d = sifDraft();
  edit(d);
  try {
    checkDraftFn(d, briefWith());
    return [];
  } catch (err) {
    assert.ok(err instanceof DraftValidationError);
    return err.errors.map((e) => `${e.section}: ${e.message}`);
  }
};

test('IMAGE none: allowed on story slides (stat included), never on a cover', () => {
  assert.deepEqual(draftErrors((d) => { d.slides[0]!.image = { kind: 'none', value: '' }; d.slides[3]!.image = { kind: 'none', value: '' }; }), []);
  assert.match(draftErrors((d) => { d.cover_options[0]!.image = { kind: 'none', value: '' }; }).join(), /a cover always has an IMAGE/);
});

test('spreads: at most one; a photo on the first slide; the next slide carries IMAGE none', () => {
  const ok = (d: ReturnType<typeof sifDraft>) => { d.slides[0]!.spread_with_next = true; d.slides[1]!.image = { kind: 'none', value: '' }; };
  assert.deepEqual(draftErrors(ok), []);
  assert.match(draftErrors((d) => { d.slides[0]!.spread_with_next = true; }).join(), /slide after a spread carries no IMAGE/);
  assert.match(draftErrors((d) => { ok(d); d.slides[0]!.image = { kind: 'none', value: '' }; }).join(), /needs a photo on its first slide/);
  assert.match(draftErrors((d) => { ok(d); d.slides[3]!.spread_with_next = true; d.slides[4]!.image = { kind: 'none', value: '' }; }).join(), /2 spreads/);
  assert.match(draftErrors((d) => { d.slides.at(-1)!.spread_with_next = true; }).join(), /last slide/);
});

test('photo chain: IMAGE none gets no photo and no fallback', async () => {
  const { deps: d, fake } = deps();
  const t = await findPhoto({ kind: 'none', value: '' }, newPhotoContext(briefWith(), []), d);
  assert.equal(t.photo, null);
  assert.equal(t.via, 'none');
  assert.equal(fake.calls.length, 0, 'nothing searched');
});

test('spread with IMAGE none on the second slide: both share the first slide\'s wide scene', () => {
  const sub = sifDraft();
  sub.slides[0]!.spread_with_next = true;
  sub.slides[1]!.image = { kind: 'none', value: '' };
  const wide: Photo = { url: '/wide.jpg', credit: 'c, CC0', source: 'starter', width: 3200, height: 1900, qid: null, subject: null };
  const s = draftSlides(fillDraft(sub, briefWith()), { cover: null, slides: [wide, null, null, null, null, null] });
  assert.equal(s[2]!.photoUrl, '/wide.jpg');
  assert.equal(s[2]!.panoramaSide, 'right');
});

test('rotation: consecutive photo-less text slides alternate between copy at the top and copy low', () => {
  const slides: SlideCopy[] = [1, 2, 3, 4].map((n) => textSlide(n, false));
  const r = rotateLayouts(slides);
  const layouts = r.slides.map(layoutOf);
  for (let i = 2; i < layouts.length; i++) assert.ok(!(layouts[i] === layouts[i - 1] && layouts[i] === layouts[i - 2]), layouts.join(','));
  assert.ok(layouts.includes('text-only-low'));
  assert.deepEqual(r.unresolved, []);
});

test('pre-screen v2: a recognizable landmark is rejected', async () => {
  const stock = async () => [ov('Eiffel Tower at night'), ov('city lights at night')];
  const t = await findPhoto({ kind: 'stock', value: 'city lights' }, newPhotoContext(briefWith(), []), { jev: identityJev(SIF_ANSWERS), stock });
  assert.equal(t.photo?.url, 'https://s/city-lights-at-night.jpg');
  assert.ok(t.steps.some((s) => /landmark 0\.90/.test(s)));
});

test('topic words: none of the ambiguous AI-news words match any topic; research is literal only', async () => {
  const { AMBIGUOUS_WORDS } = await import('@/lib/social/photos/starter-set');
  for (const w of AMBIGUOUS_WORDS) assert.deepEqual(topicsIn(`the ${w} said`), [], w);
  assert.deepEqual(topicsIn('French AI lab Mistral launched a new model with agents'), []);
  assert.deepEqual(topicsIn('Scientists ran the experiment in a laboratory'), ['Research and labs']);
});

test('quote speakers by ID: the speaker matches by its SUBJECTS id, not by name text', async () => {
  const b = briefWith();
  b.quotes[0]!.speaker = 'Donald Trump (US president)'; // the name text no longer equals the SUBJECTS name
  const sub = sifDraft();
  sub.slides[2]!.image = { kind: 'subject', value: 'Donald Trump' };
  sub.cover_options[0]!.image = { kind: 'stock', value: 'wall clock' }; // the cover mustn't take Trump's one main image
  const filled = fillDraft(sub, b);
  assert.equal(filled.slides[2]!.quote!.speaker_subject, 'Donald Trump');
  const { deps: d } = deps();
  const p = await photosForDraft(filled, b, [], d);
  assert.equal(p.slides[2]!.via, 'subject', 'matched by speaker_id S1');
  const post = toRenderPost(filled, { cover: null, slides: p.slides.map((t) => t.photo) }, { source: 's', sourceUrl: 'u', publishedAt: 'p' });
  assert.equal(post.slides.find((x) => x.layoutVariant === 'quote')!.photoIsSpeaker, true);
});

test('brief check: every quote speaker_id names a SUBJECTS entry', async () => {
  const { validateBrief, BriefValidationError } = await import('@/lib/social/reporter/brief');
  const b = briefWith();
  b.quotes[0]!.speaker_id = 'S9';
  assert.throws(() => validateBrief(b), (e: unknown) => e instanceof BriefValidationError && /Q1 speaker_id S9 isn't in SUBJECTS/.test((e as Error).message));
});
