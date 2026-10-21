/**
 * Ruling R25: the Stories live-set indexes are deploy-order safe in both directions.
 * db/stories_schema.sql adds the per-slot index and keeps the one-a-day index, so
 * pre-redesign code (ON CONFLICT (series, ny_date)) and new code (target-less
 * ON CONFLICT DO NOTHING) both work; db/stories_multi_slot.sql later drops only the
 * one-a-day index. Offline (PGlite).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { MULTI_SLOT_PATH, openLocalStoriesDb, schemaSql } from '@/lib/stories/local-db';
import { requestSet } from '@/lib/stories/repository';

const DAY = '2026-10-21';
const LIVE = `status NOT IN ('rejected', 'failed', 'skipped')`;

type Pg = Awaited<ReturnType<typeof openLocalStoriesDb>>['pg'];
type Db = Awaited<ReturnType<typeof openLocalStoriesDb>>['db'];

/** The INSERT the deployed pre-redesign worker and hub run (lib/stories/repository.ts at 9e0a54e7). */
const oldRequest = (pg: Pg) => pg.query<{ id: string }>(
  `INSERT INTO stories.sets (series, ny_date, trigger, style, requested_by, mode)
   VALUES ('morning_download', $1, 'auto', 'polished', NULL, 'production')
   ON CONFLICT (series, ny_date) WHERE ${LIVE} DO NOTHING
   RETURNING id`, [DAY]);

const indexes = async (pg: Pg) => Object.fromEntries((await pg.query<{ indexname: string; indexdef: string }>(
  `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'stories' AND indexname LIKE 'uq_stories_sets_live_%'`)).rows
  .map((r) => [r.indexname, r.indexdef]));

const slotSet = (db: Db, slotMinute: number | null) =>
  requestSet(db, { series: 'morning_download', nyDate: DAY, trigger: 'auto', style: 'polished', slotMinute });

const liveCount = async (pg: Pg) => (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.sets WHERE ${LIVE}`)).rows[0]!.n;

/** A database that got the earlier build of stories_schema.sql: the day index dropped, the slot key under the day name. */
async function earlierBuild(pg: Pg) {
  await pg.exec(`DROP INDEX stories.uq_stories_sets_live_day;
    ALTER INDEX stories.uq_stories_sets_live_slot RENAME TO uq_stories_sets_live_day;`);
}

test('after stories_schema.sql, both indexes exist and the pre-redesign ON CONFLICT (series, ny_date) insert works', async () => {
  const { pg } = await openLocalStoriesDb(undefined, { multiSlot: false });
  const idx = await indexes(pg);
  assert.match(idx.uq_stories_sets_live_day!, /\(series, ny_date\)/);
  assert.doesNotMatch(idx.uq_stories_sets_live_day!, /slot_minute/);
  assert.match(idx.uq_stories_sets_live_slot!, /slot_minute/);
  assert.equal((await oldRequest(pg)).rows.length, 1, 'old code makes the day\'s set');
  assert.equal((await oldRequest(pg)).rows.length, 0, 'and a second request is a no-op, not a 42P10 error');
  assert.equal(await liveCount(pg), 1);
});

test('new-code requestSet works before stories_multi_slot.sql; a second same-day set is refused', async () => {
  const { db, pg } = await openLocalStoriesDb(undefined, { multiSlot: false });
  const a = await slotSet(db, 510);
  assert.equal(a.created, true);
  const again = await slotSet(db, 510);
  assert.equal(again.created, false);
  assert.equal(again.set.id, a.set.id);
  const second = await slotSet(db, 900);
  assert.equal(second.created, false, 'the one-a-day index holds the second slot back (DO NOTHING)');
  assert.equal(second.set.id, a.set.id, 'the day\'s live set comes back');
  assert.equal(await liveCount(pg), 1, 'no second set until the drop');
  const legacy = await slotSet(db, null);
  assert.equal(legacy.created, false, 'a legacy request finds no room either');
});

test('new-code requestSet works after stories_multi_slot.sql; a second same-day set is allowed, one per slot', async () => {
  const { db, pg } = await openLocalStoriesDb(undefined, { multiSlot: false });
  await slotSet(db, 510);
  await pg.exec(schemaSql(MULTI_SLOT_PATH));
  const idx = await indexes(pg);
  assert.equal(idx.uq_stories_sets_live_day, undefined, 'the one-a-day index is gone');
  assert.match(idx.uq_stories_sets_live_slot!, /slot_minute/, 'the slot index stays');
  const b = await slotSet(db, 900);
  assert.equal(b.created, true);
  assert.equal((await slotSet(db, 900)).created, false, 'one live set per slot');
  assert.equal(await liveCount(pg), 2);
});

test('stories_multi_slot.sql re-runs safely, and a later stories_schema.sql apply never brings the day index back', async () => {
  const { db, pg } = await openLocalStoriesDb(undefined, { multiSlot: false });
  await pg.exec(schemaSql(MULTI_SLOT_PATH));
  await pg.exec(schemaSql(MULTI_SLOT_PATH));
  await pg.exec(schemaSql());
  assert.deepEqual(Object.keys(await indexes(pg)), ['uq_stories_sets_live_slot']);
  assert.equal((await slotSet(db, 510)).created, true);
  assert.equal((await slotSet(db, 900)).created, true);
});

test('a database that got the earlier stories_schema.sql: a re-apply restores the day index when there is one set a day', async () => {
  const { pg } = await openLocalStoriesDb(undefined, { multiSlot: false });
  await earlierBuild(pg);
  await assert.rejects(oldRequest(pg), /no unique or exclusion constraint/, 'the state the final review reproduced');
  await pg.exec(schemaSql());
  await pg.exec(schemaSql());
  const idx = await indexes(pg);
  assert.doesNotMatch(idx.uq_stories_sets_live_day!, /slot_minute/);
  assert.match(idx.uq_stories_sets_live_slot!, /slot_minute/);
  assert.equal((await oldRequest(pg)).rows.length, 1);
});

test('a database that got the earlier stories_schema.sql and already holds two same-day sets: the day index is not recreated', async () => {
  const { db, pg } = await openLocalStoriesDb(undefined, { multiSlot: false });
  await earlierBuild(pg);
  assert.equal((await slotSet(db, 510)).created, true);
  assert.equal((await slotSet(db, 900)).created, true);
  await pg.exec(schemaSql());
  const idx = await indexes(pg);
  assert.equal(idx.uq_stories_sets_live_day, undefined, 'guarded: a unique (series, ny_date) index would fail on these rows');
  assert.match(idx.uq_stories_sets_live_slot!, /slot_minute/);
  assert.equal(await liveCount(pg), 2, 'rows kept');
});

test('stories_multi_slot.sql on a database that got the earlier stories_schema.sql: renames, never recreates', async () => {
  const { db, pg } = await openLocalStoriesDb(undefined, { multiSlot: false });
  await earlierBuild(pg);
  await pg.exec(schemaSql(MULTI_SLOT_PATH));
  await pg.exec(schemaSql(MULTI_SLOT_PATH));
  assert.deepEqual(Object.keys(await indexes(pg)), ['uq_stories_sets_live_slot']);
  assert.equal((await slotSet(db, 510)).created, true);
  assert.equal((await slotSet(db, 900)).created, true);
});

test('stories_multi_slot.sql drops only the one-a-day index', async () => {
  const { pg } = await openLocalStoriesDb(undefined, { multiSlot: false });
  const before = (await pg.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'stories' ORDER BY 1`)).rows.map((r) => r.indexname);
  await pg.exec(schemaSql(MULTI_SLOT_PATH));
  const after = (await pg.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'stories' ORDER BY 1`)).rows.map((r) => r.indexname);
  assert.deepEqual(before.filter((n) => !after.includes(n)), ['uq_stories_sets_live_day']);
  assert.deepEqual(after.filter((n) => !before.includes(n)), []);
});
