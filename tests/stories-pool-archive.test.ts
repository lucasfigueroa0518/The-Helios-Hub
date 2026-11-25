/**
 * Stories' pool clean-up archives instead of deleting (Tommy, 2026-11-16: "Yes, archive them"), offline on PGlite with
 * the real stories and social_hub schemas plus db/stories_pool_archive.sql. Stale, not-returned and over-cap rows are
 * stamped archived_at, are never offered to a build and never count toward the 30 cap. A row the refresh archived comes
 * back when the intake returns it again (as a deleted row used to be re-inserted); a person's Archive
 * (social_hub.idea_adjustments) keeps it out regardless. Before the migration the refresh deletes as it did.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { openLocalStoriesDb } from '@/lib/stories/local-db';
import { FRESH_MS, openPool, refreshStoryPool, type PoolReads } from '@/lib/stories/pool';
import type { StoryCandidate } from '@/lib/stories/sources/reels';
import { STORY_POOL_SQL } from '@/lib/social-hub/queries/stories';

const NOW = new Date('2026-11-16T14:00:00Z');
const story = (slug: string): StoryCandidate => ({ key: `news.test/${slug}`, origin: 'reels', ref: slug, headline: `Headline ${slug}`, sourceName: 'News Test', url: `https://news.test/${slug}`, body: 'body', publishedAt: null, nativeScore: 1 });
// Free vs. Paid is retired (SS-27): the refresh reads only Morning Download; `broken` makes its sources unreadable.
const reads = (slugs: string[], md: 'ok' | 'broken' = 'ok'): PoolReads => ({
  morning: async () => {
    if (md === 'broken') throw new Error('unreachable');
    return { reels: slugs.map(story), carousel: [] };
  },
  leads: async () => [],
});
type Db = Awaited<ReturnType<typeof openLocalStoriesDb>>['db'];
const rows = async (db: Db, series = 'morning_download') =>
  (await db.query<{ key: string; archived: boolean; reason: string | null }>(
    `SELECT key, archived_at IS NOT NULL AS archived, archived_reason AS reason FROM stories.pool WHERE series = $1 ORDER BY key`,
    [series],
  )).rows;

test('a key the refresh did not return is archived, not deleted, and a later refresh that finds it again reopens it', async () => {
  const { db } = await openLocalStoriesDb();
  const first = await refreshStoryPool(db, reads(['a', 'b', 'c']), NOW);
  assert.equal(first.upserted, 3, 'three stories');
  const r = await refreshStoryPool(db, reads(['a', 'b']), new Date(NOW.getTime() + 86_400_000));
  assert.equal(r.dropped, 1);
  assert.deepEqual(await rows(db), [
    { key: 'news.test/a', archived: false, reason: null },
    { key: 'news.test/b', archived: false, reason: null },
    { key: 'news.test/c', archived: true, reason: 'not-returned' },
  ]);
  assert.deepEqual((await openPool(db, 'morning_download')).stories.map((s) => s.ref), ['a', 'b']);
  // c comes back in the sources: the refresh archived it, so the refresh reopens it, and the hub's read shows it again.
  const back = await refreshStoryPool(db, reads(['a', 'b', 'c']), new Date(NOW.getTime() + 2 * 86_400_000));
  assert.equal(back.upserted, 3, 'c is written again with a and b');
  assert.deepEqual((await rows(db)).find((x) => x.key === 'news.test/c'), { key: 'news.test/c', archived: false, reason: null });
  assert.deepEqual((await openPool(db, 'morning_download')).stories.map((s) => s.ref).sort(), ['a', 'b', 'c']);
  const hub = (await db.query<{ key: string }>(STORY_POOL_SQL)).rows.filter((x) => x.key.startsWith('news.test/')).map((x) => x.key).sort();
  assert.deepEqual(hub, ['news.test/a', 'news.test/b', 'news.test/c']);
});

test('a stale row the intake returns again is reopened', async () => {
  const { db } = await openLocalStoriesDb();
  await refreshStoryPool(db, reads(['a']), NOW);
  await refreshStoryPool(db, reads([], 'broken'), new Date(NOW.getTime() + FRESH_MS.morning_download + 3_600_000));
  assert.deepEqual((await rows(db)).map((x) => [x.archived, x.reason]), [[true, 'stale']]);
  await refreshStoryPool(db, reads(['a']), new Date(NOW.getTime() + FRESH_MS.morning_download + 7_200_000));
  assert.deepEqual((await rows(db)).map((x) => [x.archived, x.reason]), [[false, null]]);
  assert.equal((await openPool(db, 'morning_download')).stories.length, 1);
});

test('a row archived for another reason is not touched by the refresh, and upserted counts only the rows written', async () => {
  const { db } = await openLocalStoriesDb();
  await refreshStoryPool(db, reads(['a', 'b']), NOW);
  await db.query(`UPDATE stories.pool SET archived_at = $1::timestamptz, archived_reason = 'manual' WHERE key = 'news.test/b'`, [NOW.toISOString()]);
  const r = await refreshStoryPool(db, reads(['a', 'b']), new Date(NOW.getTime() + 3_600_000));
  // a is written; b is left archived.
  assert.equal(r.upserted, 1);
  assert.deepEqual((await rows(db)).find((x) => x.key === 'news.test/b'), { key: 'news.test/b', archived: true, reason: 'manual' });
});

test('a person\'s Archive (idea_adjustments) keeps a reopened row out of the build\'s pool', async () => {
  const { db } = await openLocalStoriesDb();
  await refreshStoryPool(db, reads(['a', 'b', 'c']), NOW);
  await db.query(
    `INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('stories', 'stories:pool:morning_download:news.test/c', '2026-11-16', 'archive')`,
  );
  await refreshStoryPool(db, reads(['a', 'b']), new Date(NOW.getTime() + 86_400_000));
  await refreshStoryPool(db, reads(['a', 'b', 'c']), new Date(NOW.getTime() + 2 * 86_400_000));
  assert.equal((await rows(db)).find((x) => x.key === 'news.test/c')?.archived, false, 'the refresh reopens its own archive');
  assert.deepEqual((await openPool(db, 'morning_download')).stories.map((s) => s.ref).sort(), ['a', 'b'], 'the person\'s archive still holds');
});

test('a stale row (sources unreadable past the freshness window) is archived as stale', async () => {
  const { db } = await openLocalStoriesDb();
  await refreshStoryPool(db, reads(['a']), NOW);
  assert.equal((await openPool(db, 'morning_download')).stories.length, 1);
  await refreshStoryPool(db, reads([], 'broken'), new Date(NOW.getTime() + FRESH_MS.morning_download + 3_600_000));
  assert.deepEqual((await rows(db)).map((x) => [x.archived, x.reason]), [[true, 'stale']]);
  assert.equal((await openPool(db, 'morning_download')).stories.length, 0);
});

test('over the 30 cap: the lowest-scored are archived; archived rows never count toward the cap', async () => {
  const { db } = await openLocalStoriesDb();
  const slugs = Array.from({ length: 34 }, (_, i) => `s${String(i).padStart(2, '0')}`);
  await refreshStoryPool(db, reads(slugs), NOW);
  const all = await rows(db);
  assert.equal(all.length, 34, 'nothing deleted');
  assert.equal(all.filter((x) => x.archived).length, 4);
  assert.ok(all.filter((x) => x.archived).every((x) => x.reason === 'over-cap'));
  assert.equal((await openPool(db, 'morning_download')).stories.length, 30);
  // A new idea arrives: the refresh reopens the 4 it archived (the intake returned them), and the cap archives the
  // lowest 5 of the 35: the pool stays at 30 and nothing is deleted.
  await refreshStoryPool(db, reads([...slugs, 's99']), new Date(NOW.getTime() + 3_600_000));
  const after = await rows(db);
  assert.equal(after.length, 35, 'still nothing deleted');
  assert.equal(after.filter((x) => x.archived).length, 5);
  assert.equal((await openPool(db, 'morning_download')).stories.length, 30);
});

test('before db/stories_pool_archive.sql the refresh deletes as it did', async () => {
  const { db } = await openLocalStoriesDb(undefined, { poolArchive: false });
  await refreshStoryPool(db, reads(['a', 'b', 'c']), NOW);
  const r = await refreshStoryPool(db, reads(['a', 'b']), new Date(NOW.getTime() + 86_400_000));
  assert.equal(r.dropped, 1);
  const keys = (await db.query<{ key: string }>(`SELECT key FROM stories.pool WHERE series = 'morning_download' ORDER BY key`)).rows.map((x) => x.key);
  assert.deepEqual(keys, ['news.test/a', 'news.test/b']);
  assert.deepEqual((await openPool(db, 'morning_download')).stories.map((s) => s.ref), ['a', 'b']);
});
