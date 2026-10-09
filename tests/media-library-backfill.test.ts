/**
 * Photo bank backfill and the passive import (DECISIONS_LOG D49):
 * social.used_photos rows into the bank on PGlite. Nothing reaches the
 * network: downloads are a stub, the bucket is in memory.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { fromFileEntries, importUsedPhotos, readWatermark } from '@/lib/media-library/backfill';
import { createPhotoBank } from '@/lib/media-library/bank';
import { runIngest } from '@/lib/media-library/ingest';
import type { Query } from '@/lib/media-library/types';
import { memoryBucket, openBankTestDb, setSetting, stubHttp, testImage } from './fixtures/media-library/pglite';

async function seed(query: Query) {
  await query(
    `INSERT INTO social.used_photos (url, used_at, story_id, slide, source, qid, subject, credit, scene) VALUES
      ('https://stock.test/clock.jpg', '2026-10-01T03:00:00Z', 'story-a', 5, 'stock', NULL, NULL, 'Snap, CC0 · via StockSnap', 'wall clock'),
      ('https://upload.wikimedia.org/trump.jpg', '2026-10-01T03:00:00Z', 'story-a', 2, 'commons', 'Q22686', 'Donald Trump', 'Shealah Craighead, public domain · Wikimedia Commons', NULL),
      ('https://cdn.test/agency.jpg', '2026-10-02T03:00:00Z', 'story-b', 3, 'article', NULL, NULL, 'Photo: John Smith', NULL),
      ('https://stock.test/server.jpg', '2026-10-03T03:00:00Z', 'stories:set-1', 4, 'stories', NULL, NULL, 'Jane, CC BY · via flickr', 'opener')`,
  );
}

const count = async (query: Query, table: string) => Number((await query(`SELECT count(*)::int AS n FROM media_library.${table}`)).rows[0].n);

test('import: used sightings for every row, sources for the ones the policy keeps, the watermark moves; a second run changes nothing', async () => {
  const { query } = await openBankTestDb();
  await seed(query);
  const r = await importUsedPhotos(query);
  assert.deepEqual([r.read, r.sightings, r.sources, r.skipped.length], [4, 4, 3, 1]);
  assert.match(r.skipped[0]!.reason, /not allowed|not recognised/, 'an unrecognised article credit is not stored');
  const maxId = Number((await query(`SELECT max(id) AS m FROM social.used_photos`)).rows[0].m);
  assert.equal(await readWatermark(query), maxId);
  const sightings = (await query(`SELECT url, run_kind, run_ref, outcome, vision, verified, qid FROM media_library.sightings ORDER BY url`)).rows;
  assert.ok(sightings.every((s) => s.run_kind === 'backfill' && s.outcome === 'used'));
  const clock = sightings.find((s) => s.url === 'https://stock.test/clock.jpg');
  assert.deepEqual(clock.vision, { scene: 'wall clock', pass: true, inferred: true }, 'a published carousel stock photo passed its close-up');
  const story = sightings.find((s) => s.url === 'https://stock.test/server.jpg');
  assert.deepEqual([story.run_ref, story.vision], ['stories:set-1', null], 'Stories never ran the close-up check');
  const trump = sightings.find((s) => s.qid === 'Q22686');
  assert.equal(trump.verified, true);
  const lanes = (await query(`SELECT url, lane, licence, reuse_ok FROM media_library.photo_sources ORDER BY url`)).rows.map((s) => [s.url, s.lane, s.licence, s.reuse_ok]);
  assert.deepEqual(lanes, [
    ['https://stock.test/clock.jpg', 'stocksnap', 'open', true],
    ['https://stock.test/server.jpg', null, 'open', true],
    ['https://upload.wikimedia.org/trump.jpg', 'headshot', 'open', true],
  ]);
  const again = await importUsedPhotos(query);
  assert.deepEqual([again.read, again.watermark], [0, null]);
  assert.deepEqual([await count(query, 'sightings'), await count(query, 'photo_sources')], [4, 3]);
});

test('dry run writes nothing; --since picks rows by date and leaves the watermark; file rows join', async () => {
  const { query } = await openBankTestDb();
  await seed(query);
  const dry = await importUsedPhotos(query, { dryRun: true });
  assert.deepEqual([dry.read, dry.sources, dry.dryRun], [4, 3, true]);
  assert.deepEqual([await count(query, 'sightings'), await count(query, 'photo_sources'), await readWatermark(query)], [0, 0, 0]);
  const since = await importUsedPhotos(query, { since: new Date('2026-10-02T00:00:00Z') });
  assert.equal(since.read, 2);
  assert.equal(await readWatermark(query), 0, '--since never moves the watermark');
  const file = fromFileEntries([{ url: 'https://stock.test/old.jpg', usedAt: '2026-09-20T03:00:00Z', storyId: 'story-z', slide: 3, source: 'stock', credit: 'A, CC0 · via StockSnap', scene: 'pen and paper' }]);
  const withFile = await importUsedPhotos(query, { since: new Date('2030-01-01'), fileRows: file });
  assert.deepEqual([withFile.read, withFile.sources], [1, 1]);
});

test('ingest after the import: what resolves is stored with its inferred close-up pass; dead links are gone, their sightings kept', async () => {
  const { query } = await openBankTestDb();
  await seed(query);
  await importUsedPhotos(query);
  const { http } = stubHttp({
    'https://stock.test/clock.jpg': { body: await testImage({ seed: 21 }) },
    'https://upload.wikimedia.org/trump.jpg': { status: 404 },
    'https://stock.test/server.jpg': { body: await testImage({ seed: 22 }) },
  });
  const stats = await runIngest({ query, bucket: memoryBucket(), http });
  assert.deepEqual(stats, { stored: 2, failed: 0, gone: 1, skipped: 0 });
  const photos = (await query(`SELECT p.vision_pass, p.tags, p.scenes, s.url FROM media_library.photos p JOIN media_library.photo_sources s ON s.photo_id = p.id ORDER BY s.url`)).rows;
  assert.deepEqual(photos.map((p) => [p.url, p.vision_pass]), [['https://stock.test/clock.jpg', true], ['https://stock.test/server.jpg', false]]);
  assert.deepEqual(photos[0].tags, ['wall', 'clock']);
  assert.deepEqual(photos[0].scenes, ['wall clock']);
  assert.equal((await query(`SELECT count(*)::int AS n FROM media_library.sightings WHERE url = 'https://upload.wikimedia.org/trump.jpg'`)).rows[0].n, 1);
});

test('the bank drain imports used_photos past the watermark (passive) only while capture is on', async () => {
  const { query } = await openBankTestDb();
  await seed(query);
  const { http } = stubHttp({
    'https://stock.test/clock.jpg': { body: await testImage({ seed: 31 }) },
    'https://upload.wikimedia.org/trump.jpg': { body: await testImage({ seed: 32 }) },
    'https://stock.test/server.jpg': { body: await testImage({ seed: 33 }) },
  });
  await createPhotoBank({ query, bucket: memoryBucket(), http }).drain(10_000);
  assert.equal(await count(query, 'sightings'), 0, 'capture off: no import');
  await setSetting(query, 'capture', true);
  await createPhotoBank({ query, bucket: memoryBucket(), http }).drain(20_000);
  assert.equal(await count(query, 'sightings'), 4);
  assert.equal(await count(query, 'photos'), 3);
  assert.ok((await readWatermark(query)) > 0);
});
