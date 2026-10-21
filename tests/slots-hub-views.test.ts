/** Hub views, placement, Run now's Stories and type-page posting settings in template mode (week board spec; base spec §3, §4). Offline. */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { parsePlacement } from '@/app/api/social-hub/actions/content-action';
import { typeHubModel } from '@/lib/content-type/model';
import { costPerPost, readPosting, writePosting } from '@/lib/content-type/posting';
import { requestStorySets } from '@/lib/content-type/run-today-live';
import { seriesDueToday } from '@/lib/social-hub/run-today';
import { openSlots, placeItem, planPlacement, rescheduleItem } from '@/lib/social-hub/placement';
import { readDayQuotas } from '@/lib/social-hub/queries/day';
import { storiesSlotsOn } from '@/lib/social-hub/slots';
import { loadSlots, readCaps } from '@/lib/social-hub/slots/load';
import { resolveDay } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import type { OverrideRow, SlotsByDate } from '@/lib/social-hub/slots/types';
import { applySlotChanges, setSlotSource, writeCaps } from '@/lib/social-hub/slots/write';
import type { HubPost } from '@/lib/social-hub/types';
import { capacityWindows, dayPlan, windowsOn } from '@/lib/social-hub/views/plan';
import { storyActions } from '@/lib/publishing/actions/stories';
import { activeSlotByRef } from '@/lib/social-hub/placement';
import { ApiError, generateNow, NO_OPEN_SLOT } from '@/lib/stories/api';
import { liveStoriesDb } from '@/lib/stories/db';
import { pgliteDb } from '@/lib/stories/local-db';
import { getSet, rescheduleSet } from '@/lib/stories/repository';
import { openStorySlots } from '@/lib/stories/schedule';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { FIXTURE_NOW, previewDataset } from './fixtures/social-hub/preview-dataset';

// Tests here point lib/db.ts's shared pool (and the Explainers handle, never its local folder) at PGlite; put the previous ones back after each.
const poolHolder = globalThis as { __outreachHubPool?: unknown; __explainersDb?: unknown };
const poolBefore = poolHolder.__outreachHubPool;
const explainersBefore = poolHolder.__explainersDb;
afterEach(() => {
  if (poolBefore === undefined) delete poolHolder.__outreachHubPool;
  else poolHolder.__outreachHubPool = poolBefore;
  if (explainersBefore === undefined) delete poolHolder.__explainersDb;
  else poolHolder.__explainersDb = explainersBefore;
});

const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
const slotsFor = (dates: string[], overrides = [] as OverrideRow[]): SlotsByDate =>
  Object.fromEntries(dates.map((d) => [d, resolveDay(tpl, overrides, d)]));
const remove = (nyDate: string, vertical: OverrideRow['vertical'], startMinute: number, series: OverrideRow['series'] = null): OverrideRow =>
  ({ nyDate, vertical, startMinute, series, action: 'remove', feedMode: null });
const add = (nyDate: string, vertical: OverrideRow['vertical'], startMinute: number, feedMode: OverrideRow['feedMode'] = null, series: OverrideRow['series'] = null): OverrideRow =>
  ({ nyDate, vertical, startMinute, series, action: 'add', feedMode });

// ── Views: a type's windows are that day's slot times ──

test('windowsOn follows the day\'s slot times when given, and the old windows when not', () => {
  const slots = slotsFor(['2026-10-21'], [remove('2026-10-21', 'carousels', 540)]);
  assert.deepEqual(windowsOn('carousels', '2026-10-21', [], slots).map((w) => [w.id, w.startMinute, w.endMinute, w.label]), [['t0870', 870, 885, '2:30 PM']]);
  assert.deepEqual(windowsOn('carousels', '2026-10-21', []).map((w) => w.id), ['morning', 'afternoon']);
  // A date the map doesn't cover falls back to the old rule.
  assert.deepEqual(windowsOn('carousels', '2026-10-22', [], slots).map((w) => w.id), ['morning', 'afternoon']);
  // The calendar ignores carouselOff: a Wednesday with carousel slots keeps them.
  assert.deepEqual(windowsOn('carousels', '2026-10-21', [3], slotsFor(['2026-10-21'])).map((w) => w.id), ['t0540', 't0870']);
  // A free time outside every old window counts: an Explainer at noon.
  const noon = slotsFor(['2026-10-21'], [add('2026-10-21', 'explainers', 720, 'main')]);
  assert.deepEqual(windowsOn('explainers', '2026-10-21', [], noon).map((w) => w.id), ['t0720', 't0780', 't0930']);
  // Last Few Days on a Wednesday the calendar gives it counts; Stories carry their series.
  const lfdWed = slotsFor(['2026-10-21'], [add('2026-10-21', 'last_few_days', 540)]);
  assert.deepEqual(windowsOn('last_few_days', '2026-10-21', [], lfdWed).map((w) => w.id), ['t0540']);
  const stories = windowsOn('stories', '2026-10-22', [], slotsFor(['2026-10-22'], [add('2026-10-22', 'stories', 900, null, 'morning_download')]));
  assert.deepEqual(stories.map((w) => [w.id, w.label]), [['t0510:guess_the_number', 'Guess the Number'], ['t0510:morning_download', 'Morning Download'], ['t0900:morning_download', 'Morning Download']]);
  assert.deepEqual(capacityWindows('carousels', '2026-10-21', [3], 1, '2026-10-20', slots).map((w) => w.id), ['t0870']);
});

test('dayPlan offers only slot times as open', () => {
  const slots = slotsFor(['2026-10-21'], [remove('2026-10-21', 'reels', 1080)]);
  const reels = dayPlan([], '2026-10-21', [], '2026-10-20', slots).types.find((t) => t.vertical === 'reels')!;
  assert.deepEqual(reels.open.map((w) => w.id), ['t0525', 't0675']);
  const legacy = dayPlan([], '2026-10-21', [], '2026-10-20').types.find((t) => t.vertical === 'reels')!;
  assert.deepEqual(legacy.open.map((w) => w.id), ['morning', 'midday', 'evening']);
});

test('a booking kept in a slot the calendar removed still holds its place until it posts', () => {
  // Wednesday: only the reels 6:00 PM slot is left; two reels stay booked in the removed 8:45 and 11:15.
  const slots = slotsFor(['2026-10-21'], [remove('2026-10-21', 'reels', 525), remove('2026-10-21', 'reels', 675)]);
  assert.deepEqual(capacityWindows('reels', '2026-10-21', [], 0, '2026-10-20', slots).map((w) => w.id), ['t1080']);
  assert.equal(capacityWindows('reels', '2026-10-21', [], 2, '2026-10-20', slots).length, 2);
  assert.equal(capacityWindows('reels', '2026-10-21', [], 5, '2026-10-20', slots).length, 4, 'its slots plus every old window, no more');
  // Offers stay slot-only.
  assert.deepEqual(windowsOn('reels', '2026-10-21', [], slots).map((w) => w.id), ['t1080']);
  // A past day keeps as many windows as it had before the calendar, even with the calendar's slots gone.
  assert.equal(capacityWindows('reels', '2026-10-19', [], 0, '2026-10-20', slotsFor(['2026-10-19'], [remove('2026-10-19', 'reels', 525)])).length, 3);

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
  const onlyEvening = slotsFor([today, later], [remove(later, 'reels', 525), remove(later, 'reels', 675)]);
  const dataset = { ...base, posts, dayQuotas: { reels: 3, carousels: 2, explainers: 2, lfdDays: [], slots: onlyEvening } };
  const model = typeHubModel(dataset, 'reels', FIXTURE_NOW);
  const day = model.days.find((d) => d.date === later)!;
  assert.deepEqual(new Set(day.cards.map((c) => c.post.id)), ids);
  assert.equal(model.bench.some((b) => b.card && ids.has(b.card.post.id)), false, 'not waiting for a slot');
  const plan = dayPlan(posts, later, [], today, onlyEvening).types.find((t) => t.vertical === 'reels')!;
  assert.equal(plan.windows.length, 2);
  assert.equal(plan.placed.length, 2);
});

test('readDayQuotas: today\'s slot counts under the daily limit and the slot map in template mode; the old settings in legacy', async () => {
  const { query } = await openHubTestDb();
  const now = new Date('2026-10-20T16:00:00Z'); // Tue Oct 20, noon New York
  const legacy = await readDayQuotas(query, Promise.resolve(query), now);
  assert.equal(legacy.slots, undefined);
  assert.equal(legacy.reels, 3);
  await setSlotSource(query as never, 'template', 't');
  await applySlotChanges(query as never, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'reels', startMinute: 1080, series: null, action: 'remove' }], { by: 't', now });
  const q = await readDayQuotas(query, Promise.resolve(query), now);
  assert.deepEqual([q.reels, q.carousels, q.explainers, q.last_few_days, q.lfdDays], [2, 0, 2, 1, []]);
  assert.equal(Object.keys(q.slots!).length, 29);
  assert.ok(q.slots!['2026-10-13'] && q.slots!['2026-11-10'], 'today − 7 … today + 21');
  // Over the daily limit: only the limit counts.
  await writeCaps(query as never, { explainers: 1 });
  assert.equal((await readDayQuotas(query, Promise.resolve(query), now)).explainers, 1);
});

// ── Placement on free times ──

const NOW = new Date('2026-10-20T04:00:00Z'); // Tue Oct 20, midnight New York
const WED = '2026-10-21';
const first = () => 0;

async function itemFor(pg: Awaited<ReturnType<typeof openHubTestDb>>['pg'], vertical: string, ref: string): Promise<string> {
  const format = vertical === 'carousels' ? 'feed' : 'reel';
  return (await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ($1, $2, $3) RETURNING id::text AS id`, [vertical, format, ref])).rows[0]!.id;
}

const nyMinute = (iso: string | Date) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).split(':').map(Number);
  return p[0]! * 60 + p[1]!;
};

test('template: an Explainer at 12:00 is placed (the old windows refused it), and its free time joins the calendar', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  const legacy = await planPlacement(q, { vertical: 'explainers', nyDate: WED, slot: 't0720', now: NOW });
  assert.equal(legacy.ok, false, 'legacy has no 12:00 window');
  assert.match((legacy as { note: string }).note, /Explainers have no “t0720” slot/);

  await setSlotSource(q, 'template', 't');
  const plan = await planPlacement(q, { vertical: 'explainers', nyDate: WED, slot: 't0720', now: NOW, rng: first });
  assert.ok(plan.ok, (plan as { note?: string }).note);
  assert.equal(plan.slot, 't0720');
  assert.equal(plan.publishAt.toISOString(), '2026-10-21T16:00:00.000Z', '12:00 PM New York');
  assert.equal(plan.feedMode, 'main');

  const item = await itemFor(pg, 'explainers', 'e1');
  const placed = await placeItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0720', now: NOW });
  assert.ok(placed.ok, placed.note);
  const row = (await pg.query<{ slot: string; feed_mode: string; publish_at: string; source: string }>(`SELECT slot, feed_mode, publish_at, source FROM social_hub.schedule WHERE content_item_id = $1`, [item])).rows[0]!;
  assert.deepEqual([row.slot, row.feed_mode, row.source], ['t0720', 'main', 'user']);
  const m = nyMinute(row.publish_at);
  assert.ok(m >= 720 && m <= 735, `publish minute ${m}`);
  const day = (await loadSlots(q, WED, WED)).get(WED)!.filter((s) => s.vertical === 'explainers');
  assert.deepEqual(day.map((s) => [s.startMinute, s.feedMode, s.origin]), [[720, 'main', 'override'], [780, 'main', 'template'], [930, 'main', 'template']]);

  // Placing into a slot the calendar already has adds nothing to it.
  const item2 = await itemFor(pg, 'explainers', 'e2');
  assert.ok((await placeItem(q, { vertical: 'explainers', itemId: item2, nyDate: WED, slot: 't0780', now: NOW })).ok);
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.slot_override WHERE start_minute = 780`)).rows.length, 0);
});

test('the place and reschedule routes take free-time slot ids as well as window ids', () => {
  const body = (slot: string) => ({ vertical: 'explainers', refs: { itemId: '00000000-0000-4000-8000-000000000001' }, nyDate: WED, slot });
  assert.equal(parsePlacement(body('t0720'))?.input?.slot, 't0720');
  assert.equal(parsePlacement(body('t0510:morning_download'))?.input?.slot, 't0510:morning_download');
  assert.equal(parsePlacement(body('afternoon'))?.input?.slot, 'afternoon');
  assert.equal(parsePlacement(body('t07200')), null);
  assert.equal(parsePlacement(body('T0720')), null);
});

test('template: a placement at a minute a booked slot already holds is refused with the rules\' reason', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  const a = await itemFor(pg, 'explainers', 'e1');
  const b = await itemFor(pg, 'explainers', 'e2');
  assert.ok((await placeItem(q, { vertical: 'explainers', itemId: a, nyDate: WED, slot: 't0720', now: NOW })).ok);
  const dup = await placeItem(q, { vertical: 'explainers', itemId: b, nyDate: WED, slot: 't0720', now: NOW });
  assert.deepEqual(dup, { ok: false, note: 'Explainer already has a slot at 12:00 PM.' });
  const planned = await planPlacement(q, { vertical: 'explainers', nyDate: WED, slot: 't0780', now: NOW });
  assert.ok(planned.ok, 'the free 1:00 PM slot still plans');
  // The rules' other refusals come through the same way: Carousels on a Last Few Days Tuesday, outside the day.
  const carousel = await planPlacement(q, { vertical: 'carousels', nyDate: '2026-10-20', slot: 't0600', now: NOW });
  assert.equal(carousel.ok, false);
  assert.match((carousel as { note: string }).note, /Carousels are off/);
  const late = await planPlacement(q, { vertical: 'reels', nyDate: WED, slot: 't1275', now: NOW });
  assert.deepEqual(late, { ok: false, note: 'Slots run from 8 AM to 9 PM.' });
});

test('template: a time already passed today lands at the next 15-minute mark (Review Focus 2)', async () => {
  const { query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  const noonish = new Date('2026-10-21T16:05:00Z'); // Wed 12:05 PM New York
  const plan = await planPlacement(q, { vertical: 'explainers', nyDate: WED, slot: 't0720', now: noonish, rng: first });
  assert.ok(plan.ok, (plan as { note?: string }).note);
  assert.equal(plan.slot, 't0735');
  assert.equal(nyMinute(plan.publishAt), 735);
  // A slot whose drift minutes are still ahead keeps its own time.
  const open = await planPlacement(q, { vertical: 'reels', nyDate: WED, slot: 't0675', now: new Date('2026-10-21T15:20:00Z'), rng: first });
  assert.ok(open.ok);
  assert.equal(open.slot, 't0675');
  assert.ok(nyMinute(open.publishAt) >= 680);
});

test('template: hub placement reads the wall clock on a DST day (Sun Nov 1, 10:00 AM EST: a 10:30 slot has not passed) (final review #6)', async () => {
  const { query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  const tenAm = new Date('2026-11-01T15:00:00Z'); // 10:00 AM EST; 11 hours after New York midnight (EDT)
  const plan = await planPlacement(q, { vertical: 'explainers', nyDate: '2026-11-01', slot: 't0630', now: tenAm, rng: first });
  assert.ok(plan.ok, (plan as { note?: string }).note);
  assert.equal(plan.slot, 't0630');
  assert.equal(nyMinute(plan.publishAt), 630);
});

test('template: a window-era Stories booking holds the slot legacyKey gives it, whatever the series window says (final review #7)', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  await pg.query(`INSERT INTO stories.settings (key, value) VALUES ('series', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ morning_download: { window: { start: '09:00', end: '10:30' } } })]);
  const item = (await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('stories', 'story', 'set-1') RETURNING id::text AS id`)).rows[0]!.id;
  await pg.query(`INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'stories', $2, 'morning_download', '2026-10-21T12:35:00Z', 'scheduled', 'auto')`, [item, WED]);
  const md = (await openSlots(q, 'stories', WED, { now: NOW })).filter((s) => s.slot.endsWith(':morning_download'));
  assert.deepEqual(md.map((s) => [s.slot, s.state]), [['t0510:morning_download', 'taken']]);
});

test('template: a Main reel slot is spaced from feed posts and stores its feed mode; a Trial one is not spaced', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: WED, vertical: 'reels', startMinute: 525, series: null, action: 'add', feedMode: 'main' }], { by: 't', now: NOW });
  // A carousel booked at 9:10 AM New York on Wednesday keeps the 30-minute gap from 8:40 to 9:40.
  const carousel = await itemFor(pg, 'carousels', 'c1');
  await pg.query(`INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'carousels', $2, 't0540', '2026-10-21T13:10:00Z', 'scheduled', 'auto')`, [carousel, WED]);
  const main = await planPlacement(q, { vertical: 'reels', nyDate: WED, slot: 't0525', now: NOW, rng: first });
  assert.ok(main.ok);
  assert.equal(main.publishAt.toISOString(), '2026-10-21T13:40:00.000Z', 'pushed past the gap');
  assert.equal(main.feedMode, 'main');
  const trial = await planPlacement(q, { vertical: 'reels', nyDate: WED, slot: 't0675', now: NOW, rng: first });
  assert.ok(trial.ok);
  assert.equal(trial.publishAt.toISOString(), '2026-10-21T15:15:00.000Z');

  const reel = await itemFor(pg, 'reels', 'r1');
  const placed = await placeItem(q, { vertical: 'reels', itemId: reel, nyDate: WED, slot: 't0675', now: NOW, rng: first });
  assert.ok(placed.ok, placed.note);
  const mode = async () => (await pg.query<{ feed_mode: string | null; slot: string }>(`SELECT feed_mode, slot FROM social_hub.schedule WHERE content_item_id = $1`, [reel])).rows[0]!;
  assert.deepEqual(await mode(), { feed_mode: 'trial', slot: 't0675' });
  const moved = await rescheduleItem(q, { vertical: 'reels', itemId: reel, nyDate: WED, slot: 't0525', now: NOW, rng: first });
  assert.ok(moved.ok, moved.note);
  assert.deepEqual(await mode(), { feed_mode: 'main', slot: 't0525' });
  // Moving back into its own slot is fine; a legacy window id reads as that window's start.
  assert.ok((await rescheduleItem(q, { vertical: 'reels', itemId: reel, nyDate: WED, slot: 'morning', now: NOW, rng: first })).ok);
  assert.deepEqual(await mode(), { feed_mode: 'main', slot: 't0525' });
});

test('template: a Trial Explainer slot is not spaced; a Main one is', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: WED, vertical: 'explainers', startMinute: 780, series: null, action: 'add', feedMode: 'trial' }], { by: 't', now: NOW });
  // Carousels booked at 1:10 PM and 3:40 PM New York on Wednesday.
  const c1 = await itemFor(pg, 'carousels', 'c1');
  const c2 = await itemFor(pg, 'carousels', 'c2');
  await pg.query(`INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES
    ($1, 'carousels', $3, 't0540', '2026-10-21T17:10:00Z', 'scheduled', 'auto'),
    ($2, 'carousels', $3, 't0870', '2026-10-21T19:40:00Z', 'scheduled', 'auto')`, [c1, c2, WED]);
  const trial = await planPlacement(q, { vertical: 'explainers', nyDate: WED, slot: 't0780', now: NOW, rng: first });
  assert.ok(trial.ok);
  assert.equal(trial.publishAt.toISOString(), '2026-10-21T17:00:00.000Z', '1:00 PM, ten minutes from the carousel');
  assert.equal(trial.feedMode, 'trial');
  const main = await planPlacement(q, { vertical: 'explainers', nyDate: WED, slot: 't0930', now: NOW, rng: first });
  assert.ok(main.ok);
  assert.equal(main.publishAt.toISOString(), '2026-10-21T20:10:00.000Z', '4:10 PM, thirty minutes after the carousel');
  assert.equal(main.feedMode, 'main');
});

test('template: openSlots lists the day\'s slot times, free or taken', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: WED, vertical: 'reels', startMinute: 1080, series: null, action: 'remove' }], { by: 't', now: NOW });
  const reel = await itemFor(pg, 'reels', 'r1');
  assert.ok((await placeItem(q, { vertical: 'reels', itemId: reel, nyDate: WED, slot: 't0675', now: NOW })).ok);
  const picker = await openSlots(q, 'reels', WED, { now: NOW });
  assert.deepEqual(picker.map((s) => [s.slot, s.name, s.window, s.state]), [['t0525', '8:45 AM', '8:45–9:00 AM', 'free'], ['t0675', '11:15 AM', '11:15–11:30 AM', 'taken']]);
  // Last Few Days Tuesday: no carousel slots at all.
  assert.deepEqual(await openSlots(q, 'carousels', '2026-10-20', { now: NOW }), []);
  // Stories by series: a bare series id books its first slot that day; Stories never add a slot.
  const md = await planPlacement(q, { vertical: 'stories', nyDate: WED, slot: 'morning_download', now: NOW });
  assert.ok(md.ok);
  assert.equal(md.slot, 't0510:morning_download');
  const gtn = await planPlacement(q, { vertical: 'stories', nyDate: WED, slot: 'guess_the_number', now: NOW });
  assert.equal(gtn.ok, false);
  assert.match((gtn as { note: string }).note, /Add it on the calendar first/);
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

test('legacy placement is unchanged: window ids, no feed mode stored, old weekday rule (Review Focus 5)', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  const reel = await itemFor(pg, 'reels', 'r1');
  const plan = await planPlacement(q, { vertical: 'reels', nyDate: WED, slot: 'evening', now: NOW });
  assert.ok(plan.ok);
  assert.equal(plan.feedMode, null);
  const placed = await placeItem(q, { vertical: 'reels', itemId: reel, nyDate: WED, slot: 'evening', now: NOW });
  assert.ok(placed.ok, placed.note);
  const moved = await rescheduleItem(q, { vertical: 'reels', itemId: reel, nyDate: WED, slot: 'midday', now: NOW });
  assert.ok(moved.ok, moved.note);
  const row = (await pg.query<{ feed_mode: string | null; slot: string }>(`SELECT feed_mode, slot FROM social_hub.schedule WHERE content_item_id = $1`, [reel])).rows[0]!;
  assert.deepEqual(row, { feed_mode: null, slot: 'midday' });
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.slot_override`)).rows.length, 0, 'legacy never touches the calendar');
  // Last Few Days keeps its weekday rule: Wednesday isn't one of its days.
  const lfd = await planPlacement(q, { vertical: 'last_few_days', nyDate: WED, slot: 'morning', now: NOW });
  assert.equal(lfd.ok, false);
  assert.match((lfd as { note: string }).note, /doesn’t post on Wednesdays/);
  const picker = await openSlots(q, 'reels', WED, { now: NOW });
  assert.deepEqual(picker.map((s) => [s.slot, s.state]), [['morning', 'free'], ['midday', 'taken'], ['evening', 'free']]);
});

// ── Type pages: the calendar owns when (spec §4); the daily limit lives here ──

async function appDb() {
  const { pg, query } = await openHubTestDb();
  const run = (text: string, params?: unknown[]) => pg.query(text, params as unknown[]);
  poolHolder.__outreachHubPool = { query: run };
  poolHolder.__explainersDb = Promise.resolve({ query: run, transaction: (fn: (tx: unknown) => Promise<unknown>) => pg.transaction((tx) => fn({ query: (t: string, p?: unknown[]) => tx.query(t, p as unknown[]) })) });
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

test('the daily limit: read in template mode (null while legacy), written 0–10 through writeCaps', async () => {
  const { query } = await appDb();
  const q = query as never;
  assert.equal((await readPosting('explainers')).cap, null);
  await assert.rejects(() => writePosting('explainers', { cap: 4 }, 't'), /calendar/);
  await setSlotSource(q, 'template', 't');
  assert.equal((await readPosting('explainers')).cap, 3);
  assert.equal((await readPosting('stories')).cap, 2, 'Stories: per series');
  const saved = await writePosting('explainers', { cap: 4 }, 't');
  assert.equal(saved.cap, 4);
  assert.equal((await readCaps(q)).explainers, 4);
  assert.equal((await readCaps(q)).reels, 5, 'the other types keep theirs');
  await assert.rejects(() => writePosting('explainers', { cap: 11 }, 't'), /from 0 to 10/);
  await assert.rejects(() => writePosting('explainers', { cap: 1.5 }, 't'), /from 0 to 10/);
  await assert.rejects(() => writePosting('last_few_days', { cap: 2 }, 't'), /once a day/);
  assert.equal((await readCaps(q)).explainers, 4, 'a refused change writes nothing');
  // Today's perDay is the slots under the limit.
  await writePosting('reels', { cap: 2 }, 't');
  assert.equal((await readPosting('reels', new Date('2026-10-20T14:00:00Z'))).perDay, 2);
});

test('costPerPost: the average cost of a type\'s posts over the last 14 days, each item once; null with none', () => {
  const now = new Date('2026-10-20T16:00:00Z');
  const post = (o: Partial<HubPost>) => ({ vertical: 'explainers', nyDate: '2026-10-19', generatedAt: null, costMicros: 400_000, costItemKey: 'a', ...o }) as HubPost;
  const posts = [
    post({}),
    post({ costItemKey: 'a' }), // the same item twice counts once
    post({ costItemKey: 'b', costMicros: 600_000, nyDate: '2026-10-07' }),
    post({ costItemKey: 'c', costMicros: 9_000_000, nyDate: '2026-10-06' }), // 15 days back
    post({ costItemKey: 'd', costMicros: null }),
    post({ costItemKey: 'e', vertical: 'reels', costMicros: 5_000_000 }),
    post({ costItemKey: 'f', nyDate: null, generatedAt: '2026-10-20T08:00:00Z', costMicros: 200_000 }),
    // Counted by the day it was made: last night's post booked for tomorrow counts; one made 20 days ago doesn't.
    post({ costItemKey: 'g', nyDate: '2026-10-21', generatedAt: '2026-10-20T06:00:00Z', costMicros: 400_000 }),
    post({ costItemKey: 'h', nyDate: '2026-10-20', generatedAt: '2026-09-30T06:00:00Z', costMicros: 9_000_000 }),
  ];
  assert.equal(costPerPost(posts, 'explainers', now), 400_000);
  assert.equal(costPerPost(posts, 'carousels', now), null);
  assert.equal(costPerPost([], 'explainers', now), null);
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
  assert.deepEqual(monday.series, ['guess_the_number', 'morning_download'], 'in slot order');
  assert.equal(stories.some((d) => d.override), false);
  // The cost line's input: the route works it out from the hub's posts (costPerPost); readPosting leaves it null.
  const explainer = { vertical: 'explainers', nyDate: null, generatedAt: new Date().toISOString(), costMicros: 300_000, costItemKey: 'x' } as HubPost;
  assert.equal(costPerPost([explainer], 'explainers', new Date()), 300_000);
  assert.equal((await readPosting('explainers')).costPerPostMicros, null);
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
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'reels', startMinute: 1080, series: null, action: 'remove' }], { by: 't', now: TUE });
  assert.equal((await readPosting('reels', TUE)).perDay, 2, 'today\'s slots, not posts_per_day');
  assert.deepEqual((await readPosting('last_few_days', TUE)).days, [2, 5]);
  // Seeded from the series' own days, so they match legacy; then a Thursday add shows up.
  const daysOf = (state: Awaited<ReturnType<typeof readPosting>>) => Object.fromEntries((state.series ?? []).map((x) => [x.id, x.days]));
  assert.deepEqual(daysOf(await readPosting('stories', TUE)), daysOf(legacyStories));
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-22', vertical: 'stories', startMinute: 510, series: 'free_vs_paid', action: 'add' }], { by: 't', now: TUE });
  assert.ok(daysOf(await readPosting('stories', TUE)).free_vs_paid!.includes(4));
});

// ── Run now's Stories ──

test('Run now\'s Stories due list follows the calendar\'s open Stories slots in template mode, like the 4 AM worker', async () => {
  const { query } = await appDb();
  const q = query as never;
  const series = [
    { id: 'morning_download', label: 'MD', enabled: true, days: [4] },
    { id: 'free_vs_paid', label: 'FP', enabled: true, days: [1] },
  ];
  const THU = '2026-10-22';
  const THU_7AM = new Date('2026-10-22T11:00:00Z');
  assert.equal(await storiesSlotsOn(q, THU), null, 'legacy: no slots');
  assert.deepEqual(seriesDueToday(series, THU, new Set(), null).map((s) => s.id), ['morning_download'], 'legacy: own days');
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [
    { scope: 'date', op: 'put', nyDate: THU, vertical: 'stories', startMinute: 510, series: 'morning_download', action: 'remove' },
    { scope: 'date', op: 'put', nyDate: THU, vertical: 'stories', startMinute: 510, series: 'free_vs_paid', action: 'add' },
  ], { by: 't', now: new Date('2026-10-20T14:00:00Z') });
  const open = await openStorySlots(liveStoriesDb, (await storiesSlotsOn(q, THU))!, THU_7AM);
  const dueOn = (id: string) => ((open.get(id as never)?.open.length ?? 0) > 0);
  assert.deepEqual(seriesDueToday(series, THU, new Set(), dueOn), [{ id: 'free_vs_paid', label: 'FP', held: false }]);
});

test('Run now\'s Stories Generate makes the set for the first open Stories slot in template mode, so a second slot is not "Already requested"', async () => {
  const { pg, query } = await appDb();
  const q = query as never;
  const TUE = '2026-10-20';
  const TUE_7AM = new Date('2026-10-20T11:00:00Z');
  const minutes = async () => (await pg.query<{ m: number | null }>(`SELECT slot_minute AS m FROM stories.sets WHERE series = 'morning_download' ORDER BY slot_minute NULLS FIRST`)).rows.map((r) => r.m);

  // Legacy: one set with no slot; a second click is already requested.
  assert.deepEqual(await requestStorySets(['morning_download'], 't', TUE_7AM), ['morning_download']);
  assert.deepEqual(await requestStorySets(['morning_download'], 't', TUE_7AM), []);
  assert.deepEqual(await minutes(), [null]);
  await pg.query(`DELETE FROM stories.sets`);

  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: TUE, vertical: 'stories', startMinute: 900, series: 'morning_download', action: 'add' }], { by: 't', now: TUE_7AM });
  assert.deepEqual(await requestStorySets(['morning_download'], 't', TUE_7AM), ['morning_download']);
  assert.deepEqual(await minutes(), [510]);
  assert.deepEqual(await requestStorySets(['morning_download'], 't', TUE_7AM), ['morning_download'], 'the 3:00 PM slot is still open');
  assert.deepEqual(await minutes(), [510, 900]);
  assert.deepEqual(await requestStorySets(['morning_download'], 't', TUE_7AM), [], 'every slot has its set');
  assert.deepEqual(await minutes(), [510, 900]);
});

// ── Fix round 1: a move takes its slot along, atomically (R15, R16) ──

const slotsOf = async (q: never, nyDate: string, vertical: string) =>
  ((await loadSlots(q, nyDate, nyDate)).get(nyDate) ?? []).filter((x) => x.vertical === vertical).map((x) => [x.startMinute, x.feedMode]);

test('template: a reschedule to a new time moves its slot (no empty slot left), keeps its Trial / Main, and repeated moves don\'t pile up', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: WED, vertical: 'explainers', startMinute: 780, series: null, action: 'add', feedMode: 'trial' }], { by: 't', now: NOW });
  const item = await itemFor(pg, 'explainers', 'e1');
  assert.ok((await placeItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0780', now: NOW })).ok);
  const moved = await rescheduleItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0720', now: NOW, by: 'tommy' });
  assert.ok(moved.ok, moved.note);
  assert.deepEqual(await slotsOf(q, WED, 'explainers'), [[720, 'trial'], [930, 'main']], '1:00 PM left with its post, as Trial');
  const row = async () => (await pg.query<{ slot: string; feed_mode: string }>(`SELECT slot, feed_mode FROM social_hub.schedule WHERE content_item_id = $1`, [item])).rows[0]!;
  assert.deepEqual(await row(), { slot: 't0720', feed_mode: 'trial' });
  assert.ok((await rescheduleItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0840', now: NOW, by: 'tommy' })).ok);
  assert.deepEqual(await slotsOf(q, WED, 'explainers'), [[840, 'trial'], [930, 'main']]);
  const overrides = (await pg.query<{ start_minute: number; action: string; updated_by: string }>(`SELECT start_minute, action, updated_by FROM social_hub.slot_override WHERE vertical = 'explainers' ORDER BY start_minute`)).rows;
  assert.deepEqual(overrides.map((o) => [o.start_minute, o.action]), [[780, 'remove'], [840, 'add']], 'the 12:00 add is gone, not left behind');
  assert.equal(overrides.find((o) => o.start_minute === 840)!.updated_by, 'tommy');
  // Into a slot the calendar already has: the post moves, the slots stay as they are.
  assert.ok((await rescheduleItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0930', now: NOW })).ok);
  assert.deepEqual(await slotsOf(q, WED, 'explainers'), [[840, 'trial'], [930, 'main']]);
  // Across days: Wednesday's 11:15 Text on Screen slot goes to Thursday at 11:45.
  const reel = await itemFor(pg, 'reels', 'r1');
  assert.ok((await placeItem(q, { vertical: 'reels', itemId: reel, nyDate: WED, slot: 't0675', now: NOW })).ok);
  assert.ok((await rescheduleItem(q, { vertical: 'reels', itemId: reel, nyDate: '2026-10-22', slot: 't0705', now: NOW })).ok);
  assert.deepEqual((await slotsOf(q, WED, 'reels')).map(([m]) => m), [525, 1080]);
  assert.deepEqual((await slotsOf(q, '2026-10-22', 'reels')).map(([m]) => m), [525, 675, 705, 1080]);
});

test('template: the booking and its calendar slot land together; a failed override rolls the booking back', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  const item = await itemFor(pg, 'explainers', 'e1');
  assert.ok((await placeItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0780', now: NOW })).ok);
  await pg.exec(`CREATE FUNCTION social_hub.no_override() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'override write failed'; END $$;
    CREATE TRIGGER no_override BEFORE INSERT OR UPDATE OR DELETE ON social_hub.slot_override FOR EACH ROW EXECUTE FUNCTION social_hub.no_override();`);
  await assert.rejects(() => rescheduleItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0720', now: NOW }), /override write failed/);
  assert.equal((await pg.query<{ slot: string }>(`SELECT slot FROM social_hub.schedule WHERE content_item_id = $1`, [item])).rows[0]!.slot, 't0780', 'the move rolled back');
  const fresh = await itemFor(pg, 'explainers', 'e2');
  await assert.rejects(() => placeItem(q, { vertical: 'explainers', itemId: fresh, nyDate: WED, slot: 't0720', now: NOW }), /override write failed/);
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.schedule WHERE content_item_id = $1`, [fresh])).rows.length, 0, 'no booking without its slot');
});

test('template: placing into a Standard-week time the date removed brings it back with the Standard week\'s Trial / Main, as no override', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'template', op: 'put', weekday: 3, vertical: 'explainers', startMinute: 780, series: null, feedMode: 'trial' }], { by: 't', now: NOW });
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: WED, vertical: 'explainers', startMinute: 780, series: null, action: 'remove' }], { by: 't', now: NOW });
  const item = await itemFor(pg, 'explainers', 'e1');
  const placed = await placeItem(q, { vertical: 'explainers', itemId: item, nyDate: WED, slot: 't0780', now: NOW });
  assert.ok(placed.ok, placed.note);
  assert.deepEqual(await slotsOf(q, WED, 'explainers'), [[780, 'trial'], [930, 'main']]);
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.slot_override WHERE ny_date = $1 AND vertical = 'explainers'`, [WED])).rows.length, 0, 'the date matches its Standard week again');
  assert.equal((await pg.query<{ feed_mode: string }>(`SELECT feed_mode FROM social_hub.schedule WHERE content_item_id = $1`, [item])).rows[0]!.feed_mode, 'trial');
});

test('R15: the type page\'s Stories Generate books into the first open Stories slot in template mode, says so when none is open, and is unchanged in legacy', async () => {
  const { pg, query } = await appDb();
  const q = query as never;
  const db = pgliteDb(pg);
  const TUE_7AM = new Date('2026-10-20T11:00:00Z');
  const minutes = async () => (await pg.query<{ m: number | null }>(`SELECT slot_minute AS m FROM stories.sets WHERE series = 'morning_download' ORDER BY slot_minute NULLS FIRST`)).rows.map((r) => r.m);
  assert.equal((await generateNow(db, 'morning_download', 't', TUE_7AM)).created, true);
  assert.deepEqual(await minutes(), [null], 'legacy: a set with no slot');
  await pg.query(`DELETE FROM stories.sets`);
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'stories', startMinute: 900, series: 'morning_download', action: 'add' }], { by: 't', now: TUE_7AM });
  assert.equal((await generateNow(db, 'morning_download', 't', TUE_7AM)).created, true);
  assert.equal((await generateNow(db, 'morning_download', 't', TUE_7AM)).created, true, 'the second slot is not "already requested"');
  assert.deepEqual(await minutes(), [510, 900]);
  await assert.rejects(() => generateNow(db, 'morning_download', 't', TUE_7AM), (e: unknown) => e instanceof ApiError && e.status === 409 && e.message === NO_OPEN_SLOT);
});

test('R15: moving a Story set on the calendar keeps its slot_minute with its time, takes t####:series ids, and refuses a time with no Stories slot', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  const db = pgliteDb(pg);
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: WED, vertical: 'stories', startMinute: 900, series: 'morning_download', action: 'add' }], { by: 't', now: NOW });
  const SET = '70000000-0000-4000-8000-000000000001';
  await pg.query(`INSERT INTO stories.sets (id, series, ny_date, status, trigger, style, approved_at, slot_minute) VALUES ($1, 'morning_download', $2, 'approved', 'click', 'polished', now(), 510)`, [SET, WED]);
  const act = storyActions({
    approve: async () => undefined, reject: async () => undefined, publishNow: async () => undefined, regenerate: async () => undefined,
    query: q,
    getSet: (id) => getSet(db, id),
    slotOf: (id) => activeSlotByRef(q, 'stories', id),
    plan: (h, input) => planPlacement(h, { ...input, now: NOW, rng: first }),
    rescheduleSet: (id, nyDate, at, minute) => db.transaction((tx) => rescheduleSet(tx, id, nyDate, at, minute)),
    unscheduleSet: async () => ({ ok: false, note: 'not under test' }),
  });
  assert.ok((await act.place!({ setId: SET }, 'tommy', { nyDate: WED, slot: 'morning_download' })).ok);
  const set = async () => (await pg.query<{ slot_minute: number; publish_at: string }>(`SELECT slot_minute, publish_at FROM stories.sets WHERE id = $1`, [SET])).rows[0]!;
  const spineSlot = async () => (await pg.query<{ slot: string }>(`SELECT s.slot FROM social_hub.schedule s WHERE s.vertical = 'stories' AND s.status = 'scheduled'`)).rows.map((r) => r.slot);
  assert.equal((await set()).slot_minute, 510);
  const moved = await act.reschedule!({ setId: SET }, 'tommy', { nyDate: WED, slot: 't0900:morning_download' });
  assert.ok(moved.ok, moved.note);
  assert.equal((await set()).slot_minute, 900);
  assert.equal(nyMinute((await set()).publish_at), 900);
  assert.deepEqual(await spineSlot(), ['t0900:morning_download'], 'the spine follows the set\'s slot');
  const none = await act.reschedule!({ setId: SET }, 'tommy', { nyDate: WED, slot: 't1200:morning_download' });
  assert.equal(none.ok, false);
  assert.match(none.note, /Add it on the calendar first/);
  const other = await act.reschedule!({ setId: SET }, 'tommy', { nyDate: WED, slot: 't0510:free_vs_paid' });
  assert.equal(other.ok, false, 'another series\' slot');
  assert.equal((await set()).slot_minute, 900);
});
