// tests/slots-set-by.test.ts
/**
 * "Set by" marks (calendar type schedules spec §4 item 1): every date edit and
 * booking records whether a person or the system set it, so a later schedule
 * save moves only the system's own bookings. Offline PGlite; no model, no network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { saveFeedback } from '@/lib/explainers/repository';
import { scheduleJob } from '@/lib/explainers/publish/schedule';
import { placeItem, rescheduleItem } from '@/lib/social-hub/placement';
import { readOverrides } from '@/lib/social-hub/slots/load';
import { overrideFor } from '@/lib/social-hub/slots/override';
import { applySlotChanges, bookingsOn, setSlotSource } from '@/lib/social-hub/slots/write';
import { pgliteDb } from '@/lib/stories/local-db';
import { getSet, rescheduleSet } from '@/lib/stories/repository';

import { scratchExplainersDb } from './explainers-pglite';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const THU_10AM = new Date('2026-10-15T14:00:00Z'); // Thu Oct 15, 10:00 AM New York
const TUE_10AM = new Date('2026-10-20T14:00:00Z'); // Tue Oct 20, 10:00 AM New York: the 8:45 reel started
const TUE_MIDNIGHT = new Date('2026-10-20T04:00:00Z'); // Tue Oct 20, midnight New York
const FRI = '2026-10-16';
const WED = '2026-10-21';
const first = () => 0;

type Pg = Awaited<ReturnType<typeof openHubTestDb>>['pg'];

async function seeded() {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 'tommy@example.com');
  return { pg, q };
}

async function itemFor(pg: Pg, vertical: string, ref: string): Promise<string> {
  const format = vertical === 'carousels' ? 'feed' : 'reel';
  return (await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ($1, $2, $3) RETURNING id::text AS id`, [vertical, format, ref])).rows[0]!.id;
}

const overrideSetBy = async (pg: Pg, nyDate: string, vertical: string, startMinute: number) =>
  (await pg.query<{ action: string; set_by: string | null }>(
    `SELECT action, set_by FROM social_hub.slot_override WHERE ny_date = $1::date AND vertical = $2 AND start_minute = $3`, [nyDate, vertical, startMinute],
  )).rows;

test('overrideFor: a person keeps an add pin where the date matches the Standard week; the system does not', () => {
  const key = { vertical: 'reels' as const, startMinute: 525, series: null };
  assert.deepEqual(overrideFor(FRI, key, { feedMode: 'trial' }, { feedMode: 'trial' }, 'system'), { op: 'delete', nyDate: FRI, ...key });
  assert.deepEqual(overrideFor(FRI, key, { feedMode: 'trial' }, { feedMode: 'trial' }, 'person'), { op: 'upsert', nyDate: FRI, ...key, action: 'add', feedMode: 'trial', setBy: 'person' });
  assert.deepEqual(overrideFor(FRI, key, { feedMode: 'trial' }, null, 'person'), { op: 'upsert', nyDate: FRI, ...key, action: 'remove', feedMode: null, setBy: 'person' });
  assert.deepEqual(overrideFor(FRI, key, undefined, null, 'person'), { op: 'delete', nyDate: FRI, ...key });
});

test('board date edits are person', async () => {
  const { pg, q } = await seeded();
  const out = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: FRI, vertical: 'explainers', startMinute: 1020, series: null, action: 'add', feedMode: 'main' }], { by: 'tommy@example.com', now: THU_10AM });
  assert.equal(out.ok, true);
  assert.deepEqual(await overrideSetBy(pg, FRI, 'explainers', 1020), [{ action: 'add', set_by: 'person' }]);
  assert.equal((await readOverrides(q, FRI, FRI))[0]!.setBy, 'person');
});

test('a person edit back to the standard time is kept', async () => {
  const { pg, q } = await seeded();
  const by = { by: 'tommy@example.com', now: THU_10AM };
  assert.equal((await applySlotChanges(q, [{ scope: 'date', op: 'move', from: { nyDate: FRI, vertical: 'reels', startMinute: 525, series: null }, to: { nyDate: FRI, startMinute: 600 } }], by)).ok, true);
  assert.equal((await applySlotChanges(q, [{ scope: 'date', op: 'move', from: { nyDate: FRI, vertical: 'reels', startMinute: 600, series: null }, to: { nyDate: FRI, startMinute: 525 } }], by)).ok, true);
  assert.deepEqual(await overrideSetBy(pg, FRI, 'reels', 525), [{ action: 'add', set_by: 'person' }]);
  assert.deepEqual(await overrideSetBy(pg, FRI, 'reels', 600), []);
  // Untouched Standard-week slots on that date get no pin.
  assert.deepEqual(await overrideSetBy(pg, FRI, 'reels', 675), []);
});

test('a booking a date drag carries becomes person; one a Standard-week move carries keeps its mark', async () => {
  const { pg, q } = await seeded();
  const bookAt = async (ref: string, slot: string, publishAt: string) => {
    const item = await itemFor(pg, 'reels', ref);
    await pg.query(
      `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
       VALUES ($1, 'reels', $2::date, $3, $4::timestamptz, 'scheduled', 'auto', 'trial')`,
      [item, FRI, slot, publishAt],
    );
    return item;
  };
  const dragged = await bookAt('r1', 't0525', '2026-10-16T12:45:00Z');
  const standard = await bookAt('r2', 't1080', '2026-10-16T22:00:00Z');
  const by = { by: 'tommy@example.com', now: THU_10AM, rng: first };
  const a = await applySlotChanges(q, [{ scope: 'date', op: 'move', from: { nyDate: FRI, vertical: 'reels', startMinute: 525, series: null }, to: { nyDate: FRI, startMinute: 600 } }], by);
  assert.equal(a.ok, true, JSON.stringify(a));
  const b = await applySlotChanges(q, [{ scope: 'template', op: 'move', from: { weekday: 5, vertical: 'reels', startMinute: 1080, series: null }, to: { weekday: 5, startMinute: 1110 } }], by);
  assert.equal(b.ok, true, JSON.stringify(b));
  const row = async (item: string) => (await pg.query<{ slot: string; slot_by: string | null }>(`SELECT slot, slot_by FROM social_hub.schedule WHERE content_item_id = $1`, [item])).rows[0]!;
  assert.deepEqual(await row(dragged), { slot: 't0600', slot_by: 'person' });
  assert.deepEqual(await row(standard), { slot: 't1110', slot_by: null });
});

test('started-today pins are system', async () => {
  const { pg, q } = await seeded();
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'delete', weekday: 2, vertical: 'reels', startMinute: 525, series: null }], { by: 't', now: TUE_10AM });
  assert.equal(out.ok, true);
  assert.deepEqual(await overrideSetBy(pg, '2026-10-20', 'reels', 525), [{ action: 'add', set_by: 'system' }]);
});

test('placement writes person', async () => {
  const { pg, q } = await seeded();
  const item = await itemFor(pg, 'explainers', 'e1');
  const placed = await placeItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0720', now: TUE_MIDNIGHT, rng: first, by: 'tommy@example.com' });
  assert.ok(placed.ok, placed.note);
  assert.deepEqual(await overrideSetBy(pg, WED, 'explainers', 720), [{ action: 'add', set_by: 'person' }]);
  const row = (await pg.query<{ slot_by: string | null; source: string }>(`SELECT slot_by, source FROM social_hub.schedule WHERE content_item_id = $1`, [item])).rows[0]!;
  assert.deepEqual([row.source, row.slot_by], ['user', 'person']);
});

test('rescheduling an auto booking makes it person', async () => {
  const { pg, q } = await seeded();
  const item = await itemFor(pg, 'explainers', 'e1');
  await pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
     VALUES ($1, 'explainers', $2::date, 't0780', '2026-10-21T17:00:00Z', 'scheduled', 'auto', 'main')`,
    [item, WED],
  );
  assert.equal((await bookingsOn(q, [WED])).find((b) => b.vertical === 'explainers')!.slotBy, 'system');
  const moved = await rescheduleItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0930', now: TUE_MIDNIGHT, rng: first, by: 'tommy@example.com' });
  assert.ok(moved.ok, moved.note);
  const row = (await pg.query<{ slot: string; slot_by: string | null; source: string }>(`SELECT slot, slot_by, source FROM social_hub.schedule WHERE content_item_id = $1`, [item])).rows[0]!;
  assert.deepEqual([row.slot, row.source, row.slot_by], ['t0930', 'auto', 'person']);
  assert.equal((await bookingsOn(q, [WED])).find((b) => b.vertical === 'explainers')!.slotBy, 'person');
});

test('a user-placed booking reads as person even without a mark', async () => {
  const { pg, q } = await seeded();
  const item = await itemFor(pg, 'explainers', 'e1');
  await pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
     VALUES ($1, 'explainers', $2::date, 't0780', '2026-10-21T17:00:00Z', 'scheduled', 'user', 'main')`,
    [item, WED],
  );
  assert.equal((await bookingsOn(q, [WED]))[0]!.slotBy, 'person');
});

test('overnight bookings stay system', async () => {
  const { db } = await scratchExplainersDb();
  const { rows: t } = await db.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status) VALUES ('What is an API?', 'manual', 'rendered') RETURNING id`);
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at)
     VALUES ($1, 'ok', 'click', 'development', 5, 'm', 'm', now()) RETURNING id`,
    [t[0]!.id],
  );
  const jobId = j[0]!.id;
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', 'v.mp4', 5000000, 'bucket')`, [jobId]);
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, content) VALUES ($1, 'post_caption', 'The door between two programs.')`, [jobId]);
  await saveFeedback(db, { jobId, verdict: 'approved', tags: [] });
  const booked = await scheduleJob(db, jobId, 'auto', TUE_MIDNIGHT, undefined, first);
  assert.equal(booked.scheduled, true, booked.scheduled ? '' : booked.note);
  const { rows } = await db.query<{ ny_date: string; slot_by: string | null }>(`SELECT ny_date::text AS ny_date, slot_by FROM social_hub.schedule`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.slot_by, null);
  const q = ((text: string, params?: unknown[]) => db.query(text, params as unknown[])) as never;
  assert.equal((await bookingsOn(q, [rows[0]!.ny_date]))[0]!.slotBy, 'system');
});

test('stories reschedule by a person marks the set', async () => {
  const { pg } = await openHubTestDb();
  const db = pgliteDb(pg);
  const SET = '70000000-0000-4000-8000-000000000001';
  await pg.query(`INSERT INTO stories.sets (id, series, ny_date, status, trigger, style, approved_at, slot_minute) VALUES ($1, 'morning_download', $2, 'approved', 'click', 'polished', now(), 510)`, [SET, WED]);
  assert.equal((await getSet(db, SET))!.set.slotBy, 'system');
  await db.transaction((tx) => rescheduleSet(tx, SET, WED, new Date('2026-10-21T13:00:00Z'), 540, 'person'));
  const got = (await getSet(db, SET))!.set;
  assert.equal(got.slotBy, 'person');
  assert.equal(got.slot_minute, 540);
  assert.equal((await pg.query<{ slot_by: string }>(`SELECT slot_by FROM stories.sets WHERE id = $1`, [SET])).rows[0]!.slot_by, 'person');
});

test('old code still works without the new columns', async () => {
  const { pg, q } = await seeded();
  await pg.exec(`ALTER TABLE social_hub.slot_override DROP COLUMN set_by`);
  await pg.exec(`ALTER TABLE social_hub.schedule DROP COLUMN slot_by`);
  await pg.exec(`ALTER TABLE stories.sets DROP COLUMN slot_by`);

  // Writes: a board date edit, a placement, a reschedule and a Stories move all still land.
  const out = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: WED, vertical: 'explainers', startMinute: 1020, series: null, action: 'add', feedMode: 'main' }], { by: 't', now: TUE_MIDNIGHT });
  assert.equal(out.ok, true);
  const item = await itemFor(pg, 'explainers', 'e1');
  const placed = await placeItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0720', now: TUE_MIDNIGHT, rng: first });
  assert.ok(placed.ok, placed.note);
  const moved = await rescheduleItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0600', now: TUE_MIDNIGHT, rng: first });
  assert.ok(moved.ok, moved.note);

  // Reads: every row reads as the system's (a user-placed booking as the person's, by its source).
  const overrides = await readOverrides(q, WED, WED);
  assert.ok(overrides.length > 0);
  assert.ok(overrides.every((o) => o.setBy === 'system'));
  const other = await itemFor(pg, 'explainers', 'e2');
  await pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
     VALUES ($1, 'explainers', $2::date, 't0930', '2026-10-21T19:30:00Z', 'scheduled', 'auto', 'main')`,
    [other, WED],
  );
  const bookings = await bookingsOn(q, [WED]);
  assert.equal(bookings.find((b) => b.slot === 't0930')!.slotBy, 'system');
  assert.equal(bookings.find((b) => b.slot === 't0600')!.slotBy, 'person');

  const db = pgliteDb(pg);
  const SET = '70000000-0000-4000-8000-000000000002';
  await pg.query(`INSERT INTO stories.sets (id, series, ny_date, status, trigger, style, approved_at, slot_minute) VALUES ($1, 'morning_download', $2, 'approved', 'click', 'polished', now(), 510)`, [SET, WED]);
  await db.transaction((tx) => rescheduleSet(tx, SET, WED, new Date('2026-10-21T13:00:00Z'), 540, 'person'));
  assert.equal((await getSet(db, SET))!.set.slotBy, 'system');
});
