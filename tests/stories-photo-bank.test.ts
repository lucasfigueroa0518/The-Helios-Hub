/**
 * IG Stories and the photo bank (DECISIONS_LOG D49): the Stories finder
 * offers its vetted candidates with runKind 'story', and a broken bank never
 * fails a find. Offline: Wikidata/Commons are the photo fixtures' fake, Jev
 * is a stub, no page is read (no source URLs).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeHttp, SIF_WEB, commonsUrl } from '@/fixtures/social/photo-http';
import type { OfferInput, PhotoBank } from '@/lib/media-library/bank';
import type { JevAnswer, JevAsk } from '@/lib/social/jev/client';
import type { DraftPhotos } from '@/lib/social/photos/design';
import type { Candidate, PhotoTrace } from '@/lib/social/photos/find';
import type { VettedPhoto } from '@/lib/social/photos/vetted';
import * as Identity from '@/lib/social/jev/questions/subject-identity.v1';
import { createLivePhotoFinder, type PhotoRequest } from '@/lib/stories/photos';

const jev: JevAsk = async (req, meta) => {
  assert.equal(meta.version, Identity.VERSION);
  const state = req.state as ReturnType<typeof Identity.buildState>;
  const answers: Record<string, JevAnswer> = { is_person: { noul: 0.98 } };
  state.candidates.forEach((c, k) => (answers[Identity.matchId(k)] = { noul: c.description.includes('president') ? 0.96 : 0.02 }));
  return { answers, usage: { input_tokens: 300, output_tokens: 0 }, model: 'stub-jev' };
};

const req = (): PhotoRequest => ({ kind: 'person', query: 'Donald Trump', subjects: [{ name: 'Donald Trump', type: 'person' }], storyDate: '2026-10-04', sourceUrls: [], exclude: new Set() });
const offReader = { mode: async () => 'off' as const, find: async () => [] };

test('a Stories find offers its pick (and identity-verified candidates) as runKind story, numbered in order', async () => {
  const offers: OfferInput[] = [];
  const bank: PhotoBank = { reader: offReader, offer: (o) => void offers.push(o), drain: async () => {} };
  const finder = createLivePhotoFinder({ jev, http: createFakeHttp(SIF_WEB).http, bank, runRef: 'stories-build:test' });
  const photo = await finder.find(req());
  assert.equal(photo?.src, commonsUrl('Donald Trump official portrait.jpg'));
  await finder.find(req());
  assert.equal(offers.length, 2);
  assert.deepEqual([offers[0]!.runKind, offers[0]!.runRef, offers[0]!.subjects], ['story', 'stories-build:test', ['Donald Trump']]);
  assert.deepEqual(offers[0]!.items.map((i) => [i.slide, i.outcome, i.candidate.lane, i.candidate.url]), [[1, 'picked', 'headshot', commonsUrl('Donald Trump official portrait.jpg')]]);
  assert.equal(offers[0]!.items[0]!.vision, null, 'Stories run no close-up check');
  assert.equal(offers[1]!.items[0]!.slide, 2);
});

test('a bank that throws never fails a Stories find, and without a bank the find is unchanged', async () => {
  const throwing: PhotoBank = { reader: offReader, offer: () => { throw new Error('bank down'); }, drain: async () => {} };
  const withBank = await createLivePhotoFinder({ jev, http: createFakeHttp(SIF_WEB).http, bank: throwing }).find(req());
  const without = await createLivePhotoFinder({ jev, http: createFakeHttp(SIF_WEB).http }).find(req());
  assert.deepEqual(withBank, without);
  assert.ok(without);
});

// ── Sets (Morning Download, Last Few Days): the design stage is stubbed, so nothing is searched. ──

const cand = (url: string, lane: Candidate['lane'], verified: boolean): Candidate => ({ url, credit: 'C', source: lane === 'logo' ? 'logo' : lane === 'headshot' ? 'commons' : 'stock', width: 1200, height: 800, qid: verified ? 'Q1' : null, subject: verified ? 'Nvidia' : null, lane, date: null, title: '', verified });
const vet = (slide: number, query: string, outcome: VettedPhoto['outcome'], c: Candidate): VettedPhoto => ({ slide, request: { kind: 'thematic', query }, outcome, candidate: c, tileTags: ['chip'], fit: 0.8, vision: null });
const trace = (photo: Candidate | null): PhotoTrace => ({ request: { kind: 'thematic', query: 'q' }, photo, via: photo ? photo.lane : 'icon', icon: null, identity: null, steps: [], alternates: [] });
const setReqs = (): PhotoRequest[] => [
  { kind: 'company', query: 'Nvidia', subjects: [{ name: 'Nvidia', type: 'organization' }], storyDate: '2026-11-02', sourceUrls: [], exclude: new Set() },
  { kind: 'thematic', query: 'data center', subjects: [{ name: 'Jensen Huang', type: 'person' }], storyDate: '2026-11-02', sourceUrls: [], exclude: new Set() },
];
const A = cand('https://a/pick1.jpg', 'stocksnap', false);
const B = cand('https://a/logo.png', 'logo', true);
const C = cand('https://a/pick2.jpg', 'openverse', false);
const D = cand('https://a/runner.jpg', 'openverse', false);
const E = cand('https://a/bad-headshot.jpg', 'headshot', true);
const designed: DraftPhotos = {
  cover: trace(A),
  slides: [trace(C)],
  costUsd: { tags: 0, vision: 0 },
  vetted: [vet(1, 'Nvidia', 'picked', A), vet(1, 'Nvidia', 'verified', B), vet(2, 'data center', 'picked', C), vet(2, 'data center', 'passed', D), vet(2, 'data center', 'rejected', E)],
};
const design = async () => structuredClone(designed);

test('a set (Morning Download) offers its picks and identity-verified candidates as runKind story, numbered after earlier finds', async () => {
  const offers: OfferInput[] = [];
  const bank: PhotoBank = { reader: offReader, offer: (o) => void offers.push(o), drain: async () => {} };
  const finder = createLivePhotoFinder({ jev, http: createFakeHttp(SIF_WEB).http, bank, runRef: 'stories-build:set', design });
  await finder.find(req());
  const photos = await finder.findSet!(setReqs());
  assert.deepEqual(photos.map((p) => p?.src), [A.url, C.url]);
  assert.equal(offers.length, 2);
  const set = offers[1]!;
  assert.deepEqual([set.runKind, set.runRef, set.subjects, set.organizations], ['story', 'stories-build:set', ['Nvidia', 'Jensen Huang'], ['Nvidia']]);
  // The pick and the verified logo for place 1, the pick for place 2; never the runner-up nor the rejected headshot. Places follow the single find (1).
  assert.deepEqual(set.items.map((i) => [i.slide, i.outcome, i.candidate.url]), [[2, 'picked', A.url], [2, 'verified', B.url], [3, 'picked', C.url]]);
  assert.deepEqual(set.items[0]!.tileTags, ['chip'], 'the design stage’s tags are kept');
});

test('a set offers a runner-up that took a place (promotion), and a broken or missing bank never changes the set', async () => {
  const offers: OfferInput[] = [];
  const promoted = async (): Promise<DraftPhotos> => ({ ...structuredClone(designed), cover: trace(C), slides: [trace(D)] });
  const bank: PhotoBank = { reader: offReader, offer: (o) => void offers.push(o), drain: async () => {} };
  await createLivePhotoFinder({ jev, bank, design: promoted }).findSet!(setReqs());
  assert.deepEqual(offers[0]!.items.map((i) => [i.slide, i.outcome, i.candidate.url]), [[1, 'verified', B.url], [2, 'picked', C.url], [2, 'picked', D.url]]);

  const throwing: PhotoBank = { reader: offReader, offer: () => { throw new Error('bank down'); }, drain: async () => {} };
  const withBank = await createLivePhotoFinder({ jev, bank: throwing, design }).findSet!(setReqs());
  const without = await createLivePhotoFinder({ jev, design }).findSet!(setReqs());
  assert.deepEqual(withBank, without);
  assert.equal(without.filter(Boolean).length, 2);
});
