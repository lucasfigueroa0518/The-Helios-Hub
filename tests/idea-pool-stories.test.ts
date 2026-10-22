/**
 * The idea pool standard on the Stories build (spec 2026-10-21), offline on PGlite with the real stories and
 * social_hub schemas: a series' pool comes in the queue's order (pins in the order pinned, archived ideas gone, a
 * dragged idea at its key among the scores) per series, and a failed read of the moves leaves the pool as it was.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { inQueueOrder } from '@/lib/stories/build';
import { openPool, refreshStoryPool, type PoolReads } from '@/lib/stories/pool';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

import { harnessDb } from './stories-harness';

const NOW = new Date('2026-10-09T14:00:00Z');
const story = (slug: string): StoryCandidate => ({ key: `news.test/${slug}`, origin: 'reels', ref: slug, headline: `Headline ${slug}`, sourceName: 'News Test', url: `https://news.test/${slug}`, body: 'body', publishedAt: null, nativeScore: 1 });
const reads = (slugs: string[]): PoolReads => ({
  morning: async () => ({ reels: slugs.map(story), carousel: [] }),
  numbers: async () => ({ numbers: [], unbriefed: [] }),
  leads: async () => [],
});

async function pool() {
  const { db } = await harnessDb();
  await refreshStoryPool(db, reads(['a', 'b', 'c', 'd']), NOW);
  // A fixed ranking: a 90, b 80, c 70, d 60.
  for (const [slug, score] of [['a', 90], ['b', 80], ['c', 70], ['d', 60]] as const) await db.query(`UPDATE stories.pool SET score = $2 WHERE series = 'morning_download' AND key = $1`, [`news.test/${slug}`, score]);
  return db;
}
const move = (db: Awaited<ReturnType<typeof pool>>, series: string, slug: string, kind: string, extra: { key?: number; at?: string } = {}) =>
  db.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, sort_key, created_at) VALUES ('stories', $1, '2026-10-09', $2, $3, $4)`, [`stories:pool:${series}:news.test/${slug}`, kind, extra.key ?? null, extra.at ?? '2026-10-09T10:00:00Z']);
const order = async (db: Awaited<ReturnType<typeof pool>>, series = 'morning_download') =>
  (await inQueueOrder(db, series, await openPool(db, series as never))).stories.map((s) => s.ref).join('');

test('no moves: the pool as it ranks', async () => {
  const db = await pool();
  assert.equal(await order(db), 'abcd');
});

test('pins lead in the order pinned; archived ideas are gone; a dragged idea sits at its key', async () => {
  const db = await pool();
  await move(db, 'morning_download', 'd', 'pin', { at: '2026-10-09T10:00:00Z' });
  await move(db, 'morning_download', 'c', 'pin', { at: '2026-10-09T11:00:00Z' });
  assert.equal(await order(db), 'dcab');
  await move(db, 'morning_download', 'a', 'archive');
  assert.equal(await order(db), 'dcb');
  await move(db, 'morning_download', 'b', 'place', { key: 95 });
  assert.equal(await order(db), 'dcb', 'a placement on a story that is already first among the unpinned changes nothing');
});

test('a placement slots a story in by its key', async () => {
  const db = await pool();
  await move(db, 'morning_download', 'd', 'place', { key: 75 });
  assert.equal(await order(db), 'abdc');
});

test('another series’ moves do not touch this series’ pool', async () => {
  const db = await pool();
  await move(db, 'free_vs_paid', 'd', 'pin');
  assert.equal(await order(db), 'abcd');
});

test('a failed read of the moves leaves the pool as it was', async () => {
  const db = await pool();
  await db.query(`DROP TABLE social_hub.idea_adjustments`);
  assert.equal(await order(db), 'abcd');
});

test('a refresh holds a series to 30 open ideas: the lowest-scored go, a pinned or dragged idea never does, an archived one does not count', async () => {
  const { db } = await harnessDb();
  const slugs = Array.from({ length: 34 }, (_, i) => `s${String(i).padStart(2, '0')}`);
  await refreshStoryPool(db, reads(slugs), NOW);
  const count = async () => Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM stories.pool WHERE series = 'morning_download' AND used_at IS NULL`)).rows[0]!.n);
  assert.equal(await count(), 30, 'the first refresh already holds the cap');
  const kept = (await db.query<{ key: string }>(`SELECT key FROM stories.pool WHERE series = 'morning_download' ORDER BY score DESC NULLS LAST, title`)).rows.map((r) => r.key);
  // Pin and drag the two lowest, archive the top one: the cap keeps them and does not count the archived one.
  const low = kept.slice(-2);
  const idea = (key: string) => `stories:pool:morning_download:${key}`;
  await db.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('stories', $1, '2026-10-09', 'pin'), ('stories', $2, '2026-10-09', 'place'), ('stories', $3, '2026-10-09', 'archive')`, [idea(low[0]!), idea(low[1]!), idea(kept[0]!)]);
  await db.query(`UPDATE stories.pool SET score = score + 1000 WHERE series = 'morning_download' AND key = $1`, [kept[1]!]);
  await refreshStoryPool(db, reads(slugs), new Date(NOW.getTime() + 3_600_000));
  const after = (await db.query<{ key: string }>(`SELECT key FROM stories.pool WHERE series = 'morning_download'`)).rows.map((r) => r.key);
  assert.ok(after.includes(low[0]!) && after.includes(low[1]!), 'pinned and dragged ideas survive');
  assert.ok(after.length >= 30 && after.length <= 33, `30 counted + the archived one + the protected ones, not ${after.length}`);
});
