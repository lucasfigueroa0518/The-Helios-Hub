// tests/slots-load.test.ts
/** Loading slots and the scheduler seam (spec §5). Offline PGlite. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { bookingFeedMode, feedModeFor, feedModeKeys, isLfdDay, nonSlotKeys, slotPlan, slotsOn } from '@/lib/social-hub/slots';
import { loadSlots, readSlotSource } from '@/lib/social-hub/slots/load';
import { readSeedInputs, seedTemplate, DEFAULT_SEED_INPUTS } from '@/lib/social-hub/slots/seed';
import { slotTakenKey } from '@/lib/instagram/window';

import { openHubTestDb } from './fixtures/social-hub/pglite';

async function db(source: 'legacy' | 'template') {
  const { pg, query } = await openHubTestDb();
  await pg.query(`UPDATE social_hub.settings SET value = $1::jsonb WHERE key = 'slot_source'`, [JSON.stringify(source)]);
  for (const r of seedTemplate(DEFAULT_SEED_INPUTS)) {
    await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES ($1, $2, $3, $4)`, [r.weekday, r.vertical, r.windowId, r.feedMode]);
  }
  return { pg, q: query as never };
}

test('legacy (the seeded default) gives no plan: callers keep their own code', async () => {
  const { q } = await db('legacy');
  assert.equal(await readSlotSource(q), 'legacy');
  assert.equal(await slotPlan(q, '2026-10-19'), null);
});

test('an unreadable source reads as legacy (Review Focus 1)', async () => {
  const broken = async () => { throw new Error('relation "social_hub.settings" does not exist'); };
  assert.equal(await readSlotSource(broken as never), 'legacy');
  assert.equal(await slotPlan(broken as never, '2026-10-19'), null);
});

test('template: a plan covers 14 days and applies overrides', async () => {
  const { pg, q } = await db('template');
  await pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-20', 'reels', 'morning', 'add', 'main')`);
  const plan = (await slotPlan(q, '2026-10-19'))!;
  assert.equal(plan.byDate.size, 14);
  assert.equal(slotsOn(plan, 'reels', '2026-10-20').find((s) => s.windowId === 'morning')!.feedMode, 'main');
  assert.equal(isLfdDay(plan, '2026-10-20'), true);  // Tuesday
  assert.equal(isLfdDay(plan, '2026-10-21'), false);
  const off = nonSlotKeys(plan, 'carousels', ['morning', 'afternoon'], slotTakenKey);
  assert.ok(off.has('2026-10-20|morning') && off.has('2026-10-23|afternoon'));
  assert.ok(!off.has('2026-10-21|morning'));
  const modes = feedModeKeys(plan, 'reels', slotTakenKey);
  assert.ok(modes.main.has('2026-10-20|morning') && modes.trial.has('2026-10-21|morning'));
  const loaded = await loadSlots(q, '2026-10-19', '2026-10-25');
  assert.equal(loaded.size, 7);
});

test('feedModeFor and bookingFeedMode fall back to each type\'s old behavior (Review Focus 3)', async () => {
  const { pg, q } = await db('template');
  assert.equal(await feedModeFor(q, 'reels', '2026-10-21', 'morning'), 'trial');
  assert.equal(await feedModeFor(q, 'carousels', '2026-10-21', 'morning'), null);
  // No booking at all (a force post): legacy.
  assert.equal(await bookingFeedMode(q, null, 'explainers'), 'main');
  assert.equal(await bookingFeedMode(q, null, 'reels', 'idea-1'), 'trial');
  // A booking's own feed mode wins: this one says 'trial', beating the legacy default 'main' for explainers.
  const item = await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('explainers', 'reel', 'job-1') RETURNING id`);
  await pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
     VALUES ($1, 'explainers', '2026-10-21', 'late', '2026-10-21T20:00:00Z', 'scheduled', 'auto', 'trial')`,
    [item.rows[0]!.id],
  );
  assert.equal(await bookingFeedMode(q, item.rows[0]!.id, 'explainers'), 'trial');
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
