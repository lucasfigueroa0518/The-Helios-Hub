// tests/slots-load.test.ts
/** Loading slots on free-time keys, the source switch and caps (week board spec). Offline PGlite. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { isLfdDay, quotaFromSlots, slotPlan, slotsOn, storiesSlotsOn } from '@/lib/social-hub/slots';
import { loadSlots, readCaps, readOverrides, readSlotSource, readTemplate } from '@/lib/social-hub/slots/load';
import { readSeedInputs, seedTemplate, DEFAULT_SEED_INPUTS } from '@/lib/social-hub/slots/seed';
import { DEFAULT_CAPS } from '@/lib/social-hub/slots/times';

import { openHubTestDb } from './fixtures/social-hub/pglite';

async function db(source: 'legacy' | 'template') {
  const { pg, query } = await openHubTestDb();
  await pg.query(`UPDATE social_hub.settings SET value = $1::jsonb WHERE key = 'slot_source'`, [JSON.stringify(source)]);
  for (const r of seedTemplate(DEFAULT_SEED_INPUTS)) {
    await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series, feed_mode) VALUES ($1, $2, $3, $4, $5)`, [r.weekday, r.vertical, r.startMinute, r.series, r.feedMode]);
  }
  return { pg, q: query as never };
}

const broken = (async () => { throw new Error('relation "social_hub.settings" does not exist'); }) as never;

test('legacy (the seeded default) gives no plan: callers keep their own code', async () => {
  const { q } = await db('legacy');
  assert.equal(await readSlotSource(q), 'legacy');
  assert.equal(await slotPlan(q, '2026-10-19'), null);
});

test('an unreadable source reads as legacy', async () => {
  assert.equal(await readSlotSource(broken), 'legacy');
  assert.equal(await slotPlan(broken, '2026-10-19'), null);
});

test('readTemplate and readOverrides read start minutes and Stories series', async () => {
  const { pg, q } = await db('template');
  const monday = (await readTemplate(q)).filter((r) => r.weekday === 1);
  assert.deepEqual(monday.filter((r) => r.vertical === 'explainers').map((r) => [r.startMinute, r.series, r.feedMode]), [[780, null, 'main'], [930, null, 'main']]);
  assert.deepEqual(monday.filter((r) => r.vertical === 'stories').map((r) => [r.startMinute, r.series]).sort(), [[510, 'guess_the_number'], [510, 'morning_download']]);
  await pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, start_minute, series, action, feed_mode) VALUES ('2026-10-20', 'stories', 900, 'morning_download', 'add', NULL)`);
  assert.deepEqual(await readOverrides(q, '2026-10-20', '2026-10-20'), [{ nyDate: '2026-10-20', vertical: 'stories', startMinute: 900, series: 'morning_download', action: 'add', feedMode: null, setBy: 'system' }]);
  assert.deepEqual(await readOverrides(q, '2026-10-21', '2026-10-30'), []);
});

test('template: a plan covers 14 days and applies overrides at free minutes', async () => {
  const { pg, q } = await db('template');
  await pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, start_minute, action, feed_mode) VALUES ('2026-10-20', 'reels', 525, 'add', 'main'), ('2026-10-20', 'explainers', 720, 'add', 'main'), ('2026-10-20', 'explainers', 780, 'remove', NULL)`);
  const plan = (await slotPlan(q, '2026-10-19'))!;
  assert.equal(plan.byDate.size, 14);
  assert.equal(slotsOn(plan, 'reels', '2026-10-20').find((s) => s.startMinute === 525)!.feedMode, 'main');
  assert.deepEqual(slotsOn(plan, 'explainers', '2026-10-20').map((s) => [s.startMinute, s.origin]), [[720, 'override'], [930, 'template']]);
  assert.equal(isLfdDay(plan, '2026-10-20'), true); // Tuesday
  assert.equal(isLfdDay(plan, '2026-10-21'), false);
  const loaded = await loadSlots(q, '2026-10-19', '2026-10-25');
  assert.equal(loaded.size, 7);
  assert.deepEqual(loaded.get('2026-10-19')!.slice(0, 3).map((s) => [s.vertical, s.startMinute]), [['stories', 510], ['stories', 510], ['reels', 525]], 'a day reads in time order');
});

test('readCaps: the defaults, the stored values, and defaults on a bad value or a read error', async () => {
  const { pg, q } = await db('template');
  assert.deepEqual(await readCaps(q), DEFAULT_CAPS);
  await pg.query(`UPDATE social_hub.settings SET value = '{"reels":2,"explainers":"lots","carousels":99}'::jsonb WHERE key = 'daily_caps'`);
  assert.deepEqual(await readCaps(q), { ...DEFAULT_CAPS, reels: 2 });
  await pg.query(`DELETE FROM social_hub.settings WHERE key = 'daily_caps'`);
  assert.deepEqual(await readCaps(q), DEFAULT_CAPS);
  assert.deepEqual(await readCaps(broken), DEFAULT_CAPS);
});

test('readSeedInputs reads LFD and Stories days, defaults on missing rows', async () => {
  const { pg, q } = await db('legacy');
  assert.deepEqual(await readSeedInputs(q), DEFAULT_SEED_INPUTS);
  await pg.query(`INSERT INTO lfd.settings (key, value) VALUES ('days', '[3]'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await pg.query(`INSERT INTO stories.settings (key, value) VALUES ('series', '{"free_vs_paid":{"window":{"days":[0]}}}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const got = await readSeedInputs(q);
  assert.deepEqual(got.lfdDays, [3]);
  assert.deepEqual(got.storyDays.free_vs_paid, [0]);
  assert.deepEqual(got.storyDays.guess_the_number, DEFAULT_SEED_INPUTS.storyDays.guess_the_number);
});

test('quotaFromSlots: null while legacy; template gives min(count, cap), following daily_caps', async () => {
  const legacy = await db('legacy');
  assert.equal(await quotaFromSlots(legacy.q, 'reels', '2026-10-20'), null);
  assert.equal(await storiesSlotsOn(legacy.q, '2026-10-20'), null);
  const { pg, q } = await db('template');
  assert.equal(await quotaFromSlots(q, 'reels', '2026-10-20'), 3); // 3 slots, cap 5
  await pg.query(`UPDATE social_hub.settings SET value = '{"reels":2}'::jsonb WHERE key = 'daily_caps'`);
  assert.equal(await quotaFromSlots(q, 'reels', '2026-10-20'), 2);
  assert.equal(await quotaFromSlots(q, 'explainers', '2026-10-20'), 2);
});

test('storiesSlotsOn: Stories slots on the date, capped at 2 per series', async () => {
  const { pg, q } = await db('template');
  const base = (await storiesSlotsOn(q, '2026-10-20'))!;
  await pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, start_minute, series, action, feed_mode) VALUES
    ('2026-10-20', 'stories', 900, 'morning_download', 'add', NULL), ('2026-10-20', 'stories', 960, 'morning_download', 'add', NULL), ('2026-10-20', 'stories', 1020, 'morning_download', 'add', NULL)`);
  const got = (await storiesSlotsOn(q, '2026-10-20'))!;
  assert.equal(got.filter((s) => s.series === 'morning_download').length, 2);
  assert.equal(got.length, base.filter((s) => s.series !== 'morning_download').length + 2);
});
