/**
 * Bald-Eagle D9: finder_source "first" uses the photo bank before the web, but a request whose bank candidates all
 * fail the later checks (close-up, slide pick, used-photo hold) is searched online once and picked again. A slide
 * never ends without a photo only because the bank's offers fell through. Offline: the bank reader, Openverse,
 * Commons search, the close-up check and Jev are stubs; Wikidata is the photo fixtures' fake.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { commonsUrl, createFakeHttp, SIF_WEB } from '@/fixtures/social/photo-http';
import type { BankFind, BankHit, BankReader } from '@/lib/media-library/reader';
import type { FinderSourceMode } from '@/lib/media-library/types';
import type { PhotoBank } from '@/lib/media-library/bank';
import type { JevAnswer, JevAsk } from '@/lib/social/jev/client';
import * as Identity from '@/lib/social/jev/questions/subject-identity.v1';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v5';
import { photosForDraft } from '@/lib/social/photos/design';
import { newSearchContext, searchVisual, type PhotoDeps, type StockSearch } from '@/lib/social/photos/find';
import type { VisionCheck, VisionVerdict } from '@/lib/social/photos/vision';
import { createLivePhotoFinder, type PhotoRequest } from '@/lib/stories/photos';

const jev: JevAsk = async (req, meta) => {
  const answers: Record<string, JevAnswer> = {};
  if (meta.version === Identity.VERSION) {
    const state = req.state as ReturnType<typeof Identity.buildState>;
    answers.is_person = { noul: 0.98 };
    state.candidates.forEach((c, k) => (answers[Identity.matchId(k)] = { noul: c.description.includes('president') ? 0.96 : 0.02 }));
  } else if (meta.version === Prescreen.VERSION) {
    const state = req.state as ReturnType<typeof Prescreen.buildState>;
    state.candidates.forEach((_, k) => {
      answers[Prescreen.fitId(k)] = { noul: 0.9 };
      answers[Prescreen.peopleId(k)] = { noul: 0.05 };
    });
  } else {
    // The slide check (photo-slide@2) and anything else: fits, not a repeat.
    for (const id of Object.keys(req.questions)) answers[id] = { noul: id.startsWith('repeats_') ? 0.05 : 0.9 };
  }
  return { answers, usage: { input_tokens: 300, output_tokens: 0 }, model: 'stub-jev' };
};

/** Openverse stub (both lanes): two results per query; records each search. */
function stock(calls: string[]): StockSearch {
  return async (q) => {
    calls.push(q);
    return [1, 2].map((i) => ({ url: `https://stock.example/${q.replace(/\W+/g, '-')}-${i}.jpg`, foreignLandingUrl: '', mime: 'image/jpeg', width: 2400, height: 1600, license: 'cc0', creator: 'A', source: 'stocksnap', title: `${q} ${i}`, tags: [] }));
  };
}

const hit = (over: Partial<BankHit>): BankHit => ({ photoId: 'p', url: 'https://bank.test/x.jpg', urls: ['https://bank.test/x.jpg'], source: 'stock', lane: 'stocksnap', credit: 'Snap, CC0 · via StockSnap', title: 'servers', date: null, width: 3000, height: 2000, qids: [], subjects: [], tags: ['server', 'racks'], overlap: 2, faces: null, plate: null, ...over });
const BANK_SCENES = () => [hit({ photoId: 'b1', url: 'https://bank.test/1.jpg', urls: ['https://bank.test/1.jpg'] }), hit({ photoId: 'b2', url: 'https://bank.test/2.jpg', urls: ['https://bank.test/2.jpg'], overlap: 1 })];

function fakeReader(mode: FinderSourceMode, hits: (q: BankFind) => BankHit[]): BankReader & { asked: BankFind[]; invalidated: number } {
  const r = {
    asked: [] as BankFind[],
    invalidated: 0,
    mode: async () => mode,
    async find(q: BankFind) {
      r.asked.push(q);
      return hits(q);
    },
    invalidate() {
      r.invalidated++;
    },
  };
  return r;
}

const verdict = (ok: boolean): VisionVerdict => ({ what_it_shows: 'server racks', shows_requested: ok, shows_requested_confidence: 0.9, person_prominent: false, landmark_visible: false, story_logo: false, logo_seen: null, named_institution: false, mostly_text_banner: false });
/** The close-up check: fails every bank photo when `failBank`, passes everything else. */
const vision = (failBank: boolean): VisionCheck => async ({ url }) => {
  const bad = failBank && url.startsWith('https://bank.test/');
  return { ok: true, pass: !bad, verdict: verdict(!bad), costUsd: 0.003 };
};

// ── searchVisual: the `bankOnly` flag and the `online` search ──

const ctx = () => newSearchContext(briefSuperIntelligenceForce(), [], { storyDate: '2026-10-04' });
const deps = (over: Partial<PhotoDeps>, calls: string[]): PhotoDeps => ({ jev, http: createFakeHttp(SIF_WEB).http, stock: stock(calls), commons: async () => [], ...over });

test('searchVisual says when the bank alone answered, and `online` asks only the web', async () => {
  const calls: string[] = [];
  const reader = fakeReader('first', BANK_SCENES);
  const bankOnly = await searchVisual({ kind: 'setting', query: 'server racks' }, ctx(), deps({ bank: reader }, calls));
  assert.equal(bankOnly.bankOnly, true);
  assert.deepEqual(calls, []);
  const online = await searchVisual({ kind: 'setting', query: 'server racks' }, ctx(), deps({ bank: reader }, calls), { online: true });
  assert.equal(online.bankOnly, false);
  assert.equal(reader.asked.length, 1, 'the online search skips the bank');
  assert.ok(calls.length > 0 && online.candidates.every((c) => c.url.startsWith('https://stock.example/')));
  for (const mode of ['compete', 'off'] as const) {
    const r = await searchVisual({ kind: 'setting', query: 'server racks' }, ctx(), deps({ bank: fakeReader(mode, BANK_SCENES) }, []));
    assert.equal(r.bankOnly, false, `${mode}: never bank-only`);
  }
});

// ── Sets (Morning Download, Last Few Days, Carousels): the real design stage with stubbed sources ──

const setReqs = (): PhotoRequest[] => [
  { kind: 'setting', query: 'server racks', subjects: [], storyDate: '2026-10-04', sourceUrls: [], exclude: new Set(), copy: 'Data centers fill up' },
  { kind: 'setting', query: 'server racks', subjects: [], storyDate: '2026-10-04', sourceUrls: [], exclude: new Set(), copy: 'More racks coming' },
];

async function runSet(mode: FinderSourceMode, failBank: boolean) {
  const calls: string[] = [];
  const reader = fakeReader(mode, BANK_SCENES);
  const bank: PhotoBank = { reader, offer: () => {}, drain: async () => {} };
  const trace: string[][] = [];
  const design: typeof photosForDraft = (draft, brief, pages, d, history) =>
    photosForDraft(draft, brief, pages, { jev, http: createFakeHttp(SIF_WEB).http, stock: stock(calls), commons: async () => [], vision: vision(failBank), ...(d.bank ? { bank: d.bank } : {}) }, history);
  const photos = await createLivePhotoFinder({ jev, bank, design }).findSet!(setReqs(), trace);
  return { photos, calls, trace, reader };
}

const RETRY = /photo bank's candidates didn't pass → online search/;

test('first: bank candidates the checks reject → the web is searched for that request and a photo is picked', async () => {
  const { photos, calls, trace } = await runSet('first', true);
  assert.ok(photos.every((p) => p?.src.startsWith('https://stock.example/')), `every frame has a web photo: ${photos.map((p) => p?.src)}`);
  assert.ok(calls.length > 0, 'the online search ran');
  assert.ok(trace[0]!.some((s) => RETRY.test(s)));
  // Once per bank-only request of the slide (its visual and its fallback), not again for the same request.
  assert.equal(trace[0]!.filter((s) => RETRY.test(s)).length, 2);
});

test('first: bank candidates that pass → no online search at all', async () => {
  const { photos, calls, trace, reader } = await runSet('first', false);
  assert.ok(photos.every((p) => p?.src.startsWith('https://bank.test/')));
  assert.deepEqual(calls, []);
  assert.ok(!trace.flat().some((s) => RETRY.test(s)));
  assert.ok(reader.invalidated >= 1, 'a new set reads the used-photo ledger fresh');
});

test('compete and off: unchanged (no second search)', async () => {
  for (const mode of ['compete', 'off'] as const) {
    const { photos, trace } = await runSet(mode, true);
    assert.ok(photos.every((p) => p?.src.startsWith('https://stock.example/')), mode);
    assert.ok(!trace.flat().some((s) => RETRY.test(s)), `${mode}: no retry`);
  }
});

// ── Single finds (Guess the Number, Free vs Paid): the used-photo hold rejects the bank's offers ──

test('a single find whose bank photos are held falls back to the web once; the hold still applies there', async () => {
  const BANK_TRUMP = ['https://bank.test/trump-1.jpg', 'https://bank.test/trump-2.jpg'];
  const reader = fakeReader('first', (q) => (q.qid === 'Q22686' ? BANK_TRUMP.map((url, k) => hit({ photoId: `t${k}`, url, urls: [url], lane: 'headshot', source: 'commons', qids: ['Q22686'], tags: [], overlap: 0 })) : []));
  const bank: PhotoBank = { reader, offer: () => {}, drain: async () => {} };
  const req: PhotoRequest = { kind: 'person', query: 'Donald Trump', subjects: [{ name: 'Donald Trump', type: 'person' }], storyDate: '2026-10-04', sourceUrls: [], exclude: new Set() };
  const used = async () => ({ urls: new Set(BANK_TRUMP), phashes: [], dhashes: [] });
  const photo = await createLivePhotoFinder({ jev, http: createFakeHttp(SIF_WEB).http, bank, used }).find(req);
  assert.equal(photo?.src, commonsUrl('Donald Trump official portrait.jpg'));
  assert.equal(reader.asked.length, 1, 'the bank is asked once; the fallback is online only');
  assert.ok(reader.invalidated >= 1);

  // The bank's photos are free: one of them is picked (searchVisual's bankOnly test covers the skipped web).
  const free = fakeReader('first', (q) => (q.qid === 'Q22686' ? BANK_TRUMP.map((url, k) => hit({ photoId: `t${k}`, url, urls: [url], lane: 'headshot', source: 'commons', qids: ['Q22686'], tags: [], overlap: 0 })) : []));
  const ok = await createLivePhotoFinder({ jev, http: createFakeHttp(SIF_WEB).http, bank: { reader: free, offer: () => {}, drain: async () => {} } }).find(req);
  assert.ok(BANK_TRUMP.includes(ok!.src));
});
