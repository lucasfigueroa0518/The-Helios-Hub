/**
 * Photo bank ingest (DECISIONS_LOG D49): the photo_sources outbox on PGlite,
 * with test images made by sharp, a stubbed HTTP and an in-memory bucket.
 * Nothing reaches the network or Storage.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createPhotoBank } from '@/lib/media-library/bank';
import { claimNext, dhashOf, MAX_ATTEMPTS, runIngest } from '@/lib/media-library/ingest';
import { writeRows } from '@/lib/media-library/store';
import type { Query, SightingRow, SourceRow } from '@/lib/media-library/types';
import { memoryBucket, openBankTestDb, setSetting, stubHttp, testImage } from './fixtures/media-library/pglite';

const src = (url: string, over: Partial<SourceRow> = {}): SourceRow => ({ url, source: 'stock', lane: 'stocksnap', title: 'server room', date: null, credit: 'Snap, CC0 · via StockSnap', licence: 'open', reuse_ok: true, ...over });
const seen = (url: string, over: Partial<SightingRow> = {}): SightingRow => ({
  url, run_kind: 'carousel', run_ref: 'story-1', slide: 2, request_query: 'server racks', request_kind: 'thematic', request_qid: null, qid: null, subject: null, verified: false,
  outcome: 'picked', vision: { scene: 'server racks', pass: true, what_it_shows: 'rows of servers' }, tile_tags: ['server racks'], fit: 0.9, faces: null, plate: null, at: '2026-10-08T03:00:00Z', ...over,
});
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const sources = async (query: Query) => (await query(`SELECT url, status, attempts, photo_id, last_error, last_ok_at FROM media_library.photo_sources ORDER BY url`)).rows;

test('pending → stored: sha256 of the original bytes, true size, master and thumbnail in the bucket, tags from the sightings', async () => {
  const { query } = await openBankTestDb();
  const bytes = await testImage({ seed: 3, width: 64, height: 48 });
  await writeRows(query, { sources: [src('https://img.test/a.jpg')], sightings: [seen('https://img.test/a.jpg')] });
  const bucket = memoryBucket();
  const { http, calls } = stubHttp({ 'https://img.test/a.jpg': { body: bytes } });
  const stats = await runIngest({ query, bucket, http });
  assert.deepEqual(stats, { stored: 1, failed: 0, gone: 0, skipped: 0 });
  assert.deepEqual(calls, ['https://img.test/a.jpg']);
  const [p] = (await query(`SELECT * FROM media_library.photos`)).rows;
  const h = sha(bytes);
  assert.equal(p.sha256, h);
  assert.equal(p.dhash, await dhashOf(bytes));
  assert.match(p.dhash, /^[0-9a-f]{16}$/);
  assert.deepEqual([p.width, p.height, p.bytes, p.mime], [64, 48, bytes.byteLength, 'image/jpeg']);
  assert.equal(p.master_path, `originals/${h.slice(0, 2)}/${h}.jpg`);
  assert.equal(p.thumb_path, `thumbs/${h.slice(0, 2)}/${h}.jpg`);
  assert.deepEqual([...bucket.objects.keys()].sort(), [p.master_path, p.thumb_path].sort());
  assert.deepEqual([p.licence, p.reuse_ok, p.vision_pass, p.status], ['open', true, true, 'stored']);
  assert.deepEqual(p.tags, ['server racks', 'server', 'racks', 'rows', 'servers']);
  assert.deepEqual(p.scenes, ['server racks']);
  const [s] = await sources(query);
  assert.deepEqual([s.status, s.attempts, s.photo_id, s.last_error], ['stored', 1, p.id, null]);
  assert.ok(s.last_ok_at);
});

test('true size follows the EXIF orientation', async () => {
  const { query } = await openBankTestDb();
  const sharp = (await import('sharp')).default;
  const turned = await sharp(await testImage({ seed: 4, width: 64, height: 48 })).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  await writeRows(query, { sources: [src('https://img.test/turned.jpg')], sightings: [] });
  await runIngest({ query, bucket: memoryBucket(), http: stubHttp({ 'https://img.test/turned.jpg': { body: turned } }).http });
  const [p] = (await query(`SELECT width, height FROM media_library.photos`)).rows;
  assert.deepEqual([p.width, p.height], [48, 64]);
});

test('the same bytes at two URLs: one photo, two sources, one upload pair; the most permissive licence wins', async () => {
  const { query } = await openBankTestDb();
  const bytes = await testImage({ seed: 5 });
  await writeRows(query, {
    sources: [src('https://a.test/x.jpg', { source: 'article', lane: 'article', credit: 'Courtesy of OpenAI', licence: 'company', reuse_ok: false }), src('https://b.test/y.jpg')],
    sightings: [seen('https://a.test/x.jpg'), seen('https://b.test/y.jpg')],
  });
  const bucket = memoryBucket();
  const stats = await runIngest({ query, bucket, http: stubHttp({ 'https://a.test/x.jpg': { body: bytes }, 'https://b.test/y.jpg': { body: bytes } }).http });
  assert.equal(stats.stored, 2);
  const photos = (await query(`SELECT id, licence, reuse_ok, credit FROM media_library.photos`)).rows;
  assert.equal(photos.length, 1);
  assert.equal(bucket.uploads, 2, 'master + thumbnail, once');
  assert.deepEqual([photos[0].licence, photos[0].reuse_ok, photos[0].credit], ['open', true, 'Snap, CC0 · via StockSnap']);
  assert.deepEqual((await sources(query)).map((s) => [s.status, s.photo_id]), [['stored', photos[0].id], ['stored', photos[0].id]]);
});

test('404 → gone; not an image → skipped; neither retried', async () => {
  const { query } = await openBankTestDb();
  await writeRows(query, { sources: [src('https://img.test/dead.jpg'), src('https://img.test/page.html')], sightings: [] });
  const stats = await runIngest({ query, bucket: memoryBucket(), http: stubHttp({ 'https://img.test/dead.jpg': { status: 404 }, 'https://img.test/page.html': { body: Buffer.from('<html>'), type: 'text/html' } }).http });
  assert.deepEqual(stats, { stored: 0, failed: 0, gone: 1, skipped: 1 });
  assert.deepEqual((await sources(query)).map((s) => s.status), ['gone', 'skipped']);
  assert.equal(await claimNext(query), null);
});

test('a throwing bucket: failed, attempts + 1, backed off, no photo row, nothing thrown', async () => {
  const { query } = await openBankTestDb();
  await writeRows(query, { sources: [src('https://img.test/a.jpg')], sightings: [] });
  const logs: string[] = [];
  const stats = await runIngest({ query, bucket: memoryBucket({ fail: true }), http: stubHttp({ 'https://img.test/a.jpg': { body: await testImage() } }).http, log: (l) => logs.push(l) });
  assert.deepEqual(stats, { stored: 0, failed: 1, gone: 0, skipped: 0 });
  const [s] = (await query(`SELECT status, attempts, last_error, next_attempt_at > now() AS later FROM media_library.photo_sources`)).rows;
  assert.deepEqual([s.status, s.attempts, s.last_error, s.later], ['failed', 1, 'bucket down', true]);
  assert.equal((await query(`SELECT count(*)::int AS n FROM media_library.photos`)).rows[0].n, 0);
  assert.ok(logs.some((l) => /bucket down/.test(l)));
  // After its back-off, it is tried again; after MAX_ATTEMPTS it stays failed.
  await query(`UPDATE media_library.photo_sources SET next_attempt_at = now() - interval '1 minute', attempts = $1`, [MAX_ATTEMPTS]);
  assert.equal(await claimNext(query), null, 'no attempts left');
});

test('idempotent: a second run fetches nothing; re-offering a stored URL does not download it again', async () => {
  const { query } = await openBankTestDb();
  const bytes = await testImage({ seed: 7 });
  await writeRows(query, { sources: [src('https://img.test/a.jpg')], sightings: [seen('https://img.test/a.jpg')] });
  const bucket = memoryBucket();
  const stub = stubHttp({ 'https://img.test/a.jpg': { body: bytes } });
  await runIngest({ query, bucket, http: stub.http });
  assert.deepEqual(await runIngest({ query, bucket, http: stub.http }), { stored: 0, failed: 0, gone: 0, skipped: 0 });
  await writeRows(query, { sources: [src('https://img.test/a.jpg')], sightings: [seen('https://img.test/a.jpg', { run_ref: 'story-2', tile_tags: ['data center'] })] });
  await runIngest({ query, bucket, http: stub.http });
  assert.equal(stub.calls.length, 1);
  assert.equal(bucket.uploads, 2);
  const [p] = (await query(`SELECT tags FROM media_library.photos`)).rows;
  assert.ok(p.tags.includes('data center'), 'a new sighting retags the stored photo without a download');
  assert.equal((await query(`SELECT count(*)::int AS n FROM media_library.sightings`)).rows[0].n, 2);
});

test('a source stuck in fetching for over 10 minutes is claimed again', async () => {
  const { query } = await openBankTestDb();
  await writeRows(query, { sources: [src('https://img.test/a.jpg'), src('https://img.test/b.jpg')], sightings: [] });
  await query(`UPDATE media_library.photo_sources SET status = 'fetching', attempts = 1, claimed_at = now() - interval '11 minutes' WHERE url = 'https://img.test/a.jpg'`);
  await query(`UPDATE media_library.photo_sources SET status = 'fetching', attempts = 1, claimed_at = now() - interval '2 minutes' WHERE url = 'https://img.test/b.jpg'`);
  const stats = await runIngest({ query, bucket: memoryBucket(), http: stubHttp({ 'https://img.test/a.jpg': { body: await testImage({ seed: 9 }) } }).http });
  assert.equal(stats.stored, 1);
  assert.deepEqual((await sources(query)).map((s) => [s.url, s.status, s.attempts]), [['https://img.test/a.jpg', 'stored', 2], ['https://img.test/b.jpg', 'fetching', 1]]);
});

test('the bank: offer() is synchronous and does nothing while capture is off; drain() never throws', async () => {
  const { query } = await openBankTestDb();
  const bucket = memoryBucket();
  const bytes = await testImage({ seed: 11 });
  const stub = stubHttp({ 'https://img.test/a.jpg': { body: bytes } });
  const item = {
    slide: 2, request: { kind: 'thematic' as const, query: 'server racks' }, outcome: 'picked' as const, tileTags: ['server racks'], fit: 0.9, vision: { scene: 'server racks', pass: true, verdict: null },
    candidate: { url: 'https://img.test/a.jpg', credit: 'Snap, CC0 · via StockSnap', source: 'stock' as const, width: 64, height: 48, qid: null, subject: null, lane: 'stocksnap' as const, date: null, title: 'servers', verified: false },
  };
  const off = createPhotoBank({ query, bucket, http: stub.http });
  assert.equal(off.offer({ runKind: 'carousel', runRef: 's1', subjects: [], items: [item] }), undefined);
  await off.drain(5_000);
  assert.equal((await query(`SELECT count(*)::int AS n FROM media_library.sightings`)).rows[0].n, 0, 'capture off: nothing written');
  await setSetting(query, 'capture', true);
  const on = createPhotoBank({ query, bucket, http: stub.http });
  on.offer({ runKind: 'carousel', runRef: 's1', subjects: [], items: [item] });
  await on.drain(10_000);
  assert.equal((await query(`SELECT count(*)::int AS n FROM media_library.photos`)).rows[0].n, 1);
  // A broken database: offer and drain still never throw.
  const broken = createPhotoBank({ query: async () => { throw new Error('db down'); }, bucket, http: stub.http, log: () => { throw new Error('logger down'); } });
  broken.offer({ runKind: 'carousel', runRef: 's1', subjects: [], items: [item] });
  await broken.drain(1_000);
});
