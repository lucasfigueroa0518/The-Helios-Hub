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
