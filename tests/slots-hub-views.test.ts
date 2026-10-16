/** Hub views, placement and type-page posting settings in template mode (weekly slot calendar spec §3, §4). Offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { readPosting, writePosting } from '@/lib/content-type/posting';
import { openSlots, placeItem, planPlacement, rescheduleItem } from '@/lib/social-hub/placement';
import { readDayQuotas } from '@/lib/social-hub/queries/day';
import { resolveDay } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import type { SlotsByDate } from '@/lib/social-hub/slots/types';
import { applySlotChanges, setSlotSource } from '@/lib/social-hub/slots/write';
import { capacityWindows, dayPlan, windowsOn } from '@/lib/social-hub/views/plan';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
const slotsFor = (dates: string[], overrides = [] as Parameters<typeof resolveDay>[1]): SlotsByDate =>
  Object.fromEntries(dates.map((d) => [d, resolveDay(tpl, overrides, d)]));

test('windowsOn follows the day\'s slots when given, and the old rule when not', () => {
  const slots = slotsFor(['2026-10-21'], [{ nyDate: '2026-10-21', vertical: 'carousels', windowId: 'morning', action: 'remove', feedMode: null }]);
  assert.deepEqual(windowsOn('carousels', '2026-10-21', [], slots).map((w) => w.id), ['afternoon']);
  assert.deepEqual(windowsOn('carousels', '2026-10-21', []).map((w) => w.id), ['morning', 'afternoon']);
  // A date the map doesn't cover falls back to the old rule.
  assert.deepEqual(windowsOn('carousels', '2026-10-22', [], slots).map((w) => w.id), ['morning', 'afternoon']);
  // The calendar ignores carouselOff: a Wednesday with carousel slots keeps them.
  assert.deepEqual(windowsOn('carousels', '2026-10-21', [3], slotsFor(['2026-10-21'])).map((w) => w.id), ['morning', 'afternoon']);
  // Last Few Days on a Wednesday the template gives it (an added slot) counts; Stories follow their series slots.
  const lfdWed = slotsFor(['2026-10-21'], [{ nyDate: '2026-10-21', vertical: 'last_few_days', windowId: 'morning', action: 'add', feedMode: null }]);
  assert.deepEqual(windowsOn('last_few_days', '2026-10-21', [], lfdWed).map((w) => w.id), ['morning']);
  assert.deepEqual(capacityWindows('carousels', '2026-10-21', [3], 2, '2026-10-20', slots).map((w) => w.id), ['afternoon']);
});

test('dayPlan offers only slot windows as open', () => {
  const slots = slotsFor(['2026-10-21'], [{ nyDate: '2026-10-21', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }]);
  const reels = dayPlan([], '2026-10-21', [], '2026-10-20', slots).types.find((t) => t.vertical === 'reels')!;
  assert.deepEqual(reels.open.map((w) => w.id), ['morning', 'midday']);
  const legacy = dayPlan([], '2026-10-21', [], '2026-10-20').types.find((t) => t.vertical === 'reels')!;
  assert.deepEqual(legacy.open.map((w) => w.id), ['morning', 'midday', 'evening']);
});

test('readDayQuotas: today\'s slot counts and the slot map in template mode; the old settings in legacy', async () => {
  const { query } = await openHubTestDb();
  const now = new Date('2026-10-20T16:00:00Z'); // Tue Oct 20, noon New York
  const legacy = await readDayQuotas(query, Promise.resolve(query), now);
  assert.equal(legacy.slots, undefined);
  assert.equal(legacy.reels, 3);
  await setSlotSource(query as never, 'template', 't');
  await applySlotChanges(query as never, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }], { by: 't', now, keepBooked: false });
  const q = await readDayQuotas(query, Promise.resolve(query), now);
  assert.deepEqual([q.reels, q.carousels, q.explainers, q.last_few_days, q.lfdDays], [2, 0, 2, 1, []]);
  assert.equal(Object.keys(q.slots!).length, 29);
  assert.ok(q.slots!['2026-10-13'] && q.slots!['2026-11-10'], 'today − 7 … today + 21');
});

const NOW = new Date('2026-10-20T04:00:00Z'); // Tue Oct 20, midnight New York

async function itemFor(pg: Awaited<ReturnType<typeof openHubTestDb>>['pg'], vertical: string, ref: string): Promise<string> {
  const format = vertical === 'carousels' ? 'feed' : 'reel';
  return (await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ($1, $2, $3) RETURNING id::text AS id`, [vertical, format, ref])).rows[0]!.id;
}

test('placing into a window that is not a slot that day is refused; a slot on the calendar plans', async () => {
  const { query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  const refused = await planPlacement(q, { vertical: 'reels', nyDate: '2026-10-21', slot: 'evening', now: NOW });
  assert.equal(refused.ok, false);
  assert.match((refused as { note: string }).note, /isn’t a Text on Screen slot on Wednesday, 2026-10-21\. Add it on the calendar first\./);
  const ok = await planPlacement(q, { vertical: 'reels', nyDate: '2026-10-21', slot: 'midday', now: NOW });
  assert.equal(ok.ok, true);
  assert.equal((ok as { feedMode: string }).feedMode, 'trial');
  // Carousels on a Last Few Days Tuesday: the calendar has no carousel slot, and the picker says off.
  const carousel = await planPlacement(q, { vertical: 'carousels', nyDate: '2026-10-20', slot: 'morning', now: NOW });
  assert.equal(carousel.ok, false);
  const picker = await openSlots(q, 'reels', '2026-10-21', { now: NOW });
  assert.deepEqual(picker.map((s) => [s.slot, s.state]), [['morning', 'free'], ['midday', 'free'], ['evening', 'off']]);
});

test('a Main reel slot is spaced from feed posts and stores its feed mode; a Trial one is not spaced', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'reels', windowId: 'morning', action: 'add', feedMode: 'main' }], { by: 't', now: NOW, keepBooked: false });
  // A carousel booked at 9:10 AM New York on Wednesday keeps the 30-minute gap from 8:40 to 9:40.
  const carousel = await itemFor(pg, 'carousels', 'c1');
  await pg.query(`INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'carousels', '2026-10-21', 'morning', '2026-10-21T13:10:00Z', 'scheduled', 'auto')`, [carousel]);
  const first = () => 0;
  const main = await planPlacement(q, { vertical: 'reels', nyDate: '2026-10-21', slot: 'morning', now: NOW, rng: first });
  assert.ok(main.ok);
  assert.equal(main.publishAt.toISOString(), '2026-10-21T13:40:00.000Z');
  assert.equal(main.feedMode, 'main');
  const trial = await planPlacement(q, { vertical: 'reels', nyDate: '2026-10-21', slot: 'midday', now: NOW, rng: first });
  assert.ok(trial.ok);
  assert.equal(trial.publishAt.toISOString(), '2026-10-21T15:15:00.000Z');

  const reel = await itemFor(pg, 'reels', 'r1');
  const placed = await placeItem(q, { vertical: 'reels', itemId: reel, nyDate: '2026-10-21', slot: 'midday', now: NOW, rng: first });
  assert.ok(placed.ok, placed.note);
  const mode = async () => (await pg.query<{ feed_mode: string | null; slot: string }>(`SELECT feed_mode, slot FROM social_hub.schedule WHERE content_item_id = $1`, [reel])).rows[0]!;
  assert.deepEqual(await mode(), { feed_mode: 'trial', slot: 'midday' });
  const moved = await rescheduleItem(q, { vertical: 'reels', itemId: reel, nyDate: '2026-10-21', slot: 'morning', now: NOW, rng: first });
  assert.ok(moved.ok, moved.note);
  assert.deepEqual(await mode(), { feed_mode: 'main', slot: 'morning' });
});

test('legacy placement is unchanged: no feed mode stored, old weekday rule', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  const reel = await itemFor(pg, 'reels', 'r1');
  const plan = await planPlacement(q, { vertical: 'reels', nyDate: '2026-10-21', slot: 'evening', now: NOW });
  assert.ok(plan.ok);
  assert.equal(plan.feedMode, null);
  const placed = await placeItem(q, { vertical: 'reels', itemId: reel, nyDate: '2026-10-21', slot: 'evening', now: NOW });
  assert.ok(placed.ok, placed.note);
  const moved = await rescheduleItem(q, { vertical: 'reels', itemId: reel, nyDate: '2026-10-21', slot: 'midday', now: NOW });
  assert.ok(moved.ok, moved.note);
  assert.equal((await pg.query<{ feed_mode: string | null }>(`SELECT feed_mode FROM social_hub.schedule WHERE content_item_id = $1`, [reel])).rows[0]!.feed_mode, null);
  // Last Few Days keeps its weekday rule: Wednesday isn't one of its days.
  const lfd = await planPlacement(q, { vertical: 'last_few_days', nyDate: '2026-10-21', slot: 'morning', now: NOW });
  assert.equal(lfd.ok, false);
  assert.match((lfd as { note: string }).note, /doesn’t post on Wednesdays/);
});

// ── Type pages: the calendar owns when (spec §4) ──

async function appDb() {
  const { pg, query } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = { query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]) };
  return { pg, query };
}

test('posting settings: cadence is refused in template mode and still works in legacy', async () => {
  const { pg, query } = await appDb();
  const legacy = await writePosting('carousels', { perDay: 1 }, 't');
  assert.equal(legacy.perDay, 1);
  assert.equal(legacy.schedule, null);
  await setSlotSource(query as never, 'template', 't');
  await assert.rejects(() => writePosting('carousels', { perDay: 2 }, 't'), /^Error: Cadence moved to the calendar\.$/);
  await assert.rejects(() => writePosting('stories', { series: { id: 'free_vs_paid', days: [1] } }, 't'), /Cadence moved to the calendar\./);
  assert.equal((await pg.query<{ value: unknown }>(`SELECT value FROM social.settings WHERE key = 'posts_per_day'`)).rows[0]!.value, 1, 'nothing written');
  // The switches still save.
  assert.equal((await writePosting('carousels', { autoPublish: true }, 't')).autoPublish, true);
});

test('readPosting carries this week\'s schedule in template mode, and null in legacy', async () => {
  const { query } = await appDb();
  assert.equal((await readPosting('reels')).schedule, null);
  await setSlotSource(query as never, 'template', 't');
  const reels = (await readPosting('reels')).schedule!;
  assert.equal(reels.length, 7);
  assert.equal(new Date(`${reels[0]!.nyDate}T12:00:00Z`).getUTCDay(), 1, 'the week starts on Monday');
  assert.deepEqual([reels[0]!.count, reels[0]!.trial, reels[0]!.main], [3, 3, 0]);
  const stories = (await readPosting('stories')).schedule!;
  const monday = stories[0]!;
  assert.deepEqual(monday.series, ['morning_download', 'guess_the_number']);
  assert.equal(stories.some((d) => d.override), false);
});
