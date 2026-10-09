/**
 * The photo bank as a finder source (DECISIONS_LOG D49): searchVisual with
 * and without a bank reader. Offline: Wikidata and Commons are the photo
 * fixtures' fake, Jev and Openverse are stubs, the bank reader is a fake.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { commonsUrl, createFakeHttp, SIF_WEB } from '@/fixtures/social/photo-http';
import type { BankFind, BankHit, BankReader } from '@/lib/media-library/reader';
import type { FinderSourceMode } from '@/lib/media-library/types';
import type { JevAnswer, JevAsk } from '@/lib/social/jev/client';
import * as Identity from '@/lib/social/jev/questions/subject-identity.v1';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v4';
import { newSearchContext, searchVisual, type PhotoDeps, type StockSearch } from '@/lib/social/photos/find';
import { orderHits } from '@/lib/social/photos/sources/bank';
import type { VisualRequest } from '@/lib/social/writer/draft';

const IDENTITY: Record<string, { person: number; match: (d: string) => number }> = {
  'Donald Trump': { person: 0.98, match: (d) => (d.includes('president') ? 0.96 : 0.02) },
  'Jay Clayton': { person: 0.97, match: (d) => (d.includes('SEC') ? 0.93 : 0.03) },
  'Acme AI': { person: 0.02, match: (d) => (d.includes('company') ? 0.95 : 0.02) },
};

/** The fixture web plus one organization with no logo or photo on Wikidata. */
const WEB = {
  ...SIF_WEB,
  search: { ...SIF_WEB.search, 'Acme AI': ['Q777'] },
  entities: { ...SIF_WEB.entities, Q777: { id: 'Q777', label: 'Acme AI', description: 'artificial intelligence company', human: false, organization: true, files: [] } },
};

const jev: JevAsk = async (req, meta) => {
  const answers: Record<string, JevAnswer> = {};
  if (meta.version === Identity.VERSION) {
    const state = req.state as ReturnType<typeof Identity.buildState>;
    const a = IDENTITY[state.subject.name];
    if (!a) throw new Error(`stub: no identity for ${state.subject.name}`);
    answers.is_person = { noul: a.person };
    state.candidates.forEach((c, k) => (answers[Identity.matchId(k)] = { noul: a.match(c.description) }));
  } else if (meta.version === Prescreen.VERSION) {
    const state = req.state as ReturnType<typeof Prescreen.buildState>;
    state.candidates.forEach((_, k) => {
      answers[Prescreen.fitId(k)] = { noul: 0.9 };
      answers[Prescreen.peopleId(k)] = { noul: 0.05 };
    });
  } else throw new Error(`stub: unexpected ${meta.version}`);
  return { answers, usage: { input_tokens: 300, output_tokens: 0 }, model: 'stub-jev' };
};

/** Openverse stub: two results per query; counts its calls. */
function stock(calls: string[]): StockSearch {
  return async (q) => {
    calls.push(q);
    return [1, 2].map((i) => ({ url: `https://stock.example/${q.replace(/\W+/g, '-')}-${i}.jpg`, foreignLandingUrl: '', mime: 'image/jpeg', width: 2400, height: 1600, license: 'cc0', creator: 'A', source: 'stocksnap', title: `${q} ${i}`, tags: [] }));
  };
}

const hit = (over: Partial<BankHit>): BankHit => ({ photoId: 'p', url: 'https://bank.test/x.jpg', urls: ['https://bank.test/x.jpg'], source: 'stock', lane: 'stocksnap', credit: 'Snap, CC0 · via StockSnap', title: 'servers', date: null, width: 3000, height: 2000, qids: [], subjects: [], tags: ['server', 'racks'], overlap: 2, faces: null, plate: null, ...over });

function fakeReader(mode: FinderSourceMode, hits: (q: BankFind) => BankHit[]): BankReader & { asked: BankFind[]; modes: number } {
  const r = {
    asked: [] as BankFind[],
    modes: 0,
    async mode() {
      r.modes++;
      return mode;
    },
    async find(q: BankFind) {
      r.asked.push(q);
      return hits(q);
    },
  };
  return r;
}

const v = (kind: VisualRequest['kind'], query: string): VisualRequest => ({ kind, query });
const ctx = (recent = new Set<string>()) => {
  const brief = briefSuperIntelligenceForce();
  return newSearchContext(brief, [], { recent, storyDate: '2026-10-04' });
};
const deps = (over: Partial<PhotoDeps> = {}, calls: string[] = []): PhotoDeps => ({ jev, http: createFakeHttp(WEB).http, stock: stock(calls), commons: async () => [], ...over });

test('no bank, or a bank switched off: searchVisual returns exactly what it does today', async () => {
  const cases: Array<[VisualRequest, { tags?: string[] }]> = [[v('thematic', 'server racks'), {}], [v('person', 'Donald Trump'), { tags: ['S1'] }], [v('logo', 'Donald Trump'), {}]];
  for (const [request, slide] of cases) {
    const plain = await searchVisual(request, ctx(), deps(), slide);
    const off = fakeReader('off', () => [hit({})]);
    const withOff = await searchVisual(request, ctx(), deps({ bank: off }), slide);
    assert.deepEqual(withOff, plain, `${request.kind}: identical`);
    assert.equal(off.asked.length, 0, 'an "off" bank is never searched');
  }
});

test('compete: bank scenes join the online ones with their own lane and source, unverified (they get the close-up again)', async () => {
  const calls: string[] = [];
  const reader = fakeReader('compete', () => [hit({ url: 'https://bank.test/big.jpg', width: 6000, height: 4000 })]);
  const r = await searchVisual(v('thematic', 'server racks'), ctx(), deps({ bank: reader }, calls));
  const banked = r.candidates.find((c) => c.url === 'https://bank.test/big.jpg');
  assert.ok(banked, 'the bigger bank photo ranks in');
  assert.deepEqual([banked.lane, banked.source, banked.verified, banked.qid], ['stocksnap', 'stock', false, null]);
  assert.ok(calls.length > 0, 'compete: the online search still runs');
  assert.ok(r.steps.some((s) => /^bank \(compete\) thematic/.test(s)));
});

test('the 7-day rule still applies to bank candidates (searchVisual’s own recent filter)', async () => {
  const reader = fakeReader('compete', () => [hit({ url: 'https://bank.test/recent.jpg', width: 9000, height: 6000 })]);
  const r = await searchVisual(v('thematic', 'server racks'), ctx(new Set(['https://bank.test/recent.jpg'])), deps({ bank: reader }));
  assert.ok(!r.candidates.some((c) => c.url === 'https://bank.test/recent.jpg'));
  assert.equal(reader.asked[0]!.recent.has('https://bank.test/recent.jpg'), true, 'the reader is given the recent set too');
});

test('first: once the bank has enough, the online sources are skipped', async () => {
  const calls: string[] = [];
  const reader = fakeReader('first', () => [hit({ url: 'https://bank.test/1.jpg' }), hit({ url: 'https://bank.test/2.jpg', overlap: 1 })]);
  const r = await searchVisual(v('setting', 'server racks'), ctx(), deps({ bank: reader }, calls));
  assert.deepEqual(r.candidates.map((c) => c.url).sort(), ['https://bank.test/1.jpg', 'https://bank.test/2.jpg']);
  assert.deepEqual(calls, [], 'no Openverse search');
  assert.ok(r.steps.some((s) => /skipped \(the photo bank had enough\)/.test(s)));
  // Only one usable bank photo: the online search runs.
  const one = fakeReader('first', () => [hit({ url: 'https://bank.test/1.jpg' })]);
  const calls2: string[] = [];
  await searchVisual(v('setting', 'server racks'), ctx(), deps({ bank: one }, calls2));
  assert.ok(calls2.length > 0);
});

test('person: the bank is searched by the verified Wikidata id, never by name; a failed identity asks nothing', async () => {
  const reader = fakeReader('compete', (q) => (q.qid === 'Q22686' ? [hit({ url: 'https://bank.test/trump.jpg', lane: 'headshot', source: 'commons', qids: ['Q22686'], tags: [] })] : []));
  const r = await searchVisual(v('person', 'Donald Trump'), ctx(), deps({ bank: reader }), { tags: ['S1'] });
  assert.equal(reader.asked[0]!.qid, 'Q22686');
  const banked = r.candidates.find((c) => c.url === 'https://bank.test/trump.jpg');
  assert.ok(banked);
  assert.deepEqual([banked.lane, banked.verified, banked.qid, banked.subject], ['headshot', true, 'Q22686', 'Donald Trump']);
  assert.ok(r.candidates.some((c) => c.url === commonsUrl('Donald Trump official portrait.jpg')), 'the online headshot still competes');
  const none = fakeReader('compete', () => [hit({})]);
  await searchVisual(v('person', 'Nobody Known'), ctx(), deps({ bank: none, jev: async () => { throw new Error('no identity'); } }));
  assert.equal(none.asked.length, 0);
});

test('product and event never ask the bank', async () => {
  const reader = fakeReader('compete', () => [hit({})]);
  await searchVisual(v('product', 'ChatGPT app'), ctx(), deps({ bank: reader }));
  await searchVisual(v('event', 'Senate hearing'), ctx(), deps({ bank: reader }));
  assert.equal(reader.asked.length, 0);
});

test('logo: the bank is a fallback, asked by the verified organization id only when the online sources leave nothing usable', async () => {
  const reader = fakeReader('compete', (q) => (q.qid === 'Q777' ? [hit({ url: 'https://bank.test/acme-logo.png', lane: 'logo', source: 'logo', qids: ['Q777'], tags: [], plate: 'light', width: 800, height: 300 })] : []));
  const r = await searchVisual(v('logo', 'Acme AI'), ctx(), deps({ bank: reader }));
  assert.equal(reader.asked.length, 1);
  assert.deepEqual([reader.asked[0]!.kind, reader.asked[0]!.qid], ['logo', 'Q777']);
  assert.deepEqual(r.candidates.map((c) => [c.url, c.lane, c.verified, c.plate]), [['https://bank.test/acme-logo.png', 'logo', true, 'light']]);
  const plainLogo = await searchVisual(v('logo', 'Acme AI'), ctx(), deps());
  assert.deepEqual(plainLogo.candidates, [], 'without the bank: nothing (the icon)');
});

test('bank order: most shared tags, then least recently used, then the bigger image', () => {
  const lastUsed = new Map([['https://b/used-long-ago.jpg', '2026-09-01T00:00:00Z'], ['https://b/used-lately.jpg', '2026-09-30T00:00:00Z']]);
  const hits = [
    hit({ photoId: 'lately', urls: ['https://b/used-lately.jpg'], overlap: 1 }),
    hit({ photoId: 'never', urls: ['https://b/never.jpg'], overlap: 1, width: 100, height: 100 }),
    hit({ photoId: 'long-ago', urls: ['https://b/used-long-ago.jpg'], overlap: 1 }),
    hit({ photoId: 'best', urls: ['https://b/best.jpg'], overlap: 3 }),
  ];
  assert.deepEqual(orderHits(hits, lastUsed).map((h) => h.photoId), ['best', 'never', 'long-ago', 'lately']);
});
