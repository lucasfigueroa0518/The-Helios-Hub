/**
 * Stories in template mode: one set per Stories slot, so a series can post
 * more than once a day (week board redesign, Task 6). Legacy mode keeps one
 * set per due series. Offline (PGlite); no model, no Meta.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { storiesSlotsOn } from '@/lib/social-hub/slots';
import { applySlotChanges, setSlotSource } from '@/lib/social-hub/slots/write';
import { approveSet, listSets, requestSet } from '@/lib/stories/repository';
import { requestAutoSets } from '@/lib/stories/schedule';
import { loadSettings, saveSeriesSetting } from '@/lib/stories/settings';
import { tick } from '@/lib/stories/worker';

import { harnessDb, stubJev, stubPhotos, stubWriter } from './stories-harness';

const THU = '2026-10-08';
const THU_1AM = new Date('2026-10-08T05:00:00Z'); // 1:00 AM New York
const THU_10AM = new Date('2026-10-08T14:00:00Z'); // 10:00 AM New York
const THU_4AM = new Date('2026-10-08T08:00:00Z');

type Db = Awaited<ReturnType<typeof harnessDb>>['db'];
const qOf = (db: Db) => ((t: string, p?: unknown[]) => db.query(t, p)) as never;

/** Template mode with Morning Download at 8:30 (seeded), 3:00 PM and 8:00 PM (the third is over the cap of 2). */
async function templateDay(db: Db) {
  const q = qOf(db);
  await saveSeriesSetting(db, 'morning_download', { auto: true });
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [
    { scope: 'date', op: 'put', nyDate: THU, vertical: 'stories', startMinute: 900, series: 'morning_download', action: 'add', feedMode: null },
    { scope: 'date', op: 'put', nyDate: THU, vertical: 'stories', startMinute: 1200, series: 'morning_download', action: 'add', feedMode: null },
  ], { by: 't', now: THU_1AM });
  return q;
}

const minutesOf = async (db: Db, series = 'morning_download') =>
  (await db.query<{ m: number | null }>(`SELECT slot_minute AS m FROM stories.sets WHERE series = $1 ORDER BY slot_minute NULLS FIRST`, [series])).rows.map((r) => r.m);

const nyMinute = (iso: string | Date) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).split(':').map(Number);
  return p[0]! * 60 + p[1]!;
};

async function setSwitches(db: Db, publishingLive: boolean) {
  await db.query(`INSERT INTO stories.settings (key, value) VALUES ('publishing_live', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(publishingLive)]);
}

const idleDeps = (db: Db, now: Date) => ({
  db, sourceDb: db, now: () => now, sleep: async () => {},
  builder: async () => ({ db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({}), photos: stubPhotos(), builders: { morning_download: async () => ({ ok: false as const, skip: 'test: nothing to build', candidates: [] }) } }) as never,
  meta: () => { throw new Error('nothing may publish'); },
  storage: () => { throw new Error('not used'); },
  insights: () => { throw new Error('not used'); },
  poolReads: () => { throw new Error('no pool in this test'); },
});

test('template: two Morning Download slots → two sets (slot_minute 510 and 900); the third slot is over the cap', async () => {
  const { db } = await harnessDb();
  const q = await templateDay(db);
  const slots = await storiesSlotsOn(q, THU);
  assert.deepEqual(slots!.filter((s) => s.series === 'morning_download').map((s) => s.startMinute), [510, 900], 'capped at 2 per series');
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), THU_1AM, { slots }), ['morning_download', 'morning_download']);
  assert.deepEqual(await minutesOf(db), [510, 900]);
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), THU_1AM, { slots }), [], 'one live set per slot');
});

test('template: a slot whose time has passed gets no set', async () => {
  const { db } = await harnessDb();
  const q = await templateDay(db);
  const slots = await storiesSlotsOn(q, THU);
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), THU_10AM, { slots }), ['morning_download']);
  assert.deepEqual(await minutesOf(db), [900]);
});

test('template: a set a person made for the series fills its first slot', async () => {
  const { db } = await harnessDb();
  const q = await templateDay(db);
  const { set } = await requestSet(db, { series: 'morning_download', nyDate: THU, trigger: 'click', style: 'polished' });
  await db.query(`UPDATE stories.sets SET status = 'ready' WHERE id = $1`, [set.id]);
  await approveSet(db, set.id);
  const lines: string[] = [];
  const slots = await storiesSlotsOn(q, THU);
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), THU_1AM, { slots, log: (m) => lines.push(m) }), ['morning_download']);
  assert.deepEqual(await minutesOf(db), [null, 900]);
  assert.ok(lines.includes('fill_reduced'));
});

test('template: each slot set is scheduled in [slot, slot + 15] and books slot t0510:morning_download / t0900:morning_download', async () => {
  const { db } = await harnessDb();
  const q = await templateDay(db);
  await requestAutoSets(db, await loadSettings(db), THU_1AM, { slots: await storiesSlotsOn(q, THU) });
  await db.query(`UPDATE stories.sets SET status = 'ready'`);
  for (const s of await listSets(db, {})) await approveSet(db, s.id);
  await setSwitches(db, true);
  assert.equal((await tick(idleDeps(db, THU_1AM))).scheduled, 2);
  const sets = (await listSets(db, {})).sort((a, b) => new Date(a.publish_at!).getTime() - new Date(b.publish_at!).getTime());
  const [a, b] = sets.map((s) => nyMinute(s.publish_at!));
  assert.ok(a! >= 510 && a! <= 525, `8:30-8:45, got ${a}`);
  assert.ok(b! >= 900 && b! <= 915, `3:00-3:15 PM, got ${b}`);
  const { rows } = await db.query<{ slot: string }>(`SELECT slot FROM social_hub.schedule WHERE vertical = 'stories' ORDER BY publish_at`);
  assert.deepEqual(rows.map((r) => r.slot), ['t0510:morning_download', 't0900:morning_download']);
});

test('template: the 4 AM worker requests one set per Stories slot', async () => {
  const { db } = await harnessDb();
  await templateDay(db);
  await tick(idleDeps(db, THU_4AM));
  assert.deepEqual(await minutesOf(db), [510, 900]);
});

test('legacy: exactly one set per due series, no slot minute, booked under the series name', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'morning_download', { auto: true });
  await saveSeriesSetting(db, 'guess_the_number', { auto: true });
  await saveSeriesSetting(db, 'free_vs_paid', { auto: true });
  assert.equal(await storiesSlotsOn(qOf(db), THU), null);
  await tick(idleDeps(db, THU_4AM));
  assert.deepEqual(await minutesOf(db), [null]);
  assert.deepEqual(await minutesOf(db, 'guess_the_number'), [null]);
  assert.deepEqual(await minutesOf(db, 'free_vs_paid'), [], 'not due on Thursday');

  const { db: db2 } = await harnessDb();
  await saveSeriesSetting(db2, 'morning_download', { auto: true });
  assert.deepEqual(await requestAutoSets(db2, await loadSettings(db2), THU_1AM, { slots: null }), ['morning_download']);
  await db2.query(`UPDATE stories.sets SET status = 'ready'`);
  for (const s of await listSets(db2, {})) await approveSet(db2, s.id);
  await setSwitches(db2, true);
  assert.equal((await tick(idleDeps(db2, THU_1AM))).scheduled, 1);
  const [set] = await listSets(db2, {});
  const m = nyMinute(set!.publish_at!);
  assert.ok(m >= 510 && m <= 600, `the series window 8:30-10:00, got ${m}`);
  const { rows } = await db2.query<{ slot: string }>(`SELECT slot FROM social_hub.schedule WHERE vertical = 'stories'`);
  assert.deepEqual(rows.map((r) => r.slot), ['morning_download']);
});
