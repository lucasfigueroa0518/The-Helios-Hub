/**
 * The photo bank as the shared store for real photos (2026-11-03), on PGlite
 * with the real schemas: unknown licences are stored but never reach a
 * carousel; Stories and LFD imports get lanes and are findable; Reel AI
 * Drama's offers and lookups. Nothing reaches the network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { importUsedPhotos } from '@/lib/media-library/backfill';
import { createPhotoBank } from '@/lib/media-library/bank';
import { DRAMA_LANE, lookupForDrama, planDramaOffer, type DramaOfferItem } from '@/lib/media-library/drama';
import { runIngest } from '@/lib/media-library/ingest';
import { createBankReader } from '@/lib/media-library/reader';
import { writeRows } from '@/lib/media-library/store';
import type { Query } from '@/lib/media-library/types';
import { memoryBucket, openBankTestDb, setSetting, stubHttp, testImage } from './fixtures/media-library/pglite';

const LOOK = { shows: 'Sam Altman on a stage', watermark: false, tv_logo: false, ai_generated: false, faces: 1, text_heavy: false, about_story: true, key_moment: false };

const dramaItem = (over: Partial<DramaOfferItem>): DramaOfferItem => ({
  url: 'https://news.test/altman.jpg',
  source: 'serper',
  credit: 'Reuters (reuters.com)',
  sourcePage: 'https://news.test/story',
  date: '2026-10-01',
  dateBasis: 'caption',
  kind: 'person_photo',
  request: 'a photo of Sam Altman',
  shows: 'Sam Altman on a stage',
  outcome: 'picked',
  verified: [{ name: 'Sam Altman', qid: 'Q7407093' }],
  look: LOOK,
  faces: null,
  slide: 1,
  ...over,
});

async function stored(query: Query, routes: Record<string, number>) {
  const served: Record<string, { body: Buffer }> = {};
  for (const [url, seed] of Object.entries(routes)) served[url] = { body: await testImage({ seed }) };
  return runIngest({ query, bucket: memoryBucket(), http: stubHttp(served).http });
}

test('unknown licence: stored with reuse_ok false; the carousel reader never offers it, Reel AI Drama finds it', async () => {
  const { query } = await openBankTestDb();
  await setSetting(query, 'finder_source', 'compete');
  await writeRows(query, planDramaOffer({ runRef: 'job-1', subjects: ['Sam Altman', 'OpenAI'], organizations: ['OpenAI'], items: [dramaItem({})] }));
  const src = (await query(`SELECT lane, licence, reuse_ok FROM media_library.photo_sources`)).rows[0];
  assert.deepEqual([src.lane, src.licence, src.reuse_ok], [DRAMA_LANE, 'unknown', false]);
  assert.deepEqual(await stored(query, { 'https://news.test/altman.jpg': 41 }), { stored: 1, failed: 0, gone: 0, skipped: 0 });
  const p = (await query(`SELECT licence, reuse_ok, qids, subjects, vision_pass FROM media_library.photos`)).rows[0];
  assert.deepEqual([p.licence, p.reuse_ok, p.qids, p.subjects, p.vision_pass], ['unknown', false, ['Q7407093'], ['Sam Altman'], false], 'the reel look is not the carousel close-up pass');

  // Even a (hand-edited) reuse_ok row with an unknown licence stays out of carousels: the reader filters by licence too.
  await query(`UPDATE media_library.photos SET reuse_ok = true`);
  await query(`UPDATE media_library.photo_sources SET lane = 'headshot'`);
  const carousel = await createBankReader({ query }).find({ kind: 'person', query: 'Sam Altman', qid: 'Q7407093', recent: new Set(), cover: false, limit: 5 });
  assert.deepEqual(carousel, [], 'carousels and Stories get cleared licences only');

  const hits = await lookupForDrama(query, { qids: ['Q7407093'], words: [], limit: 5 });
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0]!.licence, hits[0]!.fresh, hits[0]!.verdict?.source_page, hits[0]!.verdict?.look?.watermark], ['unknown', true, 'https://news.test/story', false]);
  const stale = await lookupForDrama(query, { qids: ['Q7407093'], words: [], limit: 5 }, new Date(Date.now() + 10 * 86_400_000));
  assert.equal(stale[0]!.fresh, false, 'past the freshness window: the bank copy instead of the URL');
  assert.ok(stale[0]!.masterPath.startsWith('originals/'));
});

test('cleared photos still reach carousels; a Commons credit offered by the reel is open and reusable', async () => {
  const { query } = await openBankTestDb();
  const rows = planDramaOffer({ runRef: 'job-2', subjects: ['Sam Altman'], items: [dramaItem({ url: 'https://upload.wikimedia.org/sam.jpg', source: 'commons', credit: 'TechCrunch, CC BY 2.0 · Wikimedia Commons' })] });
  assert.deepEqual(rows.sources.map((s) => [s.licence, s.reuse_ok]), [['open', true]]);
  assert.deepEqual(rows.sightings.map((s) => [s.run_kind, s.request_query, s.verified, s.qid]), [['reel_ai_drama', 'a photo of Sam Altman', false, null], ['reel_ai_drama', 'Sam Altman', true, 'Q7407093']]);
});

test('Stories and LFD used photos get a lane and the subject their credit names, so they are findable', async () => {
  const { query } = await openBankTestDb();
  await query(
    `INSERT INTO social.used_photos (url, used_at, story_id, slide, source, credit, scene) VALUES
      ('https://upload.wikimedia.org/dario.jpg', '2026-10-03T03:00:00Z', 'stories:set-1', 2, 'stories', 'Dario Amodei, Anthropic CEO · TechCrunch, CC BY 2.0 · Wikimedia Commons', 'story'),
      ('https://news.test/lead.jpg', '2026-10-04T03:00:00Z', 'lfd:post-1', 2, 'lfd', 'Example News', 'scene'),
      ('https://memes.test/m.png', '2026-10-04T03:00:00Z', 'lfd:post-1', 3, 'lfd', 'meme', 'scene')`,
  );
  const r = await importUsedPhotos(query);
  assert.deepEqual([r.read, r.sources, r.skipped.map((s) => s.url)], [3, 2, ['https://memes.test/m.png']]);
  const lanes = (await query(`SELECT url, lane, licence, reuse_ok, title FROM media_library.photo_sources ORDER BY url`)).rows.map((s) => [s.url, s.lane, s.licence, s.reuse_ok, s.title]);
  assert.deepEqual(lanes, [
    ['https://news.test/lead.jpg', 'lfd', 'unknown', false, null],
    ['https://upload.wikimedia.org/dario.jpg', 'stories', 'open', true, 'Dario Amodei, Anthropic CEO'],
  ]);
  await stored(query, { 'https://upload.wikimedia.org/dario.jpg': 51, 'https://news.test/lead.jpg': 52 });
  const hits = await lookupForDrama(query, { qids: [], words: ['Dario Amodei'], limit: 5 });
  assert.deepEqual(hits.map((h) => [h.url, h.lane]), [['https://upload.wikimedia.org/dario.jpg', 'stories']]);
  const tags = (await query(`SELECT tags FROM media_library.photos ORDER BY id`)).rows.flatMap((p) => p.tags);
  assert.ok(!tags.includes('story') && !tags.includes('opener'), 'a frame role is not a tag');
});

test('offerDrama writes only while capture is on, and never throws', async () => {
  const { query } = await openBankTestDb();
  const bank = createPhotoBank({ query, bucket: memoryBucket(), http: stubHttp({}).http });
  bank.offerDrama({ runRef: 'job-3', subjects: [], items: [dramaItem({})] });
  await bank.drain(2_000);
  assert.equal(Number((await query(`SELECT count(*)::int AS n FROM media_library.sightings`)).rows[0].n), 0, 'capture off');
  await setSetting(query, 'capture', true);
  const on = createPhotoBank({ query, bucket: memoryBucket(), http: stubHttp({}).http });
  on.offerDrama({ runRef: 'job-3', subjects: [], items: [dramaItem({})] });
  on.offerDrama(null as never);
  await on.drain(2_000);
  assert.equal(Number((await query(`SELECT count(*)::int AS n FROM media_library.sightings WHERE run_kind = 'reel_ai_drama'`)).rows[0].n), 2);
});
