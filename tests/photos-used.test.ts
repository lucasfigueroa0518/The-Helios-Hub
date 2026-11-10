/**
 * CI-32's used-photo guard (lib/photos/used-guard.ts) on top of the ledger (lib/photos/used.ts), offline: the URL check,
 * the hash check on a pick's downloaded bytes, the brand-asset exemption, the retry rule, and a failure never blocking.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { EMPTY_LEDGER, type UsedLedger } from '@/lib/photos/used';
import { firstUnused, guardPick, GUARD_RETRIES, memoLedger, usedReason } from '@/lib/photos/used-guard';

const PUBLISHED = 'f0f0f0f0f0f0f0f0';
const NEAR = 'f0f0f0f0f0f0f0f1';
const FAR = '0f0f0f0f0f0f0f0f';
const ledger: UsedLedger = { urls: new Set(['https://img.test/used.jpg']), phashes: [PUBLISHED], dhashes: [] };

/** Fake web: the body of each URL is its own name; the hash is read from a table by URL. */
function web(hashOf: Record<string, string>) {
  const fetched: string[] = [];
  const http = (async (u: string) => {
    fetched.push(String(u));
    return String(u).includes('broken') ? new Response('no', { status: 500 }) : new Response(String(u));
  }) as unknown as typeof fetch;
  const hash = async (bytes: Buffer) => {
    const h = hashOf[bytes.toString()] ?? FAR;
    return { phash: h, dhash: '0000000000000000' };
  };
  return { http, hash, fetched };
}

test('usedReason: the URL check, then the picture; brand assets exempt; no download when nothing is hashed', async () => {
  const { http, hash, fetched } = web({ 'https://img.test/copy.jpg': NEAR });
  assert.match((await usedReason(ledger, { url: 'https://img.test/used.jpg' }, { http, hash }))!, /same URL/);
  assert.equal(fetched.length, 0, 'a URL hit needs no download');
  assert.match((await usedReason(ledger, { url: 'https://img.test/copy.jpg' }, { http, hash }))!, /same picture/, 'a resized copy at another URL');
  assert.equal(await usedReason(ledger, { url: 'https://img.test/fresh.jpg' }, { http, hash }), null);
  assert.equal(await usedReason(ledger, { url: 'https://img.test/used.jpg', kind: 'logo' }, { http, hash }), null, 'a logo is a brand asset');
  const before = fetched.length;
  assert.equal(await usedReason(EMPTY_LEDGER, { url: 'https://img.test/copy.jpg' }, { http, hash }), null);
  assert.equal(fetched.length, before, 'an empty ledger needs no download');
});

test('usedReason: reuses bytes already downloaded; a failed download or hash never blocks a pick', async () => {
  const { http, hash, fetched } = web({ 'kept-bytes': NEAR });
  assert.match((await usedReason(ledger, { url: 'https://img.test/x.jpg', bytes: Buffer.from('kept-bytes') }, { http, hash }))!, /same picture/);
  assert.equal(fetched.length, 0, 'the bytes in hand are hashed');
  assert.equal(await usedReason(ledger, { url: 'https://img.test/broken.jpg' }, { http, hash }), null, 'a 500 never blocks');
  const throwing = async () => {
    throw new Error('bad image');
  };
  assert.equal(await usedReason(ledger, { url: 'https://img.test/a.jpg' }, { http, hash: throwing }), null, 'a hash error never blocks');
  assert.equal(await usedReason(ledger, { url: 'https://img.test/a.jpg' }, {}), null, 'no http: the URL check only');
});

test('firstUnused: a URL hit is skipped for free, a hash hit gives way to the next candidate, at most 1 + GUARD_RETRIES hash hits', async () => {
  const hits = { 'https://img.test/h1.jpg': NEAR, 'https://img.test/h2.jpg': NEAR, 'https://img.test/h3.jpg': NEAR };
  const { http, hash } = web(hits);
  const view = (u: string) => ({ url: u });
  const notes: string[] = [];
  assert.equal(await firstUnused(['https://img.test/used.jpg', 'https://img.test/h1.jpg', 'https://img.test/ok.jpg'], view, ledger, { http, hash }, notes), 'https://img.test/ok.jpg');
  assert.equal(notes.length, 2);
  assert.equal(GUARD_RETRIES, 2);
  assert.equal(await firstUnused(['https://img.test/h1.jpg', 'https://img.test/h2.jpg', 'https://img.test/h3.jpg', 'https://img.test/ok.jpg'], view, ledger, { http, hash }), null, 'three hash hits: the slot goes without');
});

test('guardPick: a hash hit asks the finder again with that URL excluded; past the retries, no photo', async () => {
  const { http, hash } = web({ 'https://img.test/a.jpg': NEAR, 'https://img.test/b.jpg': NEAR, 'https://img.test/c.jpg': NEAR });
  const order = ['https://img.test/a.jpg', 'https://img.test/b.jpg', 'https://img.test/ok.jpg'];
  const asked: string[][] = [];
  const finder = async (exclude: ReadonlySet<string>) => {
    asked.push([...exclude]);
    return order.find((u) => !exclude.has(u)) ?? null;
  };
  const notes: string[] = [];
  assert.equal(await guardPick(finder, (u) => ({ url: u }), ledger, { http, hash, notes }), 'https://img.test/ok.jpg');
  assert.deepEqual(asked, [[], ['https://img.test/a.jpg'], ['https://img.test/a.jpg', 'https://img.test/b.jpg']]);
  assert.equal(notes.length, 2);

  const always = ['https://img.test/a.jpg', 'https://img.test/b.jpg', 'https://img.test/c.jpg', 'https://img.test/ok.jpg'];
  let calls = 0;
  const stubborn = async (exclude: ReadonlySet<string>) => (calls++, always.find((u) => !exclude.has(u)) ?? null);
  assert.equal(await guardPick(stubborn, (u) => ({ url: u }), ledger, { http, hash }), null);
  assert.equal(calls, 1 + GUARD_RETRIES);
});

test('memoLedger: one read shared; a failed read is tried again', async () => {
  let reads = 0;
  const once = memoLedger(async () => (reads++, ledger));
  await Promise.all([once(), once()]);
  assert.equal(reads, 1);
  let fails = 1;
  const flaky = memoLedger(async () => {
    if (fails-- > 0) throw new Error('down');
    return ledger;
  });
  await assert.rejects(flaky());
  assert.equal(await flaky(), ledger);
});

test('AI Events: a poster published in the last 20 days, by URL or by picture, takes the no-image path; other posters stay', async () => {
  const { withoutUsedPosters } = await import('@/lib/ai-events/run');
  type City = Parameters<typeof withoutUsedPosters>[0][number];
  const pick = (id: string, image: string | null) => ({ id, image }) as unknown as City['picks'][number];
  const cities = [{ metro: 'miami', picks: [pick('a', 'https://img.test/used.jpg'), pick('b', 'https://img.test/new.jpg'), pick('c', null), pick('d', 'https://img.test/resized-copy.jpg'), pick('e', 'https://img.test/broken.jpg')], remainingCount: 0 }] as unknown as City[];
  const { http, hash, fetched } = web({ 'https://img.test/resized-copy.jpg': NEAR });
  const out = await withoutUsedPosters(cities, ledger, { http, hash });
  assert.deepEqual(out[0]!.picks.map((p) => p.image), [null, 'https://img.test/new.jpg', null, null, 'https://img.test/broken.jpg']);
  assert.ok(!fetched.includes('https://img.test/used.jpg'), 'a URL hit needs no download');
  assert.equal(cities[0]!.picks[0]!.image, 'https://img.test/used.jpg', 'the input is unchanged');
});

// ── Before db/social_used_photos_v2.sql (no phash/dhash/vertical/media_id columns) ──

const missingColumn = () => Object.assign(new Error('column "phash" does not exist'), { code: '42703' });

test('readUsedLedger: a 42703 falls back to URL-only rows written by a publish path', async () => {
  const { readUsedLedger } = await import('@/lib/photos/used');
  const asked: string[] = [];
  const query = async (text: string) => {
    asked.push(text);
    if (text.includes('phash')) throw missingColumn();
    return { rows: [{ url: 'https://img.test/a.jpg' }, { url: null }] };
  };
  const l = await readUsedLedger(query as never, new Date('2026-11-10T00:00:00Z'));
  assert.deepEqual([[...l.urls], l.phashes, l.dhashes], [['https://img.test/a.jpg'], [], []]);
  assert.equal(asked.length, 2);
  assert.match(asked[1]!, /story_id LIKE 'lfd:%' OR story_id LIKE 'stories:%'/, 'the legacy read keeps published rows only');
  // Any other error is not swallowed.
  await assert.rejects(readUsedLedger((async () => { throw Object.assign(new Error('down'), { code: '08006' }); }) as never, new Date()), /down/);
});

test('recordUsedPhotos: a 42703 writes every row with the pre-CI-32 columns, asking the new columns once', async () => {
  const { recordUsedPhotos } = await import('@/lib/photos/used');
  const writes: Array<{ text: string; params: unknown[] }> = [];
  let tried = 0;
  const query = async (text: string, params: unknown[] = []) => {
    if (text.includes('vertical, media_id, phash, dhash')) throw (tried++, missingColumn());
    writes.push({ text, params });
    return { rows: [] };
  };
  const at = new Date('2026-11-09T14:10:00Z');
  const n = await recordUsedPhotos(query as never, [
    { url: 'https://img.test/a.jpg', usedAt: at, vertical: 'carousels', postId: 'p1', slide: 2, phash: PUBLISHED, dhash: FAR },
    { url: 'https://img.test/b.jpg', usedAt: at, vertical: 'carousels', postId: 'p1', slide: 3 },
  ]);
  assert.equal(n, 2);
  assert.equal(tried, 1, 'the new columns are asked once');
  assert.equal(writes.length, 2);
  assert.ok(writes.every((w) => !/phash/.test(w.text) && w.params.length === 9));
  assert.deepEqual(writes.map((w) => [w.params[0], w.params[2], w.params[3]]), [['https://img.test/a.jpg', 'carousels:p1', 2], ['https://img.test/b.jpg', 'carousels:p1', 3]]);
  await assert.rejects(recordUsedPhotos((async () => { throw new Error('down'); }) as never, [{ url: 'u', usedAt: at, vertical: 'lfd', postId: 'x', slide: 1 }]), /down/);
});
