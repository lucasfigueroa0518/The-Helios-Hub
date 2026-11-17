/**
 * The photo bank for the Stories Split (SS-24), on PGlite with the real schemas plus db/media_library_stories_split.sql:
 * the migration re-applies, Real or AI?'s pooled candidates are stored from their bytes (offerHeld), a real find is
 * served to every type, and an AI image (licence `generated`) is never served to another type: only to a caller that
 * asks with allowGenerated (Real or AI?), never to Reel AI Drama's lookup.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createPhotoBank } from '@/lib/media-library/bank';
import { lookupForDrama } from '@/lib/media-library/drama';
import type { HeldPhoto } from '@/lib/media-library/held';
import { createBankReader } from '@/lib/media-library/reader';
import { REAL_OR_AI_LANE } from '@/lib/media-library/types';
import { memoryBucket, openBankTestDb, setSetting, testImage } from './fixtures/media-library/pglite';

const migration = () =>
  readFileSync(path.join(process.cwd(), 'db', 'media_library_stories_split.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('\\'))
    .join('\n');

test('migration: re-applies twice on live-shaped data; generated, truth and the new run kinds are allowed', async () => {
  const { pg, query } = await openBankTestDb();
  await query(
    `INSERT INTO media_library.photos (sha256, master_path, thumb_path, mime, bytes, width, height, credit, licence, reuse_ok)
     VALUES ($1, 'm', 't', 'image/jpeg', 1, 10, 10, 'x, CC0', 'open', true)`,
    ['a'.repeat(64)],
  );
  await pg.exec(migration());
  await pg.exec(migration());
  await query(
    `INSERT INTO media_library.photos (sha256, master_path, thumb_path, mime, bytes, width, height, credit, licence, reuse_ok, truth, gen_model, gen_prompt)
     VALUES ($1, 'm', 't', 'image/jpeg', 1, 10, 10, 'AI image', 'generated', false, 'ai', 'gpt-image-2', 'a goat')`,
    ['b'.repeat(64)],
  );
  await assert.rejects(
    query(`INSERT INTO media_library.photos (sha256, master_path, thumb_path, mime, bytes, width, height, credit, licence, reuse_ok) VALUES ($1, 'm', 't', 'image/jpeg', 1, 10, 10, 'AI', 'generated', true)`, ['c'.repeat(64)]),
    /photos_generated_not_reusable/,
  );
  await assert.rejects(
    query(`INSERT INTO media_library.photos (sha256, master_path, thumb_path, mime, bytes, width, height, credit, licence, truth) VALUES ($1, 'm', 't', 'image/jpeg', 1, 10, 10, 'x', 'open', 'maybe')`, ['d'.repeat(64)]),
    /photos_truth_check/,
  );
  for (const kind of ['ai_trivia', 'real_or_ai']) {
    await query(
      `INSERT INTO media_library.sightings (url, run_kind, run_ref, slide, request_query, outcome) VALUES ('https://x/1.jpg', $1, 'r', 1, 'q', 'picked')`,
      [kind],
    );
  }
  await query(`INSERT INTO media_library.photo_sources (url, licence) VALUES ('storage:stories/roa/x.jpg', 'generated')`);
});

const held = (over: Partial<HeldPhoto> & Pick<HeldPhoto, 'url' | 'bytes'>): HeldPhoto => ({
  source: 'commons-search',
  lane: 'commons-search',
  title: 'Mirror lake',
  date: '2019',
  credit: 'Jane Doe / Wikimedia Commons',
  licence: 'open',
  reuseOk: true,
  request: 'mirror lake mountains',
  requestKind: 'nature_weather',
  shows: 'A mirror lake under mountains',
  slide: 1,
  outcome: 'picked',
  pass: true,
  ...over,
});

async function bankWithBoth() {
  const { query } = await openBankTestDb();
  await setSetting(query, 'capture', true);
  await setSetting(query, 'finder_source', 'compete');
  const bucket = memoryBucket();
  const lines: string[] = [];
  const bank = createPhotoBank({ query, bucket, http: (async () => { throw new Error('no download expected'); }) as typeof fetch, log: (l) => lines.push(l) });
  const real = await testImage({ seed: 3, width: 900, height: 1600 });
  const ai = await testImage({ seed: 9, width: 900, height: 1600 });
  bank.offerHeld({ runKind: 'real_or_ai', runRef: 'roa:real1', items: [held({ url: 'https://upload.test/orig/lake.jpg', bytes: real, truth: 'real' })] });
  bank.offerHeld({
    runKind: 'real_or_ai',
    runRef: 'roa:ai1',
    items: [held({ url: 'storage:stories/roa/candidates/ai1.jpg', bytes: ai, source: 'generated', lane: REAL_OR_AI_LANE, credit: 'AI image (gpt-image-2), Real or AI?', licence: 'generated', reuseOk: true, truth: 'ai', genModel: 'gpt-image-2', genPrompt: 'Hobbyist photo of a mirror lake under mountains', shows: 'Hobbyist photo of a mirror lake under mountains' })],
  });
  await bank.drain(10_000);
  return { query, bucket, lines };
}

test('offerHeld: a real find and an AI image are stored from their bytes, with truth, model and prompt; no download', async () => {
  const { query, bucket, lines } = await bankWithBoth();
  const { rows } = await query(
    `SELECT p.licence, p.reuse_ok, p.truth, p.gen_model, p.gen_prompt, p.vision_pass, s.url, s.status, s.lane
       FROM media_library.photos p JOIN media_library.photo_sources s ON s.photo_id = p.id ORDER BY s.url`,
  );
  assert.equal(rows.length, 2, lines.join('\n'));
  const [real, ai] = [rows.find((r) => r.url.startsWith('https://'))!, rows.find((r) => r.url.startsWith('storage:'))!];
  assert.deepEqual([real.licence, real.reuse_ok, real.truth, real.status, real.lane, real.vision_pass], ['open', true, 'real', 'stored', 'commons-search', true]);
  assert.deepEqual([ai.licence, ai.reuse_ok, ai.truth, ai.gen_model, ai.lane], ['generated', false, 'ai', 'gpt-image-2', REAL_OR_AI_LANE], 'an AI image is never reusable, whatever the caller asked');
  assert.equal(ai.gen_prompt, 'Hobbyist photo of a mirror lake under mountains');
  assert.equal(bucket.uploads, 4, 'a master and a thumbnail each');
  const sightings = (await query(`SELECT run_kind, run_ref FROM media_library.sightings ORDER BY run_ref`)).rows;
  assert.deepEqual(sightings.map((s) => [s.run_kind, s.run_ref]), [['real_or_ai', 'roa:ai1'], ['real_or_ai', 'roa:real1']]);
});

test('reader: other types get the real find and never the AI image; allowGenerated (Real or AI?) gets both; AI Drama never gets it', async () => {
  const { query } = await bankWithBoth();
  const reader = createBankReader({ query });
  const ask = { kind: 'thematic' as const, query: 'mirror lake', qid: null, recent: new Set<string>(), cover: false, limit: 10 };
  const others = await reader.find(ask);
  assert.deepEqual(others.map((h) => h.url), ['https://upload.test/orig/lake.jpg']);
  assert.equal(others[0]!.licence, 'open');
  const roa = await reader.find({ ...ask, allowGenerated: true });
  assert.deepEqual(roa.map((h) => h.url).sort(), ['https://upload.test/orig/lake.jpg', 'storage:stories/roa/candidates/ai1.jpg']);
  assert.equal(roa.find((h) => h.url.startsWith('storage:'))!.licence, 'generated');
  const drama = await lookupForDrama(query, { qids: [], words: ['mirror', 'lake'], limit: 10 });
  assert.deepEqual(drama.map((h) => h.url), ['https://upload.test/orig/lake.jpg']);
});

test('offerHeld: nothing while capture is off; a failing store is logged and never throws', async () => {
  const { query } = await openBankTestDb();
  const lines: string[] = [];
  const bank = createPhotoBank({ query, bucket: memoryBucket({ fail: true }), log: (l) => lines.push(l) });
  const bytes = await testImage({ seed: 5 });
  bank.offerHeld({ runKind: 'real_or_ai', runRef: 'roa:x', items: [held({ url: 'https://upload.test/a.jpg', bytes })] });
  await bank.drain(5_000);
  assert.equal((await query(`SELECT count(*)::int AS n FROM media_library.photos`)).rows[0].n, 0);
  await setSetting(query, 'capture', true);
  const bank2 = createPhotoBank({ query, bucket: memoryBucket({ fail: true }), log: (l) => lines.push(l), settingsTtlMs: 0 });
  assert.doesNotThrow(() => bank2.offerHeld({ runKind: 'real_or_ai', runRef: 'roa:x', items: [held({ url: 'https://upload.test/a.jpg', bytes })] }));
  await bank2.drain(5_000);
  assert.ok(lines.some((l) => /bucket down/.test(l)), lines.join('\n'));
});
