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
import { createDesignStage } from '@/lib/social/pipeline/design-stage';
import type { Brief as PipelineBrief, Draft, ScoredCandidate } from '@/lib/social/pipeline/types';
import { classifyCredit } from '@/lib/social/photos/credit';
import { photosForDraft } from '@/lib/social/photos/design';
import { FALLBACK_SCENES, findPhoto, newPhotoContext } from '@/lib/social/photos/find';
import { checkIdentity } from '@/lib/social/photos/identity';
import { toRenderPost } from '@/lib/social/render/from-draft';
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import { fillDraft, type DraftSubmission } from '@/lib/social/writer/draft';

// ── Stub Jev: answers from the state it is shown ─────────────────────────

type IdentityState = ReturnType<typeof Identity.buildState>;

/** subject name → { person: P(is person), match: description → P(match) }. */
type IdentityAnswers = Record<string, { person: number; match: (description: string) => number }>;

function identityJev(answers: IdentityAnswers, calls: string[] = []): JevAsk {
  return async (req, meta) => {
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

function briefWith(extraSubjects: Brief['subjects'] = []): Brief {
  const b = briefSuperIntelligenceForce();
  b.subjects.push(...extraSubjects);
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

test('an agency-credited article photo is rejected, including a credit-only caption', async () => {
  const { deps: d } = deps();
  const ctx = newPhotoContext(briefWith(), pages());
  const getty = await findPhoto({ kind: 'article', value: GETTY_SRC }, ctx, d);
  assert.equal(getty.photo, null);
  assert.ok(getty.steps.some((s) => /credit rejected: agency/.test(s)));
  const fanjoy = await findPhoto({ kind: 'article', value: FANJOY_SRC }, ctx, d);
  assert.equal(fanjoy.photo, null);
  const unknown = await findPhoto({ kind: 'article', value: 'https://example.com/not-on-any-page.jpg' }, ctx, d);
  assert.equal(unknown.photo, null);
});

test('a failed identity check falls back to a scene, never another person', async () => {
  const { deps: d, fake } = deps();
  const brief = briefWith([{ name: 'Sam Smith', role: 'OpenAI researcher' }, { name: 'Cursor', role: 'AI coding company' }]);
  const ctx = newPhotoContext(brief, []);
  const smith = await findPhoto({ kind: 'subject', value: 'Sam Smith' }, ctx, d);
  assert.equal(smith.photo?.source, 'stock');
  assert.equal(smith.photo?.url, stockUrl(FALLBACK_SCENES.person, 1));
  const cursor = await findPhoto({ kind: 'subject', value: 'Cursor' }, ctx, d);
  assert.equal(cursor.photo?.url, stockUrl(FALLBACK_SCENES.organization, 1));
  // Neither looked up a Commons photo of the namesake.
  assert.ok(!fake.calls.some((c) => /P180%3DQ900003|P180=Q900003|P180%3DQ900002|P180=Q900002/.test(c)));
});

test('no photo repeats within a post; each subject is checked once', async () => {
  const jevCalls: string[] = [];
  const { deps: d } = deps(jevCalls);
  const sub = sifDraft();
  sub.slides[2]!.image = { kind: 'subject', value: 'Donald Trump' };
  sub.slides[4]!.image = { kind: 'stock', value: 'wall clock' };
  const draft = fillDraft(sub, briefWith());
  const p = await photosForDraft(draft, briefWith(), [], d);
  const urls = [p.cover, ...p.slides].map((t) => t.photo?.url).filter(Boolean);
  assert.equal(new Set(urls).size, urls.length);
  assert.equal(p.slides[2]!.photo?.url, commonsUrl('Trump at rally.jpg'), 'second Trump slide gets the next photo');
  assert.equal(p.slides[4]!.photo?.url, stockUrl('wall clock', 2));
  assert.deepEqual(jevCalls.sort(), ['Donald Trump', 'Jay Clayton']);
});

test('a source error means no photo for that slide, not a failed post', async () => {
  const d = { jev: identityJev(SIF_ANSWERS), http: (async () => { throw new Error('offline'); }) as unknown as typeof fetch };
  const ctx = newPhotoContext(briefWith(), []);
  const t = await findPhoto({ kind: 'stock', value: 'wall clock' }, ctx, d);
  assert.equal(t.photo, null);
  assert.ok(t.steps.some((s) => /offline/.test(s)));
});

// ── Render adapter (M6) ──────────────────────────────────────────────────

test('render: every slide type maps to the renderer fields, quotes and numbers exact', () => {
  const brief = briefWith();
  const draft = fillDraft(sifDraft(), brief);
  const photo = { url: 'https://x/p.jpg', credit: 'Jane Doe, CC BY · via flickr', source: 'stock' as const, width: 1, height: 1, qid: null };
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
  const r = await createDesignStage(d)(draft, brief, story);
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
  const draft = fillDraft(sifDraft(), brief);
  const photo = (i: number) => ({ url: `/social/stock/p${i}.jpg`, credit: `Credit ${i}`, source: 'stock' as const, width: null, height: null, qid: null });
  const post = toRenderPost(draft, { cover: photo(0), slides: draft.slides.map((_, i) => photo(i + 1)) }, { source: 'TechCrunch', sourceUrl: TC_URL, publishedAt: '2026-10-04T12:00:00Z' });
  post.slides.forEach((s, i) => {
    const html = renderToStaticMarkup(createElement(SlideTemplate, { post, position: i }));
    assert.match(html, /data-slide-ready="true"/, `slide ${i}`);
    if (s.layoutVariant === 'follow') return;
    assert.ok(html.includes(`/social/stock/p${i}.jpg`), `slide ${i} (${s.layoutVariant}) shows its photo`);
    assert.ok(html.includes(`Credit ${i}`), `slide ${i} (${s.layoutVariant}) shows its credit`);
  });
});
