/**
 * Stories in template mode: one set per Stories slot, so a series can post
 * more than once a day (week board redesign, Task 6). Legacy mode keeps one
 * set per due series. Offline (PGlite); no model, no Meta.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { storiesSlotsOn } from '@/lib/social-hub/slots';
import { applySlotChanges, setSlotSource } from '@/lib/social-hub/slots/write';
import { buildMorningDownload } from '@/lib/stories/build/morning-download';
import { createStoriesJev } from '@/lib/stories/jev';
import { approveSet, getSet, listSets, requestSet } from '@/lib/stories/repository';
import { openStorySlots, requestAutoSets } from '@/lib/stories/schedule';
import { DEFAULT_SETTINGS, loadSettings, saveSeriesSetting } from '@/lib/stories/settings';
import type { StoryCandidate } from '@/lib/stories/sources/reels';
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

/* ── Fix round 1 ─────────────────────────────────────────────────── */

test('R12: with no slot_minute column (schema not applied yet), a legacy day still requests, lists, approves and schedules', async () => {
  const { db } = await harnessDb();
  await db.query(`ALTER TABLE stories.sets DROP COLUMN slot_minute`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS sets_one_live_per_day_test ON stories.sets (series, ny_date) WHERE status NOT IN ('rejected', 'failed', 'skipped')`);
  await saveSeriesSetting(db, 'morning_download', { auto: true });
  await tick(idleDeps(db, THU_4AM)); // requests, then builds (the stub skips it)
  const [skipped] = await listSets(db, {});
  assert.equal(skipped!.status, 'skipped');
  assert.equal(skipped!.slot_minute, null);
  const { set, created } = await requestSet(db, { series: 'morning_download', nyDate: THU, trigger: 'click', style: 'polished' });
  assert.equal(created, true);
  assert.equal((await requestSet(db, { series: 'morning_download', nyDate: THU, trigger: 'click', style: 'polished' })).created, false);
  await db.query(`UPDATE stories.sets SET status = 'ready' WHERE id = $1`, [set.id]);
  await approveSet(db, set.id);
  await setSwitches(db, true);
  assert.equal((await tick(idleDeps(db, THU_4AM))).scheduled, 1);
  assert.equal((await getSet(db, set.id))!.set.status, 'scheduled');
  const { rows } = await db.query<{ slot: string }>(`SELECT slot FROM social_hub.schedule WHERE vertical = 'stories'`);
  assert.deepEqual(rows.map((r) => r.slot), ['morning_download']);
});

const materialOf = (params: Record<string, unknown>) => {
  const m = /<material>\n([\s\S]*)\n<\/material>/.exec(String((params.messages as Array<{ content: string }>)[0]!.content));
  return JSON.parse(m![1]!) as unknown;
};

test('R13: two Morning Download sets of one date never share a story', async () => {
  const { db } = await harnessDb();
  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
  const pool: StoryCandidate[] = names.map((n, i) => ({
    key: `news.test/${n.toLowerCase()}`, origin: 'reels', ref: `idea-${i}`, headline: `${n} launches a product`, sourceName: 'Wired',
    url: `https://news.test/${n.toLowerCase()}`, body: `${n} launched a product on Thursday.`, publishedAt: '2026-10-07T12:00:00Z', nativeScore: 9 - i,
  }));
  const write = stubWriter({
    submit_headlines: (params) => ({
      stories: (materialOf(params) as Array<{ key: string; headline: string }>).map((x) => ({ key: x.key, headline: `${x.headline} on Thursday.`, source_verb: 'via', source_name: 'Wired', subjects: [], visual: { kind: 'company', query: x.headline.split(' ')[0] }, alt_visuals: [] })),
      opener_visual: { kind: 'setting', query: 'newsroom' },
    }),
  });
  const keys: string[][] = [];
  for (const slotMinute of [510, 900]) {
    const { set } = await requestSet(db, { series: 'morning_download', nyDate: THU, trigger: 'auto', style: 'polished', slotMinute });
    const deps = { db, sourceDb: db, jev: createStoriesJev(stubJev(), db), write, photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: THU_1AM, setId: set.id, nyDate: THU };
    const r = await buildMorningDownload(deps, { reels: async () => pool, carousel: async () => [] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    keys.push(r.historyKeys);
    // What buildSet's saveBuild stores on the set.
    await db.query(`UPDATE stories.sets SET payload = $2::jsonb, status = 'ready' WHERE id = $1`, [set.id, JSON.stringify({ historyKeys: r.historyKeys })]);
  }
  assert.equal(keys[0]!.length, 2);
  assert.equal(keys[1]!.length, 2);
  assert.deepEqual(keys[0]!.filter((k) => keys[1]!.includes(k)), [], 'no shared key');
  // A rejected set frees its keys.
  await db.query(`UPDATE stories.sets SET status = 'rejected' WHERE slot_minute = 510`);
  const { set: third } = await requestSet(db, { series: 'morning_download', nyDate: THU, trigger: 'auto', style: 'polished', slotMinute: 510 });
  const r3 = await buildMorningDownload({ db, sourceDb: db, jev: createStoriesJev(stubJev(), db), write, photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: THU_1AM, setId: third.id, nyDate: THU }, { reels: async () => pool, carousel: async () => [] });
  assert.ok(r3.ok && r3.historyKeys.every((k) => !keys[1]!.includes(k)));
});

test('cap: a person\'s set still in the making (ready, no slot) takes one of the two slots', async () => {
  const { db } = await harnessDb();
  const q = await templateDay(db);
  const { set } = await requestSet(db, { series: 'morning_download', nyDate: THU, trigger: 'click', style: 'polished' });
  await db.query(`UPDATE stories.sets SET status = 'ready' WHERE id = $1`, [set.id]);
  const fields: Array<Record<string, unknown>> = [];
  const lines: string[] = [];
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), THU_1AM, { slots: await storiesSlotsOn(q, THU), log: (m, f) => (lines.push(m), fields.push(f)) }), ['morning_download']);
  assert.deepEqual(await minutesOf(db), [null, 900]);
  const fill = fields[lines.indexOf('fill_reduced')]!;
  assert.equal(fill.quota, 2);
  assert.equal(fill.userPlaced, 1);
  assert.equal(fill.making, 1);
  assert.equal(fields[lines.indexOf('auto_requested')]!.slot, 'morning_download@15:00');
});

test('a failed slot read (legacy path) never adds a set to a day that already has template sets', async () => {
  const { db } = await harnessDb();
  const q = await templateDay(db);
  await requestAutoSets(db, await loadSettings(db), THU_1AM, { slots: await storiesSlotsOn(q, THU) });
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), THU_1AM, { slots: null }), []);
  assert.deepEqual(await minutesOf(db), [510, 900]);
});

test('openStorySlots (Run now\'s list): open while a capped slot is free and not passed', async () => {
  const { db } = await harnessDb();
  const q = await templateDay(db);
  const slots = (await storiesSlotsOn(q, THU))!;
  const openOf = async (now: Date) => ((await openStorySlots(db, slots, now)).get('morning_download')?.open ?? []).map((s) => s.startMinute);
  assert.deepEqual(await openOf(THU_1AM), [510, 900]);
  assert.deepEqual(await openOf(THU_10AM), [900], '8:30 has passed');
  await requestSet(db, { series: 'morning_download', nyDate: THU, trigger: 'auto', style: 'polished', slotMinute: 900 });
  assert.deepEqual(await openOf(THU_10AM), [], 'the open one is held');
  assert.deepEqual(await openOf(THU_1AM), [510]);
});
