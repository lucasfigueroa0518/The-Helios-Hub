// tests/slots-caps.test.ts
/**
 * Template mode (week board spec): the four feed schedulers book at a slot's
 * own time, drifted into [slot, slot + 15], and never past the hidden daily
 * cap (Review Focus 4). Legacy stays as it was (tests/slots-schedulers.test.ts).
 * Offline PGlite.
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import type { Queryable } from '@/lib/explainers/db';
import { explainersQuota } from '@/lib/explainers/ideas/cycle';
import { scheduleJob } from '@/lib/explainers/publish/schedule';
import { scheduleLfdPost } from '@/lib/lfd/schedule';
import { reelsPerDay } from '@/lib/reels/pipeline/fill';
import { schedulePostIdea } from '@/lib/reels/publish/schedule';
import { carouselFill, schedulePost } from '@/lib/social/overnight/schedule';
import { applySlotChanges, setSlotSource, writeCaps, type SlotChange } from '@/lib/social-hub/slots/write';

import { scratchExplainersDb } from './explainers-pglite';
import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const poolHolder = globalThis as { __outreachHubPool?: unknown };
const poolBefore = poolHolder.__outreachHubPool;
afterEach(() => {
  if (poolBefore === undefined) delete poolHolder.__outreachHubPool;
  else poolHolder.__outreachHubPool = poolBefore;
});

const WED = '2026-10-21';
const LATE_TUESDAY = new Date('2026-10-21T02:00:00Z'); // Tue Oct 20, 10:00 PM New York
const NOON = new Date('2026-10-21T16:00:00Z'); // Wed 12:00 PM New York (EDT)
const first = () => 0;
const last = (n: number) => n - 1;
const opts = { by: 't', now: LATE_TUESDAY };

type V = 'reels' | 'explainers' | 'carousels' | 'last_few_days';
const remove = (vertical: V, startMinute: number): SlotChange => ({ scope: 'date', op: 'put', nyDate: WED, vertical, startMinute, series: null, action: 'remove' });
const add = (vertical: V, startMinute: number): SlotChange => ({ scope: 'date', op: 'put', nyDate: WED, vertical, startMinute, series: null, action: 'add' });

/** A booking at a slot's free minute lands in [slot, slot + 15] with slot = t0720. */
function assertAtNoon(row: { slot: string; publish_at: string | Date } | undefined): void {
  assert.equal(row?.slot, 't0720');
  const at = new Date(row!.publish_at).getTime();
  assert.ok(at >= NOON.getTime() && at <= NOON.getTime() + 15 * 60_000, `publish_at ${new Date(at).toISOString()} in [12:00, 12:15]`);
}

const rowsOf = async (q: (t: string, p?: unknown[]) => Promise<{ rows: any[] }>, vertical: string) =>
  (await q(`SELECT ny_date::text AS d, slot, publish_at, feed_mode FROM social_hub.schedule WHERE vertical = $1 ORDER BY publish_at`, [vertical])).rows;

// ---- Text on Screen ----

const IDEAS = ['74000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000002'];

async function reelsDb() {
  const { pg, query } = await openHubTestDb();
  poolHolder.__outreachHubPool = { query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]) };
  for (const id of IDEAS) await pg.query(`INSERT INTO reels.post_ideas (id) VALUES ($1)`, [id]);
  return { q: query as never as (t: string, p?: unknown[]) => Promise<{ rows: any[] }> };
}

test('reels template: a noon slot books in [12:00, 12:15] as t0720', async () => {
  const { q } = await reelsDb();
  await setSlotSource(q as never, 'template', 't');
  assert.equal((await applySlotChanges(q as never, [remove('reels', 525), remove('reels', 675), add('reels', 720)], opts)).ok, true);
  const out = await schedulePostIdea(IDEAS[0]!, 'auto', null, LATE_TUESDAY, WED);
  assert.ok(out.scheduled, out.note);
  const [row] = await rowsOf(q, 'reels');
  assertAtNoon(row);
  assert.equal(row.feed_mode, 'trial');
  assert.match(out.note, /\(12:00 PM slot\)/);
});

test('reels template: a pre-cutover window booking blocks the free-time slot it became', async () => {
  const { q } = await reelsDb();
  await setSlotSource(q as never, 'template', 't');
  // A legacy 'morning' booking on Wednesday is the 8:45 AM slot.
  await q(`INSERT INTO social_hub.schedule (vertical, idea_ref, ny_date, slot, publish_at, status, source) VALUES ('reels', $1, $2, 'morning', '2026-10-21T12:50:00Z', 'scheduled', 'auto')`, [IDEAS[1], WED]);
  const out = await schedulePostIdea(IDEAS[0]!, 'auto', null, LATE_TUESDAY, WED);
  assert.ok(out.scheduled, out.note);
  const slots = (await rowsOf(q, 'reels')).map((r) => r.slot).sort();
  assert.deepEqual(slots, ['morning', 't0675']);
});

test('reels template: 6 slots under a cap of 5 make 5 and never book the 6th', async () => {
  const { q } = await reelsDb();
  await setSlotSource(q as never, 'template', 't');
  // 8:45, 11:15, 6:00 seeded; add 1:00, 3:00 and 8:00 PM.
  assert.equal((await applySlotChanges(q as never, [add('reels', 780), add('reels', 900), add('reels', 1200)], opts)).ok, true);
  assert.equal(await reelsPerDay(new Date('2026-10-21T12:00:00Z')), 5);
  await writeCaps(q as never, { reels: 2 });
  assert.equal(await reelsPerDay(new Date('2026-10-21T12:00:00Z')), 2, 'the cap setting is read');
  for (const id of IDEAS) assert.ok((await schedulePostIdea(id, 'auto', null, LATE_TUESDAY, WED)).scheduled);
  assert.deepEqual((await rowsOf(q, 'reels')).map((r) => r.slot), ['t0525', 't0675']);
  await q(`INSERT INTO reels.post_ideas (id) VALUES ('74000000-0000-4000-8000-000000000003')`);
  const third = await schedulePostIdea('74000000-0000-4000-8000-000000000003', 'auto', null, LATE_TUESDAY, WED);
  assert.equal(third.scheduled, false, 'the 780 slot is over the cap of 2');
});

// ---- Explainers ----

async function explainersDb(n: number): Promise<{ db: Queryable; q: never; jobs: string[] }> {
  const { db } = await scratchExplainersDb();
  const jobs: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const { rows: t } = await db.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status) VALUES ($1, 'manual', 'rendered') RETURNING id`, [`Topic ${i}`]);
    const { rows: j } = await db.query<{ id: string }>(
      `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at)
       VALUES ($1, 'ok', 'click', 'development', 5, 'm', 'm', now()) RETURNING id`,
      [t[0]!.id],
    );
    await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', 'v.mp4', 5000000, 'bucket')`, [j[0]!.id]);
    jobs.push(j[0]!.id);
  }
  return { db, q: ((text: string, params?: unknown[]) => db.query(text, params)) as never, jobs };
}

test('explainers template: a noon slot books in [12:00, 12:15] as t0720, Main', async () => {
  const { db, q, jobs } = await explainersDb(1);
  await setSlotSource(q, 'template', 't');
  assert.equal((await applySlotChanges(q, [remove('explainers', 780), remove('explainers', 930), add('explainers', 720)], opts)).ok, true);
  const out = await scheduleJob(db, jobs[0]!, 'auto', LATE_TUESDAY, WED, last);
  assert.ok(out.scheduled);
  const [row] = await rowsOf(q, 'explainers');
  assertAtNoon(row);
  assert.equal(row.feed_mode, 'main');
});

test('explainers template: 4 slots on Wednesday make 3 (the cap); the 4th is never booked (Review Focus 4)', async () => {
  const { db, q, jobs } = await explainersDb(4);
  await setSlotSource(q, 'template', 't');
  // Seeded 1:00 and 3:30 PM; add 11:00 AM and 7:00 PM. By time: 11:00, 1:00, 3:30 are made; 7:00 PM is over.
  assert.equal((await applySlotChanges(q, [add('explainers', 660), add('explainers', 1140)], opts)).ok, true);
  assert.equal(await explainersQuota(db as never, WED), 3);
  for (const job of jobs.slice(0, 3)) assert.ok((await scheduleJob(db, job, 'auto', LATE_TUESDAY, WED, first)).scheduled);
  const fourth = await scheduleJob(db, jobs[3]!, 'auto', LATE_TUESDAY, WED, first);
  assert.equal(fourth.scheduled, false);
  assert.deepEqual((await rowsOf(q, 'explainers')).map((r) => [r.d, r.slot]), [[WED, 't0660'], [WED, 't0780'], [WED, 't0930']]);
  // Without a day limit the 4th goes to Thursday, not to Wednesday's 7:00 PM slot.
  const later = await scheduleJob(db, jobs[3]!, 'auto', LATE_TUESDAY, undefined, first);
  assert.ok(later.scheduled);
  assert.deepEqual((await rowsOf(q, 'explainers')).at(-1)!.d, '2026-10-22');
});

test('explainers template: a day already holding cap posts books nothing more there', async () => {
  const { db, q, jobs } = await explainersDb(1);
  await setSlotSource(q, 'template', 't');
  await writeCaps(q, { explainers: 1 });
  // A post placed on Wednesday outside a slot (a person's Place) uses the day's one.
  const item = (await db.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('explainers', 'reel', 'placed') RETURNING id`)).rows[0]!.id;
  await db.query(`INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'explainers', $2, 't1200', '2026-10-22T00:05:00Z', 'scheduled', 'user')`, [item, WED]);
  assert.equal((await scheduleJob(db, jobs[0]!, 'auto', LATE_TUESDAY, WED, first)).scheduled, false);
});

// ---- Carousels ----

async function carouselDb(n: number): Promise<{ q: never; posts: string[] }> {
  const { query } = await openHubTestDb();
  const posts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO social.posts (slug, title, status, render, origin, slide_objects)
       VALUES ($1, 't', 'review', '{"caption":"A caption.","slides":[]}'::jsonb, 'pipeline', '["posts/c/a.jpg"]'::jsonb) RETURNING id`,
      [`c-${i}`],
    );
    posts.push(rows[0]!.id);
  }
  return { q: query as never, posts };
}

test('carousels template: a noon slot books in [12:00, 12:15] as t0720', async () => {
  const { q, posts } = await carouselDb(1);
  await setSlotSource(q, 'template', 't');
  assert.equal((await applySlotChanges(q, [remove('carousels', 540), remove('carousels', 870), add('carousels', 720)], opts)).ok, true);
  const out = await schedulePost(q, posts[0]!, 'auto', LATE_TUESDAY, WED, last);
  assert.ok(out.scheduled);
  const [row] = await rowsOf(q as never, 'carousels');
  assertAtNoon(row);
  assert.equal(row.feed_mode, null, 'no feed mode for a carousel');
});

test('carousels template: 4 slots under a cap of 3 fill 3; the 4th is never booked', async () => {
  const { q, posts } = await carouselDb(4);
  await setSlotSource(q, 'template', 't');
  assert.equal((await applySlotChanges(q, [add('carousels', 720), add('carousels', 1080)], opts)).ok, true);
  assert.equal((await carouselFill(q, new Date('2026-10-21T11:00:00Z'))).quota, 3);
  for (const p of posts.slice(0, 3)) assert.ok((await schedulePost(q, p, 'auto', LATE_TUESDAY, WED, first)).scheduled);
  assert.equal((await schedulePost(q, posts[3]!, 'auto', LATE_TUESDAY, WED, first)).scheduled, false);
  assert.deepEqual((await rowsOf(q as never, 'carousels')).map((r) => r.slot), ['t0540', 't0720', 't0870']);
});

test('carousels template: a Last Few Days day is still blocked', async () => {
  const { q, posts } = await carouselDb(1);
  await setSlotSource(q, 'template', 't');
  // Tuesday Oct 27 is seeded as an LFD day: no carousel slot, nothing booked there.
  const tue = await schedulePost(q, posts[0]!, 'auto', new Date('2026-10-27T04:00:00Z'), '2026-10-27', first);
  assert.equal(tue.scheduled, false);
});

// ---- Last Few Days ----

test('last few days template: a noon slot books in [12:00, 12:15] as t0720', async () => {
  const { query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  assert.equal((await applySlotChanges(q, [remove('carousels', 540), remove('carousels', 870), add('last_few_days', 720)], opts)).ok, true);
  const post = await seedLfdPost(query, { nyDate: WED });
  const out = await scheduleLfdPost(q, post, 'auto', LATE_TUESDAY, WED, last);
  assert.ok(out.scheduled);
  const [row] = await rowsOf(q, 'last_few_days');
  assertAtNoon(row);
  assert.equal(row.feed_mode, null);
});
