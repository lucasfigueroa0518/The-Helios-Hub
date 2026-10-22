// tests/slots-schedule-save.test.ts
/**
 * Saving one type's standing schedule (calendar type schedules spec §1 "What
 * changes on save"): the template is replaced, the system's own bookings
 * follow their paired time, and nothing a person set ever moves. Offline
 * PGlite; no model, no network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { loadSlots } from '@/lib/social-hub/slots/load';
import { SCHEDULE_ENTRIES, type TypeSchedule } from '@/lib/social-hub/slots/schedule';
import { applyScheduleSave, planScheduleSave, saveSchedule, type SaveDeps } from '@/lib/social-hub/slots/schedule-write';
import { nyMinuteOf } from '@/lib/social-hub/slots/times';
import type { FeedMode, SlotQuery, StorySeries } from '@/lib/social-hub/slots/types';
import { applySlotChanges, setSlotSource } from '@/lib/social-hub/slots/write';
import type { Vertical } from '@/lib/social-hub/types';
import { pgliteDb } from '@/lib/stories/local-db';
import { rescheduleSet, scheduleSet } from '@/lib/stories/repository';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const SUN_10AM = new Date('2026-10-25T14:00:00Z'); // Sun Oct 25 2026, 10:00 AM New York
const WED_10AM = new Date('2026-10-28T14:00:00Z');
const WED_8AM = new Date('2026-10-28T12:00:00Z');
const WED = '2026-10-28';
const THU = '2026-10-29';
const NEXT_WED = '2026-11-04';
const BY = 'tommy@example.com';
const first = () => 0;
const NOT_LFD_DAYS = [0, 1, 3, 4, 6];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

type Pg = Awaited<ReturnType<typeof openHubTestDb>>['pg'];
type Tx = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const asQuery = (h: Tx): SlotQuery => async (text, params) => ({ rows: (await h.query(text, params as unknown[])).rows });

async function seeded() {
  const { pg, query } = await openHubTestDb();
  const q = query as unknown as SlotQuery;
  await setSlotSource(q, 'template', BY);
  return { pg, q };
}

/** Replace one entry's template rows: these times on these days. */
async function useTimes(pg: Pg, vertical: Vertical, series: StorySeries | null, times: Array<[number, FeedMode | null]>, days: number[]) {
  await pg.query(`DELETE FROM social_hub.slot_template WHERE vertical = $1 AND coalesce(series, '') = coalesce($2::text, '')`, [vertical, series]);
  for (const weekday of days) {
    for (const [m, mode] of times) {
      await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series, feed_mode, updated_by) VALUES ($1, $2, $3, $4, $5, 'test')`, [weekday, vertical, m, series, mode]);
    }
  }
}

async function book(pg: Pg, o: { vertical: Vertical; nyDate: string; slot: string; publishAt: string; source?: 'auto' | 'user'; feedMode?: FeedMode | null; slotBy?: 'person' | 'system' | null; ref?: string }) {
  const format = o.vertical === 'carousels' || o.vertical === 'last_few_days' ? 'feed' : 'reel';
  const item = (await pg.query<{ id: string }>(
    `INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ($1, $2, gen_random_uuid()::text) RETURNING id::text AS id`, [o.vertical, format],
  )).rows[0]!.id;
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode, slot_by)
     VALUES ($1, $2, $3::date, $4, $5::timestamptz, 'scheduled', $6, $7, $8) RETURNING id::text AS id`,
    [item, o.vertical, o.nyDate, o.slot, o.publishAt, o.source ?? 'auto', o.feedMode ?? null, o.slotBy ?? null],
  );
  return rows[0]!.id;
}

const row = async (pg: Pg, id: string) =>
  (await pg.query<{ slot: string; publish_at: string; feed_mode: string | null; ny_date: string; status: string }>(
    `SELECT slot, publish_at, feed_mode, ny_date::text AS ny_date, status FROM social_hub.schedule WHERE id = $1`, [id],
  )).rows[0]!;

const overrideRows = async (pg: Pg, nyDate: string, vertical: Vertical) =>
  (await pg.query<{ start_minute: number; action: string; set_by: string | null }>(
    `SELECT start_minute, action, set_by FROM social_hub.slot_override WHERE ny_date = $1::date AND vertical = $2 ORDER BY start_minute`, [nyDate, vertical],
  )).rows;

const minutesOn = async (q: SlotQuery, nyDate: string, vertical: Vertical) =>
  ((await loadSlots(q, nyDate, nyDate)).get(nyDate) ?? []).filter((s) => s.vertical === vertical).map((s) => s.startMinute);

const entry = (vertical: Vertical, series: StorySeries | null = null) => SCHEDULE_ENTRIES.find((e) => e.vertical === vertical && e.series === series)!;

const sched = (vertical: Vertical, times: Array<number | [number, FeedMode]>, days: number[], series: StorySeries | null = null): TypeSchedule => ({
  entry: entry(vertical, series),
  times: times.map((t) => (Array.isArray(t) ? { minute: t[0], feedMode: t[1] } : { minute: t, feedMode: null })),
  days,
});

const storiesReschedule: SaveDeps['rescheduleSet'] = (tx, setId, nyDate, publishAt, slotMinute, slotBy) =>
  rescheduleSet({ query: async (t: string, p?: unknown[]) => tx(t, p) } as never, setId, nyDate, publishAt, slotMinute, slotBy);

/** Plan, then apply in one transaction (as the route does). */
async function save(pg: Pg, q: SlotQuery, s: TypeSchedule, now: Date, opts: { confirm?: boolean; rescheduleSet?: SaveDeps['rescheduleSet'] } = {}) {
  const plan = await planScheduleSave(q, s, { now, confirm: opts.confirm });
  assert.equal(plan.ok, true, JSON.stringify(plan.ok ? null : plan));
  if (!plan.ok) throw new Error('unreachable');
  const out = await pg.transaction((tx) => applyScheduleSave(asQuery(tx), plan, { by: BY, now, rng: first, rescheduleSet: opts.rescheduleSet ?? storiesReschedule }));
  assert.equal(out.ok, true, JSON.stringify(out));
  return { plan, out };
}

const deps = (pg: Pg, q: SlotQuery, over: Partial<SaveDeps> = {}): SaveDeps => ({
  query: q,
  transaction: (fn) => pg.transaction((tx) => fn(asQuery(tx))),
  unschedule: async () => ({ ok: true, note: '' }),
  rescheduleSet: storiesReschedule,
  by: BY,
  now: SUN_10AM,
  rng: first,
  ...over,
});

const body = (s: TypeSchedule, confirm?: boolean) => ({ schedule: s, ...(confirm === undefined ? {} : { confirm }) });

test('moves system bookings to the paired time', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'carousels', null, [[570, null]], NOT_LFD_DAYS);
  const id = await book(pg, { vertical: 'carousels', nyDate: WED, slot: 't0570', publishAt: '2026-10-28T13:35:00Z' });
  const { plan, out } = await save(pg, q, sched('carousels', [690], NOT_LFD_DAYS), SUN_10AM);
  assert.deepEqual(plan.moves.map((m) => [m.booking.id, m.to.nyDate, m.to.startMinute]), [[id, WED, 690]]);
  assert.equal(out.ok && out.moved, 1);
  const r = await row(pg, id);
  assert.equal(r.slot, 't0690');
  const m = nyMinuteOf(new Date(r.publish_at));
  assert.ok(m >= 690 && m <= 705, `publish minute ${m}`);
  assert.deepEqual(await minutesOn(q, WED, 'carousels'), [690]);
});

test('keeps a person booking', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'carousels', null, [[570, null]], NOT_LFD_DAYS);
  const id = await book(pg, { vertical: 'carousels', nyDate: WED, slot: 't0570', publishAt: '2026-10-28T13:35:00Z', slotBy: 'person' });
  const { plan } = await save(pg, q, sched('carousels', [690], NOT_LFD_DAYS), SUN_10AM);
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.toReady, []);
  const r = await row(pg, id);
  assert.equal(r.slot, 't0570');
  assert.equal(new Date(r.publish_at).toISOString(), '2026-10-28T13:35:00.000Z');
  // The person's post is that date's Carousel: its routine slot doesn't come back at the new time.
  assert.deepEqual(await minutesOn(q, WED, 'carousels'), [570]);
  assert.deepEqual(await minutesOn(q, THU, 'carousels'), [690]);
});

test('a hand-moved slot stays and its routine slot doesn\'t come back', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'carousels', null, [[570, null]], NOT_LFD_DAYS);
  const moved = await applySlotChanges(q, [{ scope: 'date', op: 'move', from: { nyDate: WED, vertical: 'carousels', startMinute: 570, series: null }, to: { nyDate: WED, startMinute: 600 } }], { by: BY, now: SUN_10AM });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  await save(pg, q, sched('carousels', [690], NOT_LFD_DAYS), SUN_10AM);
  assert.deepEqual(await minutesOn(q, WED, 'carousels'), [600]);
  assert.deepEqual(await minutesOn(q, THU, 'carousels'), [690]);
});

test('a hand-removed slot stays removed at the new time', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'carousels', null, [[570, null]], NOT_LFD_DAYS);
  const removed = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: WED, vertical: 'carousels', startMinute: 570, series: null, action: 'remove' }], { by: BY, now: SUN_10AM });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  await save(pg, q, sched('carousels', [690], NOT_LFD_DAYS), SUN_10AM);
  assert.deepEqual(await minutesOn(q, WED, 'carousels'), []);
  assert.deepEqual(await overrideRows(pg, WED, 'carousels'), [{ start_minute: 690, action: 'remove', set_by: 'person' }]);
});

test('a new time on a hand-set minute keeps the hand-set slot', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'carousels', null, [[570, null]], NOT_LFD_DAYS);
  await applySlotChanges(q, [{ scope: 'date', op: 'move', from: { nyDate: WED, vertical: 'carousels', startMinute: 570, series: null }, to: { nyDate: WED, startMinute: 600 } }], { by: BY, now: SUN_10AM });
  await save(pg, q, sched('carousels', [600], NOT_LFD_DAYS), SUN_10AM);
  assert.deepEqual(await minutesOn(q, WED, 'carousels'), [600]);
  assert.ok((await overrideRows(pg, WED, 'carousels')).some((r) => r.start_minute === 600 && r.action === 'add' && r.set_by === 'person'));
});

test('a removed time sends system bookings back to ready', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'carousels', null, [[570, null], [1080, null]], NOT_LFD_DAYS);
  const wed = await book(pg, { vertical: 'carousels', nyDate: WED, slot: 't0570', publishAt: '2026-10-28T13:35:00Z' });
  const thu = await book(pg, { vertical: 'carousels', nyDate: THU, slot: 't0570', publishAt: '2026-10-29T13:35:00Z' });
  const keep = await book(pg, { vertical: 'carousels', nyDate: THU, slot: 't1080', publishAt: '2026-10-29T22:05:00Z' });
  const plan = await planScheduleSave(q, sched('carousels', [1080], NOT_LFD_DAYS), { now: SUN_10AM });
  assert.ok(plan.ok);
  assert.deepEqual(plan.toReady.map((p) => p.scheduleId).sort(), [wed, thu].sort());
  assert.deepEqual(plan.moves, []);
  assert.equal((await row(pg, keep)).slot, 't1080');
});

test('the save sends removed-time posts back first, then saves', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'carousels', null, [[570, null], [1080, null]], NOT_LFD_DAYS);
  const wed = await book(pg, { vertical: 'carousels', nyDate: WED, slot: 't0570', publishAt: '2026-10-28T13:35:00Z' });
  const sent: string[] = [];
  const out = await saveSchedule(body(sched('carousels', [1080], NOT_LFD_DAYS)), deps(pg, q, {
    unschedule: async (p) => {
      sent.push(p.scheduleId);
      await pg.query(`UPDATE social_hub.schedule SET status = 'cancelled' WHERE id = $1`, [p.scheduleId]);
      return { ok: true, note: 'Unscheduled.' };
    },
  }));
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(sent, [wed]);
  assert.equal(out.body.toReady, 1);
  assert.equal(out.body.moved, 0);
  assert.deepEqual(await minutesOn(q, WED, 'carousels'), [1080]);
});

test('a started slot today is untouched', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'carousels', null, [[570, null]], NOT_LFD_DAYS);
  const id = await book(pg, { vertical: 'carousels', nyDate: WED, slot: 't0570', publishAt: '2026-10-28T13:35:00Z' });
  const { plan } = await save(pg, q, sched('carousels', [690], NOT_LFD_DAYS), WED_10AM);
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.toReady, []);
  assert.equal((await row(pg, id)).slot, 't0570');
  assert.ok((await overrideRows(pg, WED, 'carousels')).some((r) => r.start_minute === 570 && r.action === 'add' && r.set_by === 'system'));
  assert.ok((await minutesOn(q, WED, 'carousels')).includes(570));
});

test('today\'s unstarted slot follows', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'carousels', null, [[570, null]], NOT_LFD_DAYS);
  const id = await book(pg, { vertical: 'carousels', nyDate: WED, slot: 't0570', publishAt: '2026-10-28T13:35:00Z' });
  await save(pg, q, sched('carousels', [690], NOT_LFD_DAYS), WED_8AM);
  const r = await row(pg, id);
  assert.equal(r.slot, 't0690');
  assert.equal(r.ny_date, WED);
  const m = nyMinuteOf(new Date(r.publish_at));
  assert.ok(m >= 690 && m <= 705, `publish minute ${m}`);
});

test('trial/main change reaches system bookings', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'explainers', null, [[780, 'trial']], EVERY_DAY);
  const id = await book(pg, { vertical: 'explainers', nyDate: WED, slot: 't0780', publishAt: '2026-10-28T17:05:00Z', feedMode: 'trial' });
  const person = await book(pg, { vertical: 'explainers', nyDate: THU, slot: 't0780', publishAt: '2026-10-29T17:05:00Z', feedMode: 'trial', slotBy: 'person' });
  await save(pg, q, sched('explainers', [[780, 'main']], EVERY_DAY), SUN_10AM);
  const r = await row(pg, id);
  assert.deepEqual([r.slot, r.feed_mode], ['t0780', 'main']);
  // A person's post keeps its Trial slot.
  assert.deepEqual([(await row(pg, person)).feed_mode], ['trial']);
  const thu = (await loadSlots(q, THU, THU)).get(THU)!.find((s) => s.vertical === 'explainers')!;
  assert.equal(thu.feedMode, 'trial');
});

test('Last Few Days on a Carousels day needs a confirm', async () => {
  const { q } = await seeded();
  const plan = await planScheduleSave(q, sched('last_few_days', [540], [2, 3, 5]), { now: SUN_10AM });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.status, 422);
  assert.deepEqual(plan.confirm, { kind: 'lfd-carousels', days: [3] });
  assert.ok(plan.errors.includes('Wednesday becomes a Last Few Days day. Carousels come off Wednesday.'), plan.errors.join(' | '));
});

test('with the confirm, Carousels come off that day but a person-placed Carousel stays and Last Few Days skips it', async () => {
  const { pg, q } = await seeded();
  const placed = await book(pg, { vertical: 'carousels', nyDate: WED, slot: 't0540', publishAt: '2026-10-28T13:05:00Z', source: 'user' });
  const asked = await planScheduleSave(q, sched('last_few_days', [540], [2, 3, 5]), { now: SUN_10AM });
  assert.ok(!asked.ok && asked.errors.includes('Last Few Days skips Wed Oct 28: you set a Carousel there.'), JSON.stringify(asked));
  const { plan } = await save(pg, q, sched('last_few_days', [540], [2, 3, 5]), SUN_10AM, { confirm: true });
  assert.deepEqual(plan.lfdSkips, ['Wed Oct 28']);
  const wedRows = (await pg.query<{ vertical: string }>(`SELECT vertical FROM social_hub.slot_template WHERE weekday = 3 AND vertical IN ('carousels', 'last_few_days')`)).rows.map((r) => r.vertical);
  assert.deepEqual(wedRows, ['last_few_days']);
  assert.equal((await row(pg, placed)).slot, 't0540');
  assert.deepEqual(await minutesOn(q, WED, 'carousels'), [540]);
  assert.deepEqual(await minutesOn(q, WED, 'last_few_days'), []);
  assert.deepEqual(await overrideRows(pg, WED, 'last_few_days'), [{ start_minute: 540, action: 'remove', set_by: 'system' }]);
  // The next Wednesday is a Last Few Days day.
  assert.deepEqual(await minutesOn(q, NEXT_WED, 'carousels'), []);
  assert.deepEqual(await minutesOn(q, NEXT_WED, 'last_few_days'), [540]);
});

test('stories system sets move with their series', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'stories', 'morning_download', [[510, null]], EVERY_DAY);
  const db = pgliteDb(pg);
  const SET = '70000000-0000-4000-8000-000000000011';
  await pg.query(`INSERT INTO stories.sets (id, series, ny_date, status, trigger, style, approved_at, slot_minute) VALUES ($1, 'morning_download', $2, 'approved', 'auto', 'polished', now(), 510)`, [SET, WED]);
  await db.transaction((tx) => scheduleSet(tx, SET, new Date('2026-10-28T12:35:00Z')));
  const calls: unknown[][] = [];
  const spy: SaveDeps['rescheduleSet'] = async (tx, ...args) => {
    calls.push(args);
    return storiesReschedule(tx, ...args);
  };
  await save(pg, q, sched('stories', [600], EVERY_DAY, 'morning_download'), SUN_10AM, { rescheduleSet: spy });
  assert.equal(calls.length, 1);
  const [setId, nyDate, , slotMinute, slotBy] = calls[0]!;
  assert.deepEqual([setId, nyDate, slotMinute, slotBy], [SET, WED, 600, 'system']);
  const booking = (await pg.query<{ slot: string }>(`SELECT slot FROM social_hub.schedule WHERE vertical = 'stories'`)).rows[0]!;
  assert.equal(booking.slot, 't0600:morning_download');
  assert.equal((await pg.query<{ slot_minute: number }>(`SELECT slot_minute FROM stories.sets WHERE id = $1`, [SET])).rows[0]!.slot_minute, 600);
});

test('undo restores', async () => {
  const { pg, q } = await seeded();
  await useTimes(pg, 'carousels', null, [[570, null]], NOT_LFD_DAYS);
  const id = await book(pg, { vertical: 'carousels', nyDate: WED, slot: 't0570', publishAt: '2026-10-28T13:35:00Z' });
  const { out } = await save(pg, q, sched('carousels', [690], NOT_LFD_DAYS), SUN_10AM);
  assert.ok(out.ok);
  assert.deepEqual(out.inverse, sched('carousels', [570], NOT_LFD_DAYS));
  assert.equal((await row(pg, id)).slot, 't0690');
  await save(pg, q, out.inverse, SUN_10AM);
  const r = await row(pg, id);
  assert.equal(r.slot, 't0570');
  const m = nyMinuteOf(new Date(r.publish_at));
  assert.ok(m >= 570 && m <= 585, `publish minute ${m}`);
  assert.deepEqual(await minutesOn(q, WED, 'carousels'), [570]);
});

test('over cap is refused', async () => {
  const { pg, q } = await seeded();
  const out = await saveSchedule(body(sched('explainers', [[780, 'main'], [840, 'main'], [930, 'main'], [1020, 'main']], EVERY_DAY)), deps(pg, q));
  assert.equal(out.status, 422);
  assert.deepEqual(out.body.errors, ['Explainers can post 3 a day. Raise the daily limit on the Explainers page to add more.']);
});

test('legacy refuses', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as unknown as SlotQuery;
  const out = await saveSchedule(body(sched('carousels', [690], NOT_LFD_DAYS)), deps(pg, q));
  assert.equal(out.status, 409);
  assert.deepEqual(out.body, { error: 'Turn on the calendar first.' });
});

test('an empty schedule needs a confirm, then turns the type off', async () => {
  const { pg, q } = await seeded();
  const asked = await saveSchedule(body(sched('carousels', [], NOT_LFD_DAYS)), deps(pg, q));
  assert.equal(asked.status, 422);
  assert.deepEqual(asked.body, { errors: ['Carousels will stop posting.'], confirm: { kind: 'empty', days: [] } });
  const done = await saveSchedule(body(sched('carousels', [], NOT_LFD_DAYS), true), deps(pg, q));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual(await minutesOn(q, THU, 'carousels'), []);
});

test('a malformed body is a 400', async () => {
  const { pg, q } = await seeded();
  assert.equal((await saveSchedule({ schedule: { entry: { vertical: 'nope', series: null }, times: [], days: [] } }, deps(pg, q))).status, 400);
  assert.equal((await saveSchedule({ schedule: { entry: entry('carousels'), times: [{ minute: 'x' }], days: [1] } }, deps(pg, q))).status, 400);
  assert.equal((await saveSchedule(null, deps(pg, q))).status, 400);
});
