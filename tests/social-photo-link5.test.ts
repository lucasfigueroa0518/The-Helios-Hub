/**
 * Photo Link 5: placement (photo spec §4–§5a). Offline: no model, no
 * network. Wikidata/Commons are a small fake; faces, second photos and the
 * vision check are stubs.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { sifDraftHandoff } from '@/fixtures/social/drafts';
import { fitOkFor } from '@/fixtures/social/render-text';
import type { CommonsCandidate } from '@/lib/social/editorial/v2/image-step/commons';
import type { ListedPhoto } from '@/lib/social/photos/article-list';
import type { DetectFaces } from '@/lib/social/photos/faces';
import { findPhoto, newPhotoContext, type Photo, type PhotoDeps } from '@/lib/social/photos/find';
import type { IdentityResult } from '@/lib/social/photos/identity';
import { titleNamesPerson } from '@/lib/social/photos/second-photo';
import type { VisionCheck } from '@/lib/social/photos/vision';
import { createDesignStage } from '@/lib/social/pipeline/design-stage';
import type { Brief as PipelineBrief, ScoredCandidate } from '@/lib/social/pipeline/types';
import type { FaceBox } from '@/lib/social/render/fit-check';
import { canBleedPerson, toRenderPost } from '@/lib/social/render/from-draft';
import { rotateLayouts } from '@/lib/social/render/layout-rotation';
import type { Brief } from '@/lib/social/reporter/brief';
import { fillDraft } from '@/lib/social/writer/draft';

/** The SIF brief plus Acme (S4, organization) and Jane Doe (S5, person). */
function brief(): Brief {
  const b = briefSuperIntelligenceForce();
  b.subjects.push({ id: 'S4', name: 'Acme', role: 'AI company', type: 'organization' }, { id: 'S5', name: 'Jane Doe', role: 'CEO of Acme', type: 'person' });
  return b;
}

const verified = (name: string, qid: string, type: 'organization' | 'person'): [string, Promise<IdentityResult>] => [name, Promise.resolve({ ok: true, scores: { person: 0, matches: [] }, qid, label: name, description: '', type, via: 'resolver' })];
const noJev = (async () => { throw new Error('no Jev in this test'); }) as never;

/** Fake Wikidata + Commons: each QID's P18 file and P154 logo; one PNG for everything. */
async function fakeWeb(entities: Record<string, { p18?: string; logo?: string }>): Promise<typeof fetch> {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 400, height: 160, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();
  const file = (f: string) => `https://upload.wikimedia.org/${encodeURIComponent(f)}`;
  return (async (url: string) => {
    const u = new URL(String(url));
    if (u.hostname.includes('wikidata.org')) {
      const qid = u.searchParams.get('ids')!;
      const e = entities[qid] ?? {};
      const claims = { ...(e.p18 ? { P18: [{ mainsnak: { datavalue: { value: e.p18 } } }] } : {}), ...(e.logo ? { P154: [{ rank: 'normal', mainsnak: { datavalue: { value: e.logo } } }] } : {}) };
      return new Response(JSON.stringify({ entities: { [qid]: { claims } } }));
    }
    if (u.hostname.includes('commons.wikimedia.org')) {
      const titles = (u.searchParams.get('titles') ?? '').split('|');
      const pages = Object.fromEntries(titles.map((t, i) => [i, { title: t, imageinfo: [{ url: file(t), thumburl: file(t), thumbwidth: 800, thumbheight: 320, width: 1600, height: 2000, mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC BY 2.0' }, Artist: { value: 'A Photographer' } } }] }]));
      return new Response(JSON.stringify({ query: { pages } }));
    }
    if (u.hostname === 'upload.wikimedia.org') return new Response(new Uint8Array(png));
    throw new Error(`unexpected fetch ${u}`);
  }) as unknown as typeof fetch;
}

/** Faces per URL fragment; anything else: no face. */
const facesBy = (byPart: Record<string, number>): DetectFaces => async (urls) =>
  new Map(urls.map((u) => {
    const n = Object.entries(byPart).find(([part]) => decodeURIComponent(u).includes(part))?.[1] ?? 0;
    return [u, Array.from({ length: n }, (_, k): FaceBox => ({ x: 0.4 + k * 0.1, y: 0.15, w: 0.1, h: 0.15, score: 0.9 }))];
  }));

const story = (tags: string[], extra: Partial<{ cover: boolean; slot: 'split' | 'quote' | 'backdrop'; speaker: string; icon: string }> = {}) => ({ text: ['x'], speaker: extra.speaker ?? null, slot: extra.slot ?? ('split' as const), cover: extra.cover ?? false, tags, icon: extra.icon ?? 'building-2' });

// ── Organizations: logos only (Tommy, 2026-10-07) ────────────────────

test("an organization on story slides: its logo on one story slide, never its main photo (the Pioneer Building path is gone)", async () => {
  const http = await fakeWeb({ Q1: { p18: 'Acme HQ building.jpg', logo: 'Acme logo.svg' } });
  const ctx = newPhotoContext(brief(), []);
  ctx.identities = new Map([verified('Acme', 'Q1', 'organization')]);
  const d: PhotoDeps = { jev: noJev, http, faces: facesBy({}) };
  const cover = await findPhoto({ kind: 'subject', value: 'Acme' }, ctx, d, story(['S4'], { cover: true }));
  const first = await findPhoto({ kind: 'subject', value: 'Acme' }, ctx, d, story(['S4']));
  const second = await findPhoto({ kind: 'subject', value: 'Acme' }, ctx, d, story(['S4']));
  assert.deepEqual([cover.via, first.via, second.via], ['logo', 'logo', 'icon']);
  assert.ok([cover, first, second].every((t) => !t.photo?.url.includes('HQ')), 'never the main photo');
});

// ── Second photos (photo spec §3) ────────────────────────────────────

test('second photo of a person: tagged by QID, name in the title, exactly one face; on the quote slide after the cover used the headshot', async () => {
  assert.ok(titleNamesPerson('File:Jane_Doe_at_the_summit_2025.jpg', 'Jane Doe'));
  assert.ok(!titleNamesPerson('File:Summit panel 2025.jpg', 'Jane Doe'));
  const http = await fakeWeb({ Q2: { p18: 'Jane Doe portrait.jpg' } });
  const cand = (file: string): CommonsCandidate => ({ file, url: `https://upload.wikimedia.org/${encodeURIComponent(file)}`, width: 1600, height: 2000, mime: 'image/jpeg', author: 'B Photographer', license: 'CC BY-SA 4.0', licenseUrl: null, tier: 'CC BY-SA', source: 'P180' });
  const asked: string[] = [];
  const secondPhotos = async (qid: string, name: string) => { asked.push(`${qid} ${name}`); return [cand('File:Jane Doe and board.jpg'), cand('File:Jane Doe keynote.jpg')]; };
  const ctx = newPhotoContext(brief(), []);
  ctx.identities = new Map([verified('Jane Doe', 'Q2', 'person')]);
  const d: PhotoDeps = { jev: noJev, http, faces: facesBy({ 'board': 3, 'keynote': 1, 'portrait': 1 }), secondPhotos };
  const cover = await findPhoto({ kind: 'subject', value: 'Jane Doe' }, ctx, d, story(['S5'], { cover: true }));
  assert.equal(cover.via, 'subject');
  const quote = await findPhoto({ kind: 'subject', value: 'Jane Doe' }, ctx, d, story(['S5'], { slot: 'quote', speaker: 'Jane Doe' }));
  assert.equal(quote.via, 'second');
  assert.match(quote.photo!.url, /keynote/);
  assert.equal(quote.photo!.qid, 'Q2');
  assert.deepEqual(asked, ['Q2 Jane Doe'], 'searched by the verified QID');
  assert.ok(quote.steps.some((s) => /File:Jane Doe and board\.jpg: 3 faces → not used/.test(s)));
});

test('quote slide: no headshot, no second photo → an article photo whose caption names the speaker → else type-led; never a company logo', async () => {
  const http = await fakeWeb({ Q2: {} , Q1: { logo: 'Acme logo.svg' } });
  const listed: ListedPhoto[] = [
    { url: 'https://news.example/acme-office.jpg', caption: 'Acme offices', credit: 'Courtesy of Acme', page: 'https://news.example/a', subject_ids: ['S4'], official_of: null },
    { url: 'https://news.example/jane.jpg', caption: 'Jane Doe at the launch', credit: 'Courtesy of Acme', page: 'https://news.example/a', subject_ids: ['S5'], official_of: null },
  ];
  const ctx = newPhotoContext(brief(), [], { photos: listed });
  ctx.identities = new Map([verified('Jane Doe', 'Q2', 'person'), verified('Acme', 'Q1', 'organization')]);
  const q = await findPhoto({ kind: 'subject', value: 'Jane Doe' }, ctx, { jev: noJev, http }, story(['S5'], { slot: 'quote', speaker: 'Jane Doe' }));
  assert.equal(q.via, 'article');
  assert.equal(q.photo!.url, 'https://news.example/jane.jpg', 'the photo whose caption names the speaker, never the office photo');
  const org = await findPhoto({ kind: 'none', value: '' }, ctx, { jev: noJev, http }, story(['S4'], { slot: 'quote', speaker: 'Acme' }));
  assert.equal(org.via, 'type-led', "an organization speaker: never its logo in the speaker's spot");
  const none = await findPhoto({ kind: 'none', value: '' }, newPhotoContext(brief(), []), { jev: noJev, http }, story([], { slot: 'quote', speaker: null as never }));
  assert.equal(none.via, 'type-led');
});

// ── Official images: the text check (photo spec §3 rule 4) ───────────

test('official images: a mostly-text image (title card, banner) is rejected by the vision call; a picture goes on the cover', async () => {
  const listed: ListedPhoto[] = [
    { url: 'https://acme.example/news/banner.png', caption: null, credit: null, page: 'https://acme.example/news/x', subject_ids: [], official_of: 'S4' },
    { url: 'https://acme.example/news/robot.jpg', caption: null, credit: null, page: 'https://acme.example/news/x', subject_ids: [], official_of: 'S4' },
  ];
  const checked: string[] = [];
  const vision: VisionCheck = async ({ url }) => {
    checked.push(url);
    const banner = url.endsWith('banner.png');
    return { ok: true, pass: false, costUsd: 0.002, verdict: { what_it_shows: banner ? 'a title card' : 'a robot arm', shows_requested: true, shows_requested_confidence: 0.9, person_prominent: false, landmark_visible: false, story_logo: true, logo_seen: 'Acme', named_institution: false, mostly_text_banner: banner } };
  };
  const t = await findPhoto({ kind: 'none', value: '' }, newPhotoContext(brief(), [], { photos: listed }), { jev: noJev, vision }, story(['S4'], { cover: true }));
  assert.equal(t.via, 'official');
  assert.equal(t.photo!.url, 'https://acme.example/news/robot.jpg');
  assert.equal(t.photo!.credit, 'Image: Acme');
  assert.deepEqual(checked, ['https://acme.example/news/banner.png', 'https://acme.example/news/robot.jpg']);
  assert.ok(Math.abs((t.visionUsd ?? 0) - 0.004) < 1e-9, 'its cost counted');
  const story2 = await findPhoto({ kind: 'none', value: '' }, newPhotoContext(brief(), [], { photos: listed }), { jev: noJev, vision }, { ...story([]), icon: 'rocket' });
  assert.equal(story2.via, 'icon', 'IMAGE none on a story slide: its icon, never a photo the Writer did not ask for');
  const untagged = await findPhoto({ kind: 'article', value: 'https://acme.example/news/robot.jpg' }, newPhotoContext(brief(), [], { photos: listed }), { jev: noJev, vision }, story(['S1']));
  assert.notEqual(untagged.via, 'official', "an official image only on the cover or its company's slide");
});

// ── Full-bleed people (photo spec §4) ────────────────────────────────

test('full bleed for a person only when properly framed: one whole face in the upper half', () => {
  const p = (faces: FaceBox[]): Photo => ({ url: 'u', credit: 'c', source: 'commons', width: 1600, height: 2000, qid: 'Q2', subject: 'Jane Doe', faces });
  const face = (y: number, h = 0.15, x = 0.42): FaceBox => ({ x, y, w: 0.16, h, score: 0.9 });
  assert.ok(canBleedPerson(p([face(0.12)])));
  assert.ok(!canBleedPerson(p([face(0.45)])), 'face too low');
  assert.ok(!canBleedPerson(p([face(0.1, 0.5)])), 'too tight');
  assert.ok(!canBleedPerson(p([face(0.0)])), 'cut off at the top');
  assert.ok(!canBleedPerson(p([face(0.12), face(0.12, 0.15, 0.1)])), 'two faces');
  assert.ok(!canBleedPerson(p([])), 'no face found');
  assert.ok(!canBleedPerson({ ...p([face(0.12)]), source: 'stock' }), 'not a person photo');
});

test('design stage: a full-bleed person photo whose face lands under text goes back to the split layout, one re-render', async () => {
  const b = briefSuperIntelligenceForce();
  const sub = sifDraftHandoff();
  const draft = { storyId: 's1', submission: sub, filled: fillDraft(sub, b) };
  const http = await fakeWeb({ Q9: { p18: 'Jay Clayton portrait.jpg' } });
  const renders: string[] = [];
  const stage = createDesignStage({
    jev: noJev, http, faces: facesBy({ 'Jay Clayton': 1 }),
    identitiesFor: () => new Map([verified('Jay Clayton', 'Q9', 'person'), verified('Donald Trump', 'Q8', 'person')]),
    fitCheck: async (post) => {
      const bleed = post.slides.findIndex((s) => s.photoBleed);
      renders.push(bleed >= 0 ? `bleed ${bleed + 1}` : 'no bleed');
      const ok = fitOkFor(post);
      return bleed >= 0 ? { ...ok, ok: false, problems: [`slide ${bleed + 1} faces: helios-image__body "x" covers a face`] } : ok;
    },
  });
  const sc = { id: 's1', title: 't', url: 'https://x', outlets: ['TechCrunch'], publishedAt: new Date('2026-10-04T12:00:00Z') } as ScoredCandidate;
  const r = await stage(draft, { storyId: 's1', parsed: b, raw: '', pages: [] } as PipelineBrief, sc);
  assert.ok(r.ok, r.ok ? '' : r.detail);
  assert.deepEqual(renders, ['bleed 3', 'no bleed']);
  assert.ok(r.value.checks.photoReplacements.includes('slide 3: a face under text on the full-bleed photo → split layout'));
  assert.equal(r.value.render.slides[2]!.layoutVariant, 'text');
});

// ── Icon backgrounds (photo spec §5, §5a) ────────────────────────────

test("icons: every slide without a photo draws its icon; stat slides always; a run of icon slides alternates sides", async () => {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SlideTemplate } = await import('@/lib/social/render/SlideTemplate');
  const filled = fillDraft(sifDraftHandoff(), briefSuperIntelligenceForce());
  const post = toRenderPost(filled, { cover: null, slides: filled.slides.map(() => null) }, { source: 's', sourceUrl: 'u', publishedAt: '2026-10-07T00:00:00Z' });
  const icons = post.slides.map((_, i) => /data-icon="([^"]+)"/.exec(renderToStaticMarkup(React.createElement(SlideTemplate, { post, position: i })))?.[1] ?? null);
  assert.deepEqual(icons, ['landmark', 'smartphone', 'user', 'message-square-quote', 'clock', 'file-text', 'file-text', null], "the Writer's icons; none on the follow slide");
  assert.deepEqual(post.slides.slice(1, 7).map((s) => s.iconSide ?? 'right'), ['right', 'left', 'right', 'left', 'right', 'left']);
  const withPhoto = toRenderPost(filled, { cover: null, slides: filled.slides.map((_, i) => (i === 0 ? { url: 'https://s/x.jpg', credit: 'A, CC BY', source: 'stock', width: 1600, height: 1000, qid: null, subject: null } : null)) }, { source: 's', sourceUrl: 'u', publishedAt: 'p' });
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(SlideTemplate, { post: withPhoto, position: 1 })), /helios-icon-bg/, 'a slide with a photo shows no icon');
  assert.equal(rotateLayouts(post.slides).slides.length, post.slides.length);
});

// ── Fixed bad-photo cases (photo spec §7; Tommy, 2026-10-07) ─────────

test('fixed cases R03, R10, R13 and the Le Chonk cover and inset: those photos never come back for those requests', async () => {
  const forbidden = JSON.parse(readFileSync('fixtures/social/photo-bench/annotations.json', 'utf8')).forbidden;
  const accepted = JSON.parse(readFileSync('fixtures/social/photo-bench/accepted-stock.json', 'utf8')).requests as Array<{ id: string; outcome: string }>;
  // R03 and R13 are stock requests: the frozen stock link never picked those photos (they came from the old fallbacks, now gone).
  for (const id of ['R03', 'R13']) assert.ok(!forbidden[id].urls.includes(accepted.find((a) => a.id === id)!.outcome), id);
  // The starter set (the lab-bench photos) is out (photo spec §6).
  assert.ok(!existsSync('public/social/starter'), 'the starter photos are gone');
  // R10 / Le Chonk: a cover asking for Mistral AI gets its logo card or its cover icon; the brick building is a stock photo for another request.
  const b = brief();
  b.subjects.push({ id: 'S6', name: 'Mistral AI', role: 'French AI lab', type: 'organization' });
  for (const logo of ['Mistral logo.svg', undefined]) {
    const ctx = newPhotoContext(b, []);
    ctx.identities = new Map([verified('Mistral AI', 'Q3', 'organization')]);
    const t = await findPhoto({ kind: 'subject', value: 'Mistral AI' }, ctx, { jev: noJev, http: await fakeWeb({ Q3: { ...(logo ? { logo } : {}) } }) }, story(['S6'], { cover: true, icon: 'cpu' }));
    assert.equal(t.via, logo ? 'logo' : 'icon');
    const urls = [forbidden.R10.urls, forbidden['LECHONK-2117-COVER'].urls, forbidden['LECHONK-2117-INSET'].urls].flat();
    assert.ok(!urls.includes(t.photo?.url), t.photo?.url);
  }
  // R13: the Pioneer Building (OpenAI's main photo) never answers a "government building exterior" request on a slide not about OpenAI.
  const ctx = newPhotoContext(b, []);
  const t = await findPhoto({ kind: 'stock', value: 'government building exterior' }, ctx, { jev: noJev, stock: async () => [] }, story(['S6']));
  assert.ok(!forbidden.R13.urls.some((u: string) => t.photo?.url?.startsWith(u)));
});
