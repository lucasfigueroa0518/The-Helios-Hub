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
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v4';
import { createDesignStage } from '@/lib/social/pipeline/design-stage';
import type { Brief as PipelineBrief, Draft, ScoredCandidate } from '@/lib/social/pipeline/types';
import { classifyCredit } from '@/lib/social/photos/credit';
import { photosForDraft } from '@/lib/social/photos/design';
import { newSearchContext, searchVisual, type Photo } from '@/lib/social/photos/find';
import { checkIdentity } from '@/lib/social/photos/identity';
import { fitOkFor } from '@/fixtures/social/render-text';
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
  });
  return out;
}

function identityJev(answers: IdentityAnswers, calls: string[] = [], prescreens: string[] = []): JevAsk {
  return async (req, meta) => {
    if (meta.version.startsWith('stock-prescreen@')) {
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

function briefWith(extraSubjects: Array<Omit<Brief['subjects'][number], 'id' | 'type'> & { type?: Brief['subjects'][number]['type'] }> = []): Brief {
  const b = briefSuperIntelligenceForce();
  b.subjects.push(...extraSubjects.map((x, i) => ({ id: `S${b.subjects.length + i + 1}`, type: 'person' as const, ...x })));
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









test('every online source failing: every slide still gets a visual, its icon background (photo spec §1)', async () => {
  const offline = { jev: identityJev(SIF_ANSWERS), http: (async () => { throw new Error('offline'); }) as unknown as typeof fetch };
  const sub = sifDraft();
  // 8 story slides + cover = the most a post can have.
  sub.slides.push({ ...sub.slides[0]!, visual: { kind: 'thematic', query: 'extra one' } }, { ...sub.slides[1]!, visual: { kind: 'thematic', query: 'extra two' } });
  const p = await photosForDraft(fillDraft(sub, briefWith()), briefWith(), [], offline);
  const all = [p.cover, ...p.slides];
  assert.equal(all.length, 9, 'cover + 8 story slides, the most a post can have');
  for (const t of all) {
    assert.ok(t.via === 'icon' || t.via === 'type-led', `${t.request.query}: ${t.via}`);
    assert.equal(t.photo, null);
    assert.ok(t.icon, 'the Writer\'s icon');
  }
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
  // Both undated (these pages carry no publish date): the bigger image wins (photo spec §4 ranking).
  assert.equal(r.value.render.slides[0]!.photoUrl, commonsUrl('Donald Trump official portrait.jpg'));
  assert.ok((r.value.checks as { layout?: string[] }).layout?.length, "Jev's layout is logged");
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
  sub.slides[5] = { ...sub.slides[5]!, body: null };
  const draft = fillDraft(sub, brief);
  const photo = (i: number) => ({ url: `/social/stock/p${i}.jpg`, credit: `Credit ${i}`, source: 'stock' as const, width: null, height: null, qid: null, subject: null });
  // Slide 7 drawn as the landing variant (Jev's pick in a live run; slide buckets spec).
  const post = toRenderPost(draft, { cover: photo(0), slides: draft.slides.map((_, i) => photo(i + 1)) }, { source: 'TechCrunch', sourceUrl: TC_URL, publishedAt: '2026-10-04T12:00:00Z' }, { templates: ['cover-bleed', 'story-photo-below', 'story-photo-top', 'quote-backdrop', 'stat-backdrop', 'story-full-bleed', 'story-landing'], spreadAt: null });
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
  assert.equal(at({ ...base, source: 'stock', qid: null, subject: null }).photoIsSpeaker, false, 'a scene');
});

// ── Slots: where the photo is drawn decides the chain (Tommy, 2026-10-06) ──



// ── Stock pre-screen (spec §5A #6) ───────────────────────────────────────

const ov = (title: string, tags: string[] = []) => ({ url: `https://s/${title.replace(/\W+/g, '-')}.jpg`, foreignLandingUrl: '', mime: 'image/jpeg', width: 1024, height: 683, license: 'by', creator: 'A', source: 'flickr', title, tags });



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
  const wide: Photo = { url: '/wide.jpg', credit: 'c, CC0', source: 'stock', width: 3200, height: Math.floor(3200 / SPREAD_MIN_ASPECT), qid: null, subject: null };
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




test("spread: both slides share the first slide's wide scene", () => {
  const sub = sifDraft();
  sub.slides[0]!.spread_with_next = true;
  const wide: Photo = { url: '/wide.jpg', credit: 'c, CC0', source: 'stock', width: 3200, height: 1900, qid: null, subject: null };
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


test('brief check: every quote speaker_id names a SUBJECTS entry', async () => {
  const { validateBrief, BriefValidationError } = await import('@/lib/social/reporter/brief');
  const b = briefWith();
  b.quotes[0]!.speaker_id = 'S9';
  assert.throws(() => validateBrief(b), (e: unknown) => e instanceof BriefValidationError && /Q1 speaker_id S9 isn't in SUBJECTS/.test((e as Error).message));
});

// ── Vision check + cover fallback (Tommy, 2026-10-06, after the bench) ──

import { createVisionCheck, passesVision, SHOWS_MIN_CONFIDENCE, VISION_SYSTEM, VISION_TOP, type VisionCheck, type VisionVerdict } from '@/lib/social/photos/vision';
import { PHOTO_VISION_MODEL } from '@/lib/social/pipeline/models';

const verdict = (over: Partial<VisionVerdict> = {}): VisionVerdict => ({ what_it_shows: 'x', shows_requested: true, shows_requested_confidence: 0.9, person_prominent: false, landmark_visible: false, story_logo: false, logo_seen: null, named_institution: false, mostly_text_banner: false, ...over });

test('vision: all four must pass (shows it with enough confidence, no person, no landmark, no outside brand)', () => {
  assert.ok(passesVision(verdict()));
  assert.ok(!passesVision(verdict({ shows_requested: false })));
  assert.ok(!passesVision(verdict({ shows_requested_confidence: SHOWS_MIN_CONFIDENCE - 0.01 })));
  assert.ok(!passesVision(verdict({ person_prominent: true })));
  assert.ok(!passesVision(verdict({ landmark_visible: true })));
  assert.ok(!passesVision(verdict({ story_logo: true, logo_seen: 'Equinix' })));
  assert.ok(!passesVision(verdict({ named_institution: true })), 'a specific named hospital, school or company site (CJ Harris Regional Hospital)');
  assert.ok(passesVision(verdict({ mostly_text_banner: true })), 'stock ignores the banner answer (code on a screen reads as text)');
});

/** Stub vision: verdicts by photo title in the URL; records what it was asked. */
function stubVision(byUrl: Record<string, Partial<VisionVerdict>>, asked: string[] = []): VisionCheck {
  return async ({ url }) => {
    asked.push(url);
    const v = verdict(byUrl[url] ?? {});
    return { ok: true, verdict: v, pass: passesVision(v), costUsd: 0.002 };
  };
}



test('vision request: own model, cached system + forced tool, the downscaled photo as an image block, the request and SUBJECTS as text', async () => {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#336' } }).png().toBuffer();
  const http = (async () => new Response(new Uint8Array(png), { status: 200 })) as unknown as typeof fetch;
  const requests: any[] = [];
  const create = async (p: any) => {
    requests.push(p);
    return { id: 'm', type: 'message', role: 'assistant', model: p.model, stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'tool_use', id: 't', name: 'submit_verdict', input: verdict({ what_it_shows: 'a blue field' }) }] } as any;
  };
  const r = await createVisionCheck({ create, http })({ url: 'https://s/x.jpg', scene: 'data center racks', subjects: ['Mistral AI'], title: 'CJ Harris Regional Hospital' });
  assert.ok(r.ok && r.pass && r.costUsd > 0);
  const q = requests[0];
  assert.equal(q.model, PHOTO_VISION_MODEL.model);
  assert.equal(q.system[0].text, VISION_SYSTEM);
  assert.ok(q.system[0].cache_control && q.tools[0].cache_control);
  assert.deepEqual(q.tool_choice, { type: 'tool', name: 'submit_verdict' });
  const [img, text] = q.messages[0].content;
  assert.equal(img.type, 'image');
  const meta = await sharp(Buffer.from(img.source.data, 'base64')).metadata();
  assert.equal(Math.max(meta.width!, meta.height!), 768);
  assert.equal(text.text, 'REQUESTED: data center racks\nSUBJECTS: Mistral AI\nTITLE: CJ Harris Regional Hospital');
});




// ── Photo chain v1 (spec §5.1, 2026-10-07): the Writer and the finder agree; the stock link is frozen ──

import { createSubjectAvailability } from '@/lib/social/photos/availability';
import { replayDeps, stockOutcome, type AcceptedStock } from '@/lib/social/photos/bench-replay';
import { readFileSync } from 'node:fs';

test("headshot_available agrees with the search: a person has a headshot exactly when the person source finds their P18", async () => {
  const b = briefWith([{ name: 'Nobody Pictured', role: 'American lawyer, former chairman of the SEC' }, { name: 'Sam Smith', role: 'AI researcher' }]);
  const web = { ...SIF_WEB, search: { ...SIF_WEB.search, 'Nobody Pictured': ['Q900010'] }, entities: { ...SIF_WEB.entities, Q900010: { id: 'Q900010', label: 'Nobody Pictured', description: 'American lawyer, former chairman of the SEC', human: true, organization: false, files: [] } } };
  const answers = { ...SIF_ANSWERS, 'Nobody Pictured': { person: 0.97, match: () => 0.95 } };
  const jevCalls: string[] = [];
  const shared = new Map();
  const availability = createSubjectAvailability({ jev: identityJev(answers, jevCalls), http: createFakeHttp(web).http }, () => shared);
  const outcomes: Array<[string, boolean, boolean]> = [];
  for (const name of ['Donald Trump', 'Jay Clayton', 'Nobody Pictured', 'Sam Smith']) {
    const available = (await availability({ name, role: null }, b)).headshot;
    const t = await searchVisual({ kind: 'person', query: name }, newSearchContext(b, [], { identities: shared }), { jev: identityJev(answers, jevCalls), http: createFakeHttp(web).http });
    const found = t.candidates.some((c) => c.lane === 'headshot');
    outcomes.push([name, available, found]);
    assert.equal(available, found, `${name}: headshot_available ${available}, search ${found}`);
  }
  assert.deepEqual(outcomes.map(([n, a]) => [n, a]), [['Donald Trump', true], ['Jay Clayton', true], ['Nobody Pictured', false], ['Sam Smith', false]]);
  assert.deepEqual(jevCalls.sort(), ['Donald Trump', 'Jay Clayton', 'Nobody Pictured', 'Sam Smith'], 'one identity check per subject, shared by the Writer and the finder');
});

