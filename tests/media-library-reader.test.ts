/**
 * The photo bank as a finder source, its reader (DECISIONS_LOG D49): SELECT
 * only, on PGlite with the real schemas. Which photos may answer which
 * request kind, the order, and the 7-day rule.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createBankReader, type BankFind } from '@/lib/media-library/reader';
import type { Query } from '@/lib/media-library/types';
import { openBankTestDb, setSetting } from './fixtures/media-library/pglite';

let n = 0;
/** A stored photo with its sources (lane per URL), straight into the tables. */
async function photo(query: Query, opts: { urls: Array<{ url: string; lane: string; source?: string; okDaysAgo?: number }>; tags?: string[]; qids?: string[]; reuse?: boolean; vision?: boolean; width?: number; height?: number; seenDaysAgo?: number; status?: string }): Promise<string> {
  n++;
  const sha = n.toString(16).padStart(64, '0');
  const { rows } = await query(
    `INSERT INTO media_library.photos (sha256, master_path, thumb_path, mime, bytes, width, height, credit, licence, reuse_ok, qids, tags, vision_pass, status, last_seen_at)
     VALUES ($1, 'm', 't', 'image/jpeg', 1, $2, $3, 'credit, CC0', 'open', $4, $5::text[], $6::text[], $7, $8, now() - make_interval(days => $9)) RETURNING id`,
    [sha, opts.width ?? 2000, opts.height ?? 1500, opts.reuse ?? true, opts.qids ?? [], opts.tags ?? [], opts.vision ?? true, opts.status ?? 'stored', opts.seenDaysAgo ?? 0],
  );
  const id = rows[0].id as string;
  for (const u of opts.urls) {
    await query(
      `INSERT INTO media_library.photo_sources (url, photo_id, source, lane, title, credit, licence, reuse_ok, status, last_ok_at)
       VALUES ($1, $2, $3, $4, 'title', 'credit, CC0', 'open', true, 'stored', now() - make_interval(days => $5))`,
      [u.url, id, u.source ?? 'stock', u.lane, u.okDaysAgo ?? 0],
    );
  }
  return id;
}

const ask = (over: Partial<BankFind>): BankFind => ({ kind: 'thematic', query: 'server racks', qid: null, recent: new Set(), cover: false, limit: 10, ...over });

test('mode: off until finder_source is flipped; off when the schema is absent', async () => {
  const { query } = await openBankTestDb();
  assert.equal(await createBankReader({ query }).mode(), 'off');
  await setSetting(query, 'finder_source', 'compete');
  assert.equal(await createBankReader({ query }).mode(), 'compete');
  await setSetting(query, 'finder_source', 'nonsense');
  assert.equal(await createBankReader({ query }).mode(), 'off');
  const bare = await openBankTestDb({ withBank: false });
  assert.equal(await createBankReader({ query: bare.query }).mode(), 'off');
});

test('scenes by tag overlap: most shared words first, then the bigger image; only reusable, close-up-passed searched scenes', async () => {
  const { query } = await openBankTestDb();
  const one = await photo(query, { urls: [{ url: 'https://s/one.jpg', lane: 'stocksnap' }], tags: ['server', 'room'], width: 4000, height: 3000 });
  const two = await photo(query, { urls: [{ url: 'https://s/two.jpg', lane: 'openverse' }], tags: ['server racks', 'server', 'racks'], width: 1000, height: 800 });
  await photo(query, { urls: [{ url: 'https://s/notreuse.jpg', lane: 'stocksnap' }], tags: ['server', 'racks'], reuse: false });
  await photo(query, { urls: [{ url: 'https://s/novision.jpg', lane: 'stocksnap' }], tags: ['server', 'racks'], vision: false });
  await photo(query, { urls: [{ url: 'https://s/headshot.jpg', lane: 'headshot', source: 'commons' }], tags: ['server', 'racks'] });
  await photo(query, { urls: [{ url: 'https://s/article.jpg', lane: 'article', source: 'article' }], tags: ['server', 'racks'] });
  await photo(query, { urls: [{ url: 'https://s/old.jpg', lane: 'stocksnap', okDaysAgo: 9 }], tags: ['server', 'racks'] });
  await photo(query, { urls: [{ url: 'https://s/removed.jpg', lane: 'stocksnap' }], tags: ['server', 'racks'], status: 'removed' });
  await photo(query, { urls: [{ url: 'https://s/fruit.jpg', lane: 'stocksnap' }], tags: ['apple', 'fruit'] });
  const hits = await createBankReader({ query }).find(ask({ query: 'server racks' }));
  assert.deepEqual(hits.map((h) => h.photoId), [two, one], 'two words shared beat one; reuse_ok false, no close-up pass, other lanes, stale or removed: out');
  assert.deepEqual([hits[0]!.overlap, hits[1]!.overlap], [2, 1]);
  assert.equal(hits[0]!.url, 'https://s/two.jpg', 'the original URL is offered');
  assert.equal(hits[0]!.lane, 'openverse', 'the original lane is kept');
  assert.deepEqual(await createBankReader({ query }).find(ask({ query: 'the of a' })), [], 'no words, no match');
});

test('the 7-day rule: a photo is out when any of its URLs is in the run’s recent set or in social.used_photos this week', async () => {
  const { query } = await openBankTestDb();
  const fresh = await photo(query, { urls: [{ url: 'https://s/fresh.jpg', lane: 'stocksnap' }], tags: ['clock'] });
  await photo(query, { urls: [{ url: 'https://s/a.jpg', lane: 'stocksnap' }, { url: 'https://other/a-copy.jpg', lane: 'openverse' }], tags: ['clock'] });
  await photo(query, { urls: [{ url: 'https://s/recent.jpg', lane: 'stocksnap' }], tags: ['clock'] });
  const old = await photo(query, { urls: [{ url: 'https://s/old-use.jpg', lane: 'stocksnap' }], tags: ['clock'] });
  await query(`INSERT INTO social.used_photos (url, used_at, story_id, slide) VALUES ('https://other/a-copy.jpg', now() - interval '2 days', 's', 2), ('https://s/old-use.jpg', now() - interval '9 days', 's', 2)`);
  const hits = await createBankReader({ query }).find(ask({ query: 'wall clock', recent: new Set(['https://s/recent.jpg']) }));
  assert.deepEqual(hits.map((h) => h.photoId).sort(), [fresh, old].sort());
});

test('people by verified QID only (headshots, second photos); CEO photos never; headshots exempt from 7 days except on a cover', async () => {
  const { query } = await openBankTestDb();
  const head = await photo(query, { urls: [{ url: 'https://c/sam.jpg', lane: 'headshot', source: 'commons' }], qids: ['Q1'] });
  await photo(query, { urls: [{ url: 'https://c/sam-ceo.jpg', lane: 'ceo', source: 'ceo' }], qids: ['Q1'] });
  await photo(query, { urls: [{ url: 'https://c/other.jpg', lane: 'headshot', source: 'commons' }], qids: ['Q2'] });
  await photo(query, { urls: [{ url: 'https://c/sam-second.jpg', lane: 'second', source: 'second' }], qids: ['Q1'] });
  await query(`INSERT INTO social.used_photos (url, used_at, story_id, slide) VALUES ('https://c/sam.jpg', now() - interval '1 day', 's', 3), ('https://c/sam-second.jpg', now() - interval '1 day', 's', 4)`);
  const reader = createBankReader({ query });
  assert.deepEqual((await reader.find(ask({ kind: 'person', query: 'Sam Altman', qid: 'Q1' }))).map((h) => h.photoId), [head], 'a story slide: the used headshot is fine; a second photo used this week is not');
  assert.deepEqual(await reader.find(ask({ kind: 'person', query: 'Sam Altman', qid: 'Q1', cover: true })), [], 'a cover never repeats a headshot within 7 days');
  assert.deepEqual(await reader.find(ask({ kind: 'person', query: 'Sam Altman', qid: null })), [], 'never by name');
  for (const kind of ['event', 'product'] as const) assert.deepEqual(await reader.find(ask({ kind, query: 'server racks', qid: 'Q1' })), [], `${kind}: never`);
});

test('companies: headquarters by QID; logos exempt from 7 days but only when seen within 90 days', async () => {
  const { query } = await openBankTestDb();
  const hq = await photo(query, { urls: [{ url: 'https://c/hq.jpg', lane: 'hq', source: 'hq' }], qids: ['Q9'] });
  const logo = await photo(query, { urls: [{ url: 'https://c/logo.png', lane: 'logo', source: 'logo' }], qids: ['Q9'] });
  await photo(query, { urls: [{ url: 'https://c/old-logo.png', lane: 'logo', source: 'logo' }], qids: ['Q8'], seenDaysAgo: 120 });
  await query(`INSERT INTO social.used_photos (url, used_at, story_id, slide) VALUES ('https://c/logo.png', now() - interval '1 day', 's', 1)`);
  const reader = createBankReader({ query });
  assert.deepEqual((await reader.find(ask({ kind: 'company', query: 'OpenAI', qid: 'Q9' }))).map((h) => h.photoId), [hq]);
  assert.deepEqual((await reader.find(ask({ kind: 'logo', query: 'OpenAI', qid: 'Q9' }))).map((h) => h.photoId), [logo], 'used yesterday, still a logo');
  assert.deepEqual(await reader.find(ask({ kind: 'logo', query: 'Old Co', qid: 'Q8' })), [], 'not seen within 90 days');
});
