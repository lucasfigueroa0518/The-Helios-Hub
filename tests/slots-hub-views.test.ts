/** Hub views, placement and type-page posting settings in template mode (weekly slot calendar spec §3, §4). Offline. */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { typeHubModel } from '@/lib/content-type/model';
import { readPosting, writePosting } from '@/lib/content-type/posting';
import { seriesDueToday } from '@/lib/social-hub/run-today';
import { storiesDueOn } from '@/lib/social-hub/slots';
import { openSlots, placeItem, planPlacement, rescheduleItem } from '@/lib/social-hub/placement';
import { readDayQuotas } from '@/lib/social-hub/queries/day';
import { resolveDay } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import type { SlotsByDate } from '@/lib/social-hub/slots/types';
import { applySlotChanges, setSlotSource } from '@/lib/social-hub/slots/write';
import { capacityWindows, dayPlan, windowsOn } from '@/lib/social-hub/views/plan';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { FIXTURE_NOW, previewDataset } from './fixtures/social-hub/preview-dataset';

// Tests here point lib/db.ts's shared pool at PGlite; put the previous one back after each.
const poolHolder = globalThis as { __outreachHubPool?: unknown };
const poolBefore = poolHolder.__outreachHubPool;
afterEach(() => {
  if (poolBefore === undefined) delete poolHolder.__outreachHubPool;
  else poolHolder.__outreachHubPool = poolBefore;
});

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
  assert.deepEqual(capacityWindows('carousels', '2026-10-21', [3], 1, '2026-10-20', slots).map((w) => w.id), ['afternoon']);
});

test('dayPlan offers only slot windows as open', () => {
  const slots = slotsFor(['2026-10-21'], [{ nyDate: '2026-10-21', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }]);
  const reels = dayPlan([], '2026-10-21', [], '2026-10-20', slots).types.find((t) => t.vertical === 'reels')!;
  assert.deepEqual(reels.open.map((w) => w.id), ['morning', 'midday']);
  const legacy = dayPlan([], '2026-10-21', [], '2026-10-20').types.find((t) => t.vertical === 'reels')!;
  assert.deepEqual(legacy.open.map((w) => w.id), ['morning', 'midday', 'evening']);
});

test('a booking kept in a slot the calendar removed still holds its place until it posts', () => {
  // Wednesday: only the reels evening slot is left; two reels stay booked (keepBooked) in the removed morning and midday.
  const removed = (windowId: string) => ({ nyDate: '2026-10-21', vertical: 'reels' as const, windowId, action: 'remove' as const, feedMode: null });
  const slots = slotsFor(['2026-10-21'], [removed('morning'), removed('midday')]);
  assert.deepEqual(capacityWindows('reels', '2026-10-21', [], 0, '2026-10-20', slots).map((w) => w.id), ['evening']);
  assert.deepEqual(capacityWindows('reels', '2026-10-21', [], 2, '2026-10-20', slots).map((w) => w.id), ['morning', 'evening']);
  assert.deepEqual(capacityWindows('reels', '2026-10-21', [], 5, '2026-10-20', slots).map((w) => w.id), ['morning', 'midday', 'evening']);
  // Offers stay slot-only.
  assert.deepEqual(windowsOn('reels', '2026-10-21', [], slots).map((w) => w.id), ['evening']);
  // A past day keeps every window it had, even with the calendar's slots gone.
  assert.deepEqual(capacityWindows('reels', '2026-10-19', [], 0, '2026-10-20', slotsFor(['2026-10-19'], [{ ...removed('morning'), nyDate: '2026-10-19' }])).map((w) => w.id), ['morning', 'midday', 'evening']);

  // The type page: both kept reels sit on their day, neither waits for a slot.
  const base = previewDataset();
  const today = '2026-10-08'; // FIXTURE_NOW
  const later = '2026-10-12';
  const moved = base.posts.filter((p) => p.vertical === 'reels' && p.nyDate === '2026-10-07').slice(0, 2);
  assert.equal(moved.length, 2);
  const ids = new Set(moved.map((p) => p.id));
  // Booked and made (a rendered video).
  const media = { kind: 'video', src: '/reel.mp4', poster: null } as never;
  // Only the two kept reels hold that day.
  const posts = base.posts.filter((p) => !(p.vertical === 'reels' && p.nyDate === later)).map((p) => (ids.has(p.id) ? { ...p, nyDate: later, status: 'scheduled' as const, publishAt: '2026-10-12T13:30:00.000Z', postedAt: null, media } : p));
  const onlyEvening = slotsFor([today, later], [{ ...removed('morning'), nyDate: later }, { ...removed('midday'), nyDate: later }]);
  const dataset = { ...base, posts, dayQuotas: { reels: 3, carousels: 2, explainers: 2, lfdDays: [], slots: onlyEvening } };
  const model = typeHubModel(dataset, 'reels', FIXTURE_NOW);
  const day = model.days.find((d) => d.date === later)!;
  assert.deepEqual(new Set(day.cards.map((c) => c.post.id)), ids);
  assert.equal(model.bench.some((b) => b.card && ids.has(b.card.post.id)), false, 'not waiting for a slot');
  const plan = dayPlan(posts, later, [], today, onlyEvening).types.find((t) => t.vertical === 'reels')!;
  assert.equal(plan.windows.length, 2);
  assert.equal(plan.placed.length, 2);
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

test('a Trial Explainer slot is not spaced; a Main one is', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'explainers', windowId: 'afternoon', action: 'add', feedMode: 'trial' }], { by: 't', now: NOW, keepBooked: false });
  // Carousels booked at 1:10 PM and 3:40 PM New York on Wednesday.
  const carousel = await itemFor(pg, 'carousels', 'c1');
  const carousel2 = await itemFor(pg, 'carousels', 'c2');
  await pg.query(`INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES
    ($1, 'carousels', '2026-10-21', 'morning', '2026-10-21T17:10:00Z', 'scheduled', 'auto'),
    ($2, 'carousels', '2026-10-21', 'afternoon', '2026-10-21T19:40:00Z', 'scheduled', 'auto')`, [carousel, carousel2]);
  const first = () => 0;
  const trial = await planPlacement(q, { vertical: 'explainers', nyDate: '2026-10-21', slot: 'afternoon', now: NOW, rng: first });
  assert.ok(trial.ok);
  assert.equal(trial.publishAt.toISOString(), '2026-10-21T17:00:00.000Z', '1:00 PM, ten minutes from the carousel');
  assert.equal(trial.feedMode, 'trial');
  const main = await planPlacement(q, { vertical: 'explainers', nyDate: '2026-10-21', slot: 'late', now: NOW, rng: first });
  assert.ok(main.ok);
  assert.equal(main.publishAt.toISOString(), '2026-10-21T20:10:00.000Z', '4:10 PM, thirty minutes after the carousel');
  assert.equal(main.feedMode, 'main');
});

test('template mode with an unreadable calendar keeps the legacy days (Carousels give up Last Few Days days)', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.query(`INSERT INTO lfd.settings (key, value) VALUES ('auto_run', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await setSlotSource(query as never, 'template', 't');
  // slot_source reads 'template', but the template itself can't be read.
  const broken = (async (text: string, params?: unknown[]) => {
    if (/slot_template|slot_override/.test(text)) throw new Error('relation does not exist');
    return query(text, params);
  }) as never;
  const tuesday = await planPlacement(broken, { vertical: 'carousels', nyDate: '2026-10-20', slot: 'afternoon', now: NOW });
  assert.equal(tuesday.ok, false);
  assert.match((tuesday as { note: string }).note, /doesn’t post on Tuesdays/);
  const picker = await openSlots(broken, 'carousels', '2026-10-20', { now: NOW });
  assert.deepEqual(picker.map((s) => s.state), ['off', 'off']);
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

test('readPosting in template mode works out perDay, LFD days and series days from the calendar (spec §4)', async () => {
  const { query } = await appDb();
  const q = query as never;
  const TUE = new Date('2026-10-20T14:00:00Z'); // Tue Oct 20, 10:00 AM New York
  const legacyCarousels = await readPosting('carousels', TUE);
  const legacyStories = await readPosting('stories', TUE);
  assert.equal(legacyCarousels.perDay, 2, 'legacy: the posts_per_day default');
  await setSlotSource(q, 'template', 't');
  assert.equal((await readPosting('carousels', TUE)).perDay, 0, 'Tuesday is an LFD day on the seeded calendar');
  assert.equal((await readPosting('carousels', new Date('2026-10-21T14:00:00Z'))).perDay, 2);
  assert.equal((await readPosting('reels', TUE)).perDay, 3);
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }], { by: 't', now: TUE, keepBooked: false });
  assert.equal((await readPosting('reels', TUE)).perDay, 2, 'today\'s slots, not posts_per_day');
  assert.deepEqual((await readPosting('last_few_days', TUE)).days, [2, 5]);
  // Seeded from the series' own days, so they match legacy; then a Thursday add shows up.
  const daysOf = (state: Awaited<ReturnType<typeof readPosting>>) => Object.fromEntries((state.series ?? []).map((x) => [x.id, x.days]));
  assert.deepEqual(daysOf(await readPosting('stories', TUE)), daysOf(legacyStories));
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-22', vertical: 'stories', windowId: 'free_vs_paid', action: 'add', feedMode: null }], { by: 't', now: TUE, keepBooked: false });
  assert.ok(daysOf(await readPosting('stories', TUE)).free_vs_paid!.includes(4));
});

test('Run now\'s Stories due list follows the calendar in template mode, like the 4 AM worker', async () => {
  const { query } = await appDb();
  const q = query as never;
  const series = [
    { id: 'morning_download', label: 'MD', enabled: true, days: [4] },
    { id: 'free_vs_paid', label: 'FP', enabled: true, days: [1] },
  ];
  const THU = '2026-10-22';
  assert.deepEqual(seriesDueToday(series, THU, new Set(), await storiesDueOn(q, THU)).map((s) => s.id), ['morning_download'], 'legacy: own days');
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [
    { scope: 'date', op: 'put', nyDate: THU, vertical: 'stories', windowId: 'morning_download', action: 'remove', feedMode: null },
    { scope: 'date', op: 'put', nyDate: THU, vertical: 'stories', windowId: 'free_vs_paid', action: 'add', feedMode: null },
  ], { by: 't', now: new Date('2026-10-20T14:00:00Z'), keepBooked: false });
  const due = seriesDueToday(series, THU, new Set(['free_vs_paid']), await storiesDueOn(q, THU));
  assert.deepEqual(due, [{ id: 'free_vs_paid', label: 'FP', held: true }]);
});
