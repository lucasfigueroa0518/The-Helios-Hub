// tests/slots-schedulers.test.ts (part 1: reels and explainers; part 2: carousels, Last Few Days, the 3 AM switch, Stories)
/** The schedulers follow the calendar in template mode and are unchanged in legacy mode (spec §5). Offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import type { Queryable } from '@/lib/explainers/db';
import { scheduleJob } from '@/lib/explainers/publish/schedule';
import { slotTakenKey } from '@/lib/instagram/window';
import { threeAmQueue } from '@/lib/lfd/clock';
import { scheduleLfdPost } from '@/lib/lfd/schedule';
import { parseLfdSettings } from '@/lib/lfd/settings';
import { reelsPerDay } from '@/lib/reels/pipeline/fill';
import { reelTaken, schedulePostIdea, toTakenKey, windowsStillOpen } from '@/lib/reels/publish/schedule';
import { POSTING_SLOTS, slotKey } from '@/lib/reels/publish/slots';
import { reportCarousels } from '@/lib/social-hub/health/reporters/carousels';
import { quotaFromSlots, slotPlan, storiesDueOn } from '@/lib/social-hub/slots';
import { chooseByFeedMode } from '@/lib/social-hub/slots/choose';
import { applySlotChanges, setSlotSource } from '@/lib/social-hub/slots/write';
import type { PostingState } from '@/lib/content-type/posting';
import { carouselFill, schedulePost } from '@/lib/social/overnight/schedule';
import { requestAutoSets } from '@/lib/stories/schedule';
import { loadSettings, saveSeriesSetting } from '@/lib/stories/settings';

import { scratchExplainersDb } from './explainers-pglite';
import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';
import { harnessDb } from './stories-harness';

const NOW = new Date('2026-10-20T04:00:00Z'); // Tue Oct 20, midnight New York
const first = () => 0;

test('chooseByFeedMode: a trial slot is picked with no spacing, a main slot avoids busy feed times', () => {
  const trialOnly = { trial: new Set(['2026-10-20|morning']), main: new Set<string>() };
  const taken = new Set(['2026-10-20|midday', '2026-10-20|evening']);
  // Busy at 8:45 does not stop a trial reel at 8:45 (D33).
  const busy = [new Date('2026-10-20T12:45:00Z')];
  const t = chooseByFeedMode(POSTING_SLOTS, NOW, taken, trialOnly, busy, first, '2026-10-20')!;
  assert.equal(t.publishAt.toISOString(), '2026-10-20T12:45:00.000Z');
  // The same window as Main moves ≥ 30 minutes off the busy instant.
  const mainOnly = { trial: new Set<string>(), main: new Set(['2026-10-20|morning']) };
  const m = chooseByFeedMode(POSTING_SLOTS, NOW, taken, mainOnly, busy, first, '2026-10-20')!;
  assert.ok(m.publishAt.getTime() - busy[0]!.getTime() >= 30 * 60_000);
});

test('chooseByFeedMode picks the earliest across modes', () => {
  const modes = { trial: new Set(['2026-10-20|evening']), main: new Set(['2026-10-20|morning']) };
  const c = chooseByFeedMode(POSTING_SLOTS, NOW, new Set(['2026-10-20|midday']), modes, [], first, '2026-10-20')!;
  assert.equal(c.slot, 'morning');
});

test('reelTaken: every reels window that is not a slot is taken, on top of the booked ones', async () => {
  const { query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'reels', windowId: 'morning', action: 'remove', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  const plan = (await slotPlan(q, '2026-10-20'))!;
  const taken = reelTaken(plan, new Set([toTakenKey(slotKey('2026-10-20', 'evening'))]), slotTakenKey);
  assert.deepEqual([...taken].sort(), ['2026-10-20|evening', '2026-10-21|morning']);
});

// ---- Text on Screen (reels): the app pool, pointed at PGlite like tests/reels-autopublish.test.ts ----

const IDEA = '71000000-0000-4000-8000-000000000001';
const SLATE = '71000000-0000-4000-8000-000000000002';
const RUN = '71000000-0000-4000-8000-000000000004';

async function reelsDb(): Promise<{ pg: PGlite; q: never }> {
  const { pg, query } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = {
    query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]),
  };
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${IDEA}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('${SLATE}', '${RUN}', '2026-10-20', now(), 'p1', 'p2');`);
  return { pg, q: query as never };
}

const reelSlots = async (pg: PGlite) =>
  (await pg.query<{ d: string; slot: string; feed_mode: string | null; publish_at: string }>(
    `SELECT ny_date::text AS d, slot, feed_mode, publish_at FROM social_hub.schedule WHERE vertical = 'reels'`,
  )).rows;

const LATE_TUESDAY = new Date('2026-10-21T02:00:00Z'); // Tue Oct 20, 10:00 PM New York: today's windows are over

test('reels legacy: unchanged booking (same slot as before this change)', async () => {
  const { pg } = await reelsDb();
  const out = await schedulePostIdea(IDEA, 'auto', null, NOW, '2026-10-20');
  assert.ok(out.scheduled);
  const [row] = await reelSlots(pg);
  // Legacy books exactly as before: the first window, no feed_mode written (it reads as trial).
  assert.deepEqual([row!.d, row!.slot, row!.feed_mode], ['2026-10-20', 'morning', null]);
  assert.match(out.note, /It posts as a trial reel\.$/);
  assert.equal(await reelsPerDay(NOW), 3, 'the posts_per_day default');
});

test('reels template: a removed window is never booked, and the slot\'s feed mode is stored', async () => {
  const { pg, q } = await reelsDb();
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [
    { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'reels', windowId: 'morning', action: 'remove', feedMode: null },
    { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'reels', windowId: 'midday', action: 'add', feedMode: 'main' },
  ], { by: 't', now: LATE_TUESDAY, keepBooked: false });
  const out = await schedulePostIdea(IDEA, 'auto', null, LATE_TUESDAY, '2026-10-21');
  assert.ok(out.scheduled);
  const [row] = await reelSlots(pg);
  assert.deepEqual([row!.d, row!.slot, row!.feed_mode], ['2026-10-21', 'midday', 'main']);
  assert.match(out.note, /It posts to the main feed\.$/);
  // The quota is the day's slot count: midday and evening.
  assert.equal(await reelsPerDay(new Date('2026-10-21T12:00:00Z')), 2);
  assert.equal(await quotaFromSlots(q, 'reels', '2026-10-21'), 2);
});

test('reels template: a main slot keeps 30 minutes from a feed post', async () => {
  const { pg, q } = await reelsDb();
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [
    { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'reels', windowId: 'morning', action: 'add', feedMode: 'main' },
  ], { by: 't', now: LATE_TUESDAY, keepBooked: false });
  // A carousel at 8:45 AM on Oct 21.
  const item = await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('carousels', 'feed', 'c-1') RETURNING id`);
  await pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'carousels', '2026-10-21', 'morning', '2026-10-21T12:45:00Z', 'scheduled', 'auto')`,
    [item.rows[0]!.id],
  );
  const out = await schedulePostIdea(IDEA, 'auto', null, LATE_TUESDAY, '2026-10-21');
  assert.ok(out.scheduled);
  const [row] = await reelSlots(pg);
  assert.equal(row!.slot, 'morning');
  assert.ok(new Date(row!.publish_at).getTime() - new Date('2026-10-21T12:45:00Z').getTime() >= 30 * 60_000);
});

test('reels template: a started window still takes a post today (Review Focus 4)', async () => {
  const { pg, q } = await reelsDb();
  await setSlotSource(q, 'template', 't');
  const inMorning = new Date('2026-10-20T13:00:00Z'); // 9:00 AM New York
  assert.equal(await windowsStillOpen(inMorning), 3);
  const out = await schedulePostIdea(IDEA, 'auto', null, inMorning, '2026-10-20');
  assert.ok(out.scheduled);
  const [row] = await reelSlots(pg);
  assert.deepEqual([row!.d, row!.slot, row!.feed_mode], ['2026-10-20', 'morning', 'trial']);
  assert.ok(new Date(row!.publish_at).getTime() > inMorning.getTime());
});

test('reels template: windowsStillOpen counts only today\'s slots', async () => {
  const { q } = await reelsDb();
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  assert.equal(await windowsStillOpen(NOW), 2);
});

// ---- Explainers: scheduleJob takes the injected handle ----

async function explainersDb(): Promise<{ db: Queryable; q: never; jobId: string }> {
  const { db } = await scratchExplainersDb();
  const { rows: t } = await db.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status) VALUES ('What is an API?', 'manual', 'rendered') RETURNING id`);
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at)
     VALUES ($1, 'ok', 'click', 'development', 5, 'm', 'm', now()) RETURNING id`,
    [t[0]!.id],
  );
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', 'v.mp4', 5000000, 'bucket')`, [j[0]!.id]);
  return { db, q: ((text: string, params?: unknown[]) => db.query(text, params)) as never, jobId: j[0]!.id };
}

const explainerSlots = async (db: Queryable) =>
  (await db.query<{ d: string; slot: string; feed_mode: string | null; publish_at: string }>(
    `SELECT ny_date::text AS d, slot, feed_mode, publish_at FROM social_hub.schedule WHERE vertical = 'explainers'`,
  )).rows;

test('explainers legacy: unchanged booking (same slot as before this change)', async () => {
  const { db, jobId } = await explainersDb();
  await db.query(`INSERT INTO explainers.settings (key, value) VALUES ('posts_per_day', '1'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const out = await scheduleJob(db, jobId, 'auto', NOW, undefined, first);
  assert.ok(out.scheduled);
  const [row] = await explainerSlots(db);
  assert.deepEqual([row!.d, row!.slot, row!.feed_mode], ['2026-10-20', 'afternoon', null]);
});

test('explainers template: a removed window is never booked, and the slot\'s feed mode is stored', async () => {
  const { db, q, jobId } = await explainersDb();
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [
    { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'explainers', windowId: 'afternoon', action: 'remove', feedMode: null },
    { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'explainers', windowId: 'late', action: 'add', feedMode: 'trial' },
  ], { by: 't', now: LATE_TUESDAY, keepBooked: false });
  const out = await scheduleJob(db, jobId, 'auto', LATE_TUESDAY, '2026-10-21', first);
  assert.ok(out.scheduled);
  const [row] = await explainerSlots(db);
  assert.deepEqual([row!.d, row!.slot, row!.feed_mode], ['2026-10-21', 'late', 'trial']);
  assert.equal(await quotaFromSlots(q, 'explainers', '2026-10-21'), 1);
});

test('explainers template: every window is a slot, whatever posts_per_day says', async () => {
  const { db, q, jobId } = await explainersDb();
  await db.query(`INSERT INTO explainers.settings (key, value) VALUES ('posts_per_day', '1'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await setSlotSource(q, 'template', 't');
  const afterFirst = new Date('2026-10-20T18:45:00Z'); // 2:45 PM New York: the afternoon window is over
  const out = await scheduleJob(db, jobId, 'auto', afterFirst, '2026-10-20', first);
  assert.ok(out.scheduled);
  assert.equal((await explainerSlots(db))[0]!.slot, 'late');
});

test('explainers template: a started window still takes a post today (Review Focus 4)', async () => {
  const { db, q, jobId } = await explainersDb();
  await setSlotSource(q, 'template', 't');
  const inAfternoon = new Date('2026-10-20T17:30:00Z'); // 1:30 PM New York
  const out = await scheduleJob(db, jobId, 'auto', inAfternoon, '2026-10-20', first);
  assert.ok(out.scheduled);
  const [row] = await explainerSlots(db);
  assert.deepEqual([row!.d, row!.slot, row!.feed_mode], ['2026-10-20', 'afternoon', 'main']);
  assert.ok(new Date(row!.publish_at).getTime() > inAfternoon.getTime());
});

// ---- Part 2: the 3 AM switch ----

const lfd = (autoRun: boolean) => parseLfdSettings([{ key: 'auto_run', value: autoRun }, { key: 'days', value: [2, 5] }]);

test('3 AM legacy is unchanged', () => {
  assert.equal(threeAmQueue('2026-10-20', lfd(true), true).queue, 'last_few_days');
  assert.equal(threeAmQueue('2026-10-20', lfd(false), true).queue, 'carousels');
  assert.equal(threeAmQueue('2026-10-21', lfd(true), false).queue, 'none');
});

test('3 AM template: the calendar decides; a paused LFD on its day runs nothing (Review Focus 5)', () => {
  assert.equal(threeAmQueue('2026-10-21', lfd(true), true, true).queue, 'last_few_days'); // Wednesday LFD override
  assert.equal(threeAmQueue('2026-10-20', lfd(true), true, false).queue, 'carousels'); // Tuesday with LFD removed
  const paused = threeAmQueue('2026-10-20', lfd(false), true, true);
  assert.equal(paused.queue, 'none');
  assert.match(paused.reason, /paused/);
});

// ---- Carousels and Last Few Days: the hub fixture (social, lfd and social_hub schemas) ----

const WED = '2026-10-21';
const WED_MORNING = new Date('2026-10-21T11:00:00Z'); // Wed Oct 21, 7:00 AM New York

/** Wednesday as a Last Few Days day: its LFD slot, and the Carousel windows taken off (the calendar refuses both on one day). */
const wednesdayLfd = [
  { scope: 'date', op: 'put', nyDate: WED, vertical: 'last_few_days', windowId: 'morning', action: 'add', feedMode: null },
  { scope: 'date', op: 'put', nyDate: WED, vertical: 'carousels', windowId: 'morning', action: 'remove', feedMode: null },
  { scope: 'date', op: 'put', nyDate: WED, vertical: 'carousels', windowId: 'afternoon', action: 'remove', feedMode: null },
] as const;

async function carouselDb(): Promise<{ q: never; postId: string }> {
  const { query } = await openHubTestDb();
  const { rows } = await query<{ id: string }>(
    `INSERT INTO social.posts (slug, title, status, render, origin, slide_objects)
     VALUES ('c-wed', 't', 'review', '{"caption":"A caption.","slides":[]}'::jsonb, 'pipeline', '["posts/c-wed/a.jpg"]'::jsonb) RETURNING id`,
  );
  return { q: query as never, postId: rows[0]!.id };
}

const slotsOf = async (q: never, vertical: string) =>
  ((await (q as (t: string, p?: unknown[]) => Promise<{ rows: Array<{ d: string; slot: string }> }>)(
    `SELECT ny_date::text AS d, slot FROM social_hub.schedule WHERE vertical = $1 AND status = 'scheduled'`,
    [vertical],
  )).rows).map((r) => [r.d, r.slot]);

test('carousels legacy: unchanged booking (the first open window)', async () => {
  const { q, postId } = await carouselDb();
  const out = await schedulePost(q, postId, 'auto', LATE_TUESDAY, WED, first);
  assert.ok(out.scheduled);
  assert.deepEqual(await slotsOf(q, 'carousels'), [[WED, 'morning']]);
  assert.equal((await carouselFill(q, WED_MORNING)).quota, 2, 'the posts_per_day default');
});

test('carousels template: a removed window is never booked', async () => {
  const { q, postId } = await carouselDb();
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: WED, vertical: 'carousels', windowId: 'morning', action: 'remove', feedMode: null }], { by: 't', now: LATE_TUESDAY, keepBooked: false });
  const out = await schedulePost(q, postId, 'auto', LATE_TUESDAY, WED, first);
  assert.ok(out.scheduled);
  assert.deepEqual(await slotsOf(q, 'carousels'), [[WED, 'afternoon']]);
});

test('carousels template: a Last Few Days day has no carousel window', async () => {
  const { q, postId } = await carouselDb();
  await setSlotSource(q, 'template', 't');
  assert.equal((await applySlotChanges(q, [...wednesdayLfd], { by: 't', now: LATE_TUESDAY, keepBooked: false })).ok, true);
  const out = await schedulePost(q, postId, 'auto', LATE_TUESDAY, WED, first);
  assert.equal(out.scheduled, false);
  assert.deepEqual(await slotsOf(q, 'carousels'), []);
});

test('carousels template: the day\'s quota is its slot count (2, 1, 0)', async () => {
  const { q } = await carouselDb();
  await (q as (t: string) => Promise<unknown>)(`INSERT INTO social.settings (key, value) VALUES ('posts_per_day', '5'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await setSlotSource(q, 'template', 't');
  assert.equal((await carouselFill(q, WED_MORNING)).quota, 2, 'posts_per_day no longer counts');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: WED, vertical: 'carousels', windowId: 'morning', action: 'remove', feedMode: null }], { by: 't', now: LATE_TUESDAY, keepBooked: false });
  assert.equal((await carouselFill(q, WED_MORNING)).quota, 1);
  await applySlotChanges(q, [...wednesdayLfd], { by: 't', now: LATE_TUESDAY, keepBooked: false });
  assert.equal((await carouselFill(q, WED_MORNING)).quota, 0);
});

test('last few days legacy: unchanged (Tuesday books, Wednesday refused)', async () => {
  const { query } = await openHubTestDb();
  const q = query as never;
  const tue = await seedLfdPost(query, { nyDate: '2026-10-20' });
  assert.ok((await scheduleLfdPost(q, tue, 'auto', NOW, '2026-10-20', first)).scheduled);
  const wed = await seedLfdPost(query, { nyDate: WED });
  assert.equal((await scheduleLfdPost(q, wed, 'auto', LATE_TUESDAY, WED, first)).scheduled, false);
});

test('last few days template: a Wednesday LFD slot books; Tuesday without its template row is refused', async () => {
  const { query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  await applySlotChanges(q, [...wednesdayLfd], { by: 't', now: LATE_TUESDAY, keepBooked: false });
  const wed = await seedLfdPost(query, { nyDate: WED });
  assert.ok((await scheduleLfdPost(q, wed, 'auto', LATE_TUESDAY, WED, first)).scheduled);
  assert.deepEqual(await slotsOf(q, 'last_few_days'), [[WED, 'morning']]);

  assert.equal((await applySlotChanges(q, [{ scope: 'template', op: 'delete', weekday: 2, vertical: 'last_few_days', windowId: 'morning' }], { by: 't', now: NOW, keepBooked: false })).ok, true);
  const tue = await seedLfdPost(query, { nyDate: '2026-10-20' });
  const out = await scheduleLfdPost(q, tue, 'auto', NOW, '2026-10-20', first);
  assert.equal(out.scheduled, false);
});

// ---- The carousel health reporter ----

const carouselPosting = { type: 'carousels', live: true, generate: true, autoPublish: false, perDay: 1, maxPerDay: 2, series: null } as unknown as PostingState;

test('carousel health: legacy gives Tuesday to LFD only while its auto_run is on; template follows the calendar, paused or not', async () => {
  const { query } = await openHubTestDb();
  const report = (night: string) => reportCarousels(query, { night, posting: carouselPosting, now: NOW });
  assert.equal((await report('2026-10-20')).needed, 1, 'legacy, LFD paused: Tuesday is an ordinary carousel night');
  await setSlotSource(query as never, 'template', 't');
  assert.equal((await report('2026-10-20')).needed, 0, 'template: Tuesday has the LFD slot (Decision 7)');
  assert.equal((await report(WED)).needed, 1, 'template: Wednesday keeps its carousels');
});

// ---- Stories: the stories harness (stories and social_hub schemas) ----

const THU = '2026-10-08';
const THU_NOW = new Date('2026-10-08T05:00:00Z'); // 1:00 AM New York, Thursday Oct 8

test('stories legacy: storiesDueOn is null and auto sets follow the series\' own days', async () => {
  const { db } = await harnessDb();
  const q = ((t: string, p?: unknown[]) => db.query(t, p)) as never;
  assert.equal(await storiesDueOn(q, THU), null);
  await saveSeriesSetting(db, 'guess_the_number', { auto: true });
  await saveSeriesSetting(db, 'free_vs_paid', { auto: true });
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), THU_NOW), ['guess_the_number']);
});

test('stories template: a series is due on its slot\'s dates only, and auto sets follow the calendar', async () => {
  const { db } = await harnessDb();
  const q = ((t: string, p?: unknown[]) => db.query(t, p)) as never;
  await saveSeriesSetting(db, 'guess_the_number', { auto: true });
  await saveSeriesSetting(db, 'free_vs_paid', { auto: true });
  await setSlotSource(q, 'template', 't');
  let dueOn = (await storiesDueOn(q, THU))!;
  assert.equal(dueOn('guess_the_number', THU), true, 'seeded from the series\' own days');
  assert.equal(dueOn('free_vs_paid', THU), false);
  await applySlotChanges(q, [
    { scope: 'date', op: 'put', nyDate: THU, vertical: 'stories', windowId: 'guess_the_number', action: 'remove', feedMode: null },
    { scope: 'date', op: 'put', nyDate: THU, vertical: 'stories', windowId: 'free_vs_paid', action: 'add', feedMode: null },
  ], { by: 't', now: THU_NOW, keepBooked: false });
  dueOn = (await storiesDueOn(q, THU))!;
  assert.equal(dueOn('guess_the_number', THU), false, 'removed for the day');
  assert.equal(dueOn('free_vs_paid', THU), true, 'added for the day');
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), THU_NOW, { dueOn }), ['free_vs_paid']);
});
