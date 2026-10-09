/**
 * The carousel design stage and the photo bank (DECISIONS_LOG D49): the
 * bank never changes a post, and the finder's vetted photos are offered to
 * it. Offline: Wikidata/Commons/Openverse are the photo fixtures' fake; Jev,
 * the sheet tags and the close-up check are stubs; images are made by sharp.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce, TC_URL } from '@/fixtures/social/briefs';
import { sifDraft } from '@/fixtures/social/drafts';
import { createFakeHttp, SIF_WEB } from '@/fixtures/social/photo-http';
import { fitOkFor } from '@/fixtures/social/render-text';
import type { OfferInput, PhotoBank } from '@/lib/media-library/bank';
import type { JevAnswer, JevAsk } from '@/lib/social/jev/client';
import * as PhotoFit from '@/lib/social/jev/questions/photo-fit.v1';
import * as Identity from '@/lib/social/jev/questions/subject-identity.v1';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v4';
import { createDesignStage, type DesignDeps } from '@/lib/social/pipeline/design-stage';
import type { Brief as PipelineBrief, Draft, ScoredCandidate } from '@/lib/social/pipeline/types';
import type { TagSheet, TileTag } from '@/lib/social/photos/tag-sheet';
import type { VisionCheck, VisionVerdict } from '@/lib/social/photos/vision';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import { vettedForSlide } from '@/lib/social/photos/vetted';
import type { Candidate } from '@/lib/social/photos/find';
import { fillDraft } from '@/lib/social/writer/draft';

const IDENTITY: Record<string, { person: number; match: (d: string) => number }> = {
  'Donald Trump': { person: 0.98, match: (d) => (d.includes('president') ? 0.96 : 0.02) },
  'Jay Clayton': { person: 0.97, match: (d) => (d.includes('SEC') ? 0.93 : 0.03) },
  Cursor: { person: 0.03, match: () => 0.8 },
  'Sam Smith': { person: 0.96, match: () => 0.05 },
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
    state.tiles.forEach((t, k) => (answers[PhotoFit.fitId(k)] = { noul: t.tags.some((x) => /fruit/.test(x)) ? 0.05 : 0.9 }));
  } else {
    for (const [id, q] of Object.entries(req.questions)) {
      const labels = Object.keys((q as { criteria: Record<string, unknown> }).criteria);
      answers[id] = { choice: labels[0], probabilities: Object.fromEntries(labels.map((l, i) => [l, i === 0 ? 0.8 : 0.2 / Math.max(1, labels.length - 1)])) };
    }
  }
  return { answers, usage: { input_tokens: 300, output_tokens: 0 }, model: 'stub-jev' };
};

const verdict = (over: Partial<VisionVerdict> = {}): VisionVerdict => ({ what_it_shows: 'a wall clock on a desk', shows_requested: true, shows_requested_confidence: 0.9, person_prominent: false, landmark_visible: false, story_logo: false, logo_seen: null, named_institution: false, mostly_text_banner: false, ...over });
/** The close-up check: fails the first stock result of every request ("-1.jpg"). */
const vision: VisionCheck = async ({ url }) => {
  const bad = /-1\.jpg$/.test(url);
  return { ok: true, pass: !bad, verdict: verdict(bad ? { shows_requested: false } : {}), costUsd: 0.003 };
};
/** Sheet tags: tile 2 of each sheet is a fruit (the homonym the fit check rejects). */
const tagSheet: TagSheet = async (_png, n) => ({ ok: true, costUsd: 0.004, tiles: Array.from({ length: n }, (_, i): TileTag => ({ tile: i + 1, tags: i === 1 ? ['red apple', 'fruit'] : ['wall clock'], person: false, landmark: false, logo: false, named_place: false, text_banner: false })) });

const WH_SRC = 'https://techcrunch.com/wp-content/uploads/2026/09/whitehouse-signing.jpg';
const pages = (): PageReadOk[] => [{
  ok: true, url: TC_URL, resolvedUrl: TC_URL, title: 'Trump unveils', byline: null, publishedTime: '2026-10-04T12:00:00Z', text: 'x', truncated: false,
  photos: [{ src: WH_SRC, caption: 'President Trump signs the order. (Official White House Photo by Daniel Torok)', credit: null, alt: null, from: 'figure', width: 1200 }],
}];

function designDeps(): Omit<DesignDeps, 'bank'> {
  const { http } = createFakeHttp({ ...SIF_WEB, stocksnapCount: { 'wall clock': 2, 'legal documents': 2, 'pen and paper': 2, 'smartphone screen': 2 } });
  const sharpHttp = (async (u: string | URL | Request) => {
    const url = String(u instanceof Request ? u.url : u);
    if (/upload\.wikimedia\.org|stock\.example|techcrunch\.com/.test(url)) {
      const sharp = (await import('sharp')).default;
      return new Response(new Uint8Array(await sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()));
    }
    return http(u as string);
  }) as typeof fetch;
  return { jev, http: sharpHttp, tagSheet, vision, fitCheck: async (post) => fitOkFor(post) };
}

async function runDesign(bank?: PhotoBank) {
  const parsed = briefSuperIntelligenceForce();
  const submission = sifDraft();
  const draft: Draft = { storyId: 's1', submission, filled: fillDraft(submission, parsed) };
  const brief: PipelineBrief = { storyId: 's1', parsed, raw: '', pages: pages() };
  const story = { id: 's1', title: 't', url: TC_URL, outlets: ['TechCrunch'], publishedAt: new Date('2026-10-04T12:00:00Z') } as ScoredCandidate;
  return createDesignStage({ ...designDeps(), now: () => new Date('2026-10-05T03:00:00Z'), ...(bank ? { bank } : {}) })(draft, brief, story);
}

const offReader = { mode: async () => 'off' as const, find: async () => [] };

test('a bank whose offer throws changes nothing: the design output deep-equals the no-bank output', async () => {
  const plain = await runDesign();
  let offered = 0;
  const throwing: PhotoBank = { reader: offReader, offer: () => { offered++; throw new Error('bank down'); }, drain: async () => { throw new Error('bank down'); } };
  const withBank = await runDesign(throwing);
  assert.equal(offered, 1);
  assert.ok(plain.ok);
  assert.deepEqual(withBank, plain);
});

test('the finder’s vetted photos are offered once per post: picked, passed, verified and rejected, with the story’s subjects', async () => {
  const offers: OfferInput[] = [];
  const recording: PhotoBank = { reader: offReader, offer: (input) => void offers.push(input), drain: async () => {} };
  const r = await runDesign(recording);
  assert.ok(r.ok);
  assert.equal(offers.length, 1);
  const o = offers[0]!;
  assert.deepEqual([o.runKind, o.runRef], ['carousel', 's1']);
  assert.ok(o.subjects.includes('Donald Trump') && o.subjects.includes('Jay Clayton'));
  const by = (outcome: string) => o.items.filter((i) => i.outcome === outcome);
  // Every slide's winner is offered as picked, on its render position (1 = cover).
  const winners = [r.value.photos[0]!, ...r.value.photos.slice(1)].map((t, i) => ({ slide: i + 1, url: t.photo?.url ?? null })).filter((w) => w.url);
  assert.ok(winners.length >= 3);
  for (const w of winners) assert.ok(by('picked').some((i) => i.slide === w.slide && i.candidate.url === w.url), `slide ${w.slide} winner offered`);
  assert.ok(by('passed').some((i) => i.candidate.lane === 'headshot' && i.slide === 1), 'the cover\'s runner-up headshot passed every check');
  assert.ok(o.items.filter((i) => i.candidate.lane === 'headshot').every((i) => ['picked', 'passed', 'verified'].includes(i.outcome)), 'identity-verified headshots are always offered');
  const rejected = by('rejected');
  assert.ok(rejected.some((i) => /tags don't fit/.test(i.reason ?? '')), 'the fruit tile: rejected by the fit check');
  assert.ok(rejected.some((i) => /close-up/.test(i.reason ?? '') && i.vision?.pass === false), 'the close-up failure: rejected, with its verdict');
  const pickedScene = by('picked').find((i) => i.candidate.lane === 'stocksnap');
  assert.ok(pickedScene, 'a stock winner');
  assert.deepEqual(pickedScene.vision?.pass, true, 'its close-up verdict travels with it');
  assert.deepEqual(pickedScene.tileTags, ['wall clock']);
});

test('vetted: a verified headshot the slide could not use is still offered (verified); raw unchecked hits are not', () => {
  const c = (over: Partial<Candidate>): Candidate => ({ url: 'u', credit: 'c', source: 'stock', width: 1, height: 1, qid: null, subject: null, lane: 'openverse', date: null, title: '', verified: false, ...over });
  const head = c({ url: 'https://c/head.jpg', lane: 'headshot', source: 'commons', verified: true, qid: 'Q1', subject: 'Jane Doe' });
  const scene = c({ url: 'https://s/scene.jpg', lane: 'stocksnap' });
  const raw = c({ url: 'https://s/raw.jpg', lane: 'openverse' });
  const out = vettedForSlide({
    slide: 5,
    requests: [{ request: { kind: 'person', query: 'Jane Doe' }, candidates: [head] }, { request: { kind: 'thematic', query: 'wall clock' }, candidates: [scene, raw] }],
    winner: scene,
    alternates: [],
    tagsByUrl: new Map(),
    fitByKey: new Map(),
    verdicts: new Map([['https://s/scene.jpg|wall clock', { scene: 'wall clock', pass: true, verdict: null }]]),
    fitMin: 0.5,
  });
  assert.deepEqual(out.map((i) => [i.candidate.url, i.outcome]), [['https://c/head.jpg', 'verified'], ['https://s/scene.jpg', 'picked']]);
  assert.notEqual(out[0]!.candidate, head, 'a copy, not the finder\'s object');
});
