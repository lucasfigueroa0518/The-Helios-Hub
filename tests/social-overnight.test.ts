/**
 * Carousel overnight (docs/social-overnight.md): run queue, posting window,
 * publish, insights. Offline: the real db/social_schema.sql on in-memory
 * PGlite, a stubbed Meta client, no Storage, no Claude.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { calendarDateKey } from '@/lib/instagram/clock';
import { CAROUSEL_SLOT } from '@/lib/social/overnight/config';
import { pollCarouselInsights, type CarouselInsightsClient } from '@/lib/social/overnight/insights';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import { carouselCaption, claimAndPublish, queuePublish } from '@/lib/social/overnight/publish';
import { claimRun, failRun, requestRun } from '@/lib/social/overnight/runs';
import { approveSchedule, releaseDueSchedules, scheduleRunPost, scheduleRunPosts } from '@/lib/social/overnight/schedule';
import { chooseCarouselSlot, chooseCarouselSlots, openMinuteRange } from '@/lib/social/overnight/slots';
import type { Query } from '@/lib/social/store/pg';

async function scratchDb(): Promise<{ query: Query; pg: PGlite }> {
  const sql = fs
    .readFileSync(path.join(process.cwd(), 'db', 'social_schema.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
  const pg = new PGlite();
  await pg.exec(sql);
  await pg.exec(sql); // idempotent
  const query: Query = async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
  return { query, pg };
}

const RENDER = { caption: 'A caption.', attributionBlock: 'Photo: Someone / CC BY 4.0', slides: [] };

async function insertPost(query: Query, opts: { runId?: string | null; slug: string; status?: string; origin?: string; slides?: number | null; caption?: string }) {
  const slides = opts.slides === null ? null : JSON.stringify(Array.from({ length: opts.slides ?? 3 }, (_, i) => `posts/${opts.slug}/slide-${i + 1}.jpg`));
  const { rows } = await query(
    `INSERT INTO social.posts (run_id, slug, title, status, render, origin, slide_objects)
     VALUES ($1, $2, 't', $3, $4::jsonb, $5, $6::jsonb) RETURNING id`,
    [opts.runId ?? null, opts.slug, opts.status ?? 'review', JSON.stringify({ ...RENDER, caption: opts.caption ?? RENDER.caption }), opts.origin ?? 'pipeline', slides],
  );
  return rows[0].id as string;
}

function stubMeta(overrides: Partial<CarouselMetaClient> = {}) {
  const calls: string[] = [];
  let n = 0;
  const meta: CarouselMetaClient = {
    async createImageItem(url) { calls.push(`item ${url}`); return `child-${++n}`; },
    async createCarousel(children, caption) { calls.push(`carousel ${children.join(',')} ${caption.length}`); return 'parent-1'; },
    async containerStatus() { calls.push('status'); return { statusCode: 'FINISHED', status: null }; },
    async publishContainer(id) { calls.push(`publish ${id}`); return 'media-1'; },
    async permalink() { return 'https://instagram.com/p/abc'; },
    async publishingLimit() { return { quotaUsage: 3, quotaTotal: 100 }; },
    ...overrides,
  };
  return { meta, calls };
}

const sign = async (objectPath: string) => `https://signed/${objectPath}`;

// ── Posting window ──────────────────────────────────────────────────────────

test('window: first window 9:00–10:00 AM New York, today when still open, tomorrow once taken, DST-safe', () => {
  const beforeDawn = new Date('2026-10-08T07:00:00Z'); // 3:00 AM EDT
  const choice = chooseCarouselSlot(beforeDawn, new Set(), () => 0)!;
  assert.equal(choice.nyDate, '2026-10-08');
  assert.equal(choice.publishAt.toISOString(), '2026-10-08T13:00:00.000Z'); // 9:00 AM EDT
  const taken = chooseCarouselSlot(beforeDawn, new Set(['2026-10-08']), () => 0)!;
  assert.equal(taken.nyDate, '2026-10-09');
  // After the November change the same 9:00 AM is 14:00 UTC.
  const winter = chooseCarouselSlot(new Date('2026-11-10T08:00:00Z'), new Set(), () => 0)!;
  assert.equal(winter.publishAt.toISOString(), '2026-11-10T14:00:00.000Z');
  // throughDate limits the search to today.
  assert.equal(chooseCarouselSlot(beforeDawn, new Set(['2026-10-08']), () => 0, '2026-10-08'), null);
});

test('window: a started window only offers minutes still ahead; an ended one is closed', () => {
  const midWindow = new Date('2026-10-08T13:30:00Z'); // 9:30 AM EDT
  const open = openMinuteRange('2026-10-08', midWindow)!;
  assert.equal(open.count, CAROUSEL_SLOT.endMinute - (9 * 60 + 30));
  assert.equal(openMinuteRange('2026-10-08', new Date('2026-10-08T14:05:00Z')), null);
});

test('two windows a day (9:00–10:00, 2:30–3:30), posts_per_day caps them, other feed posts keep 30 minutes away', () => {
  const beforeDawn = new Date('2026-10-08T07:00:00Z');
  const morning = chooseCarouselSlots(beforeDawn, new Set(), [], 2, () => 0)!;
  assert.equal(morning.slot, 'morning');
  const afternoon = chooseCarouselSlots(beforeDawn, new Set(['2026-10-08|morning']), [], 2, () => 0)!;
  assert.deepEqual([afternoon.nyDate, afternoon.slot, afternoon.publishAt.toISOString()], ['2026-10-08', 'afternoon', '2026-10-08T18:30:00.000Z']);
  const oneADay = chooseCarouselSlots(beforeDawn, new Set(['2026-10-08|morning']), [], 1, () => 0)!;
  assert.deepEqual([oneADay.nyDate, oneADay.slot], ['2026-10-09', 'morning']);
  // A Trial Reel at 9:10 AM: the first carousel minute is 9:40.
  const spaced = chooseCarouselSlots(beforeDawn, new Set(), [new Date('2026-10-08T13:10:00Z')], 2, () => 0)!;
  assert.equal(spaced.publishAt.toISOString(), '2026-10-08T13:40:00.000Z');
  // Feed posts filling the whole morning window move the carousel to the afternoon.
  const busy = [new Date('2026-10-08T13:00:00Z'), new Date('2026-10-08T13:30:00Z'), new Date('2026-10-08T14:00:00Z')];
  assert.equal(chooseCarouselSlots(beforeDawn, new Set(), busy, 2, () => 0)!.slot, 'afternoon');
});

// ── Run queue ───────────────────────────────────────────────────────────────

test('runs: one queued and one running at most; a dead script fails its run', async () => {
  const { query } = await scratchDb();
  const id = await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true });
  assert.ok(id);
  assert.equal(await requestRun(query, 'manual', { capUsd: 2, hookPass: true }), null);
  const claimed = await claimRun(query);
  assert.equal(claimed?.id, id);
  assert.equal(claimed?.capUsd, 2);
  await requestRun(query, 'manual', { capUsd: 2, hookPass: true });
  assert.equal(await claimRun(query), null, 'nothing is claimed while a run is running');
  await failRun(query, id!, 'exited 1');
  const { rows } = await query(`SELECT status, error FROM social.runs WHERE id = $1`, [id]);
  assert.equal(rows[0].status, 'failed');
  assert.match(rows[0].error, /exited 1/);
});

test('runs: a run running past the stale limit is released', async () => {
  const { query } = await scratchDb();
  const id = await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true });
  await claimRun(query, new Date('2026-10-08T07:00:00Z'));
  await requestRun(query, 'manual', { capUsd: 2, hookPass: true });
  const next = await claimRun(query, new Date('2026-10-08T09:00:00Z'));
  assert.ok(next && next.id !== id);
  assert.equal((await query(`SELECT status FROM social.runs WHERE id = $1`, [id])).rows[0].status, 'failed');
});

// ── Schedule + publish ──────────────────────────────────────────────────────

test('publish queue: only pipeline posts in review, with 2–10 stored slides and a caption that fits', async () => {
  const { query } = await scratchDb();
  assert.equal((await queuePublish(query, await insertPost(query, { slug: 'dev', origin: 'dev' }), 'auto')).queued, false);
  assert.equal((await queuePublish(query, await insertPost(query, { slug: 'preview', status: 'preview' }), 'auto')).queued, false);
  assert.equal((await queuePublish(query, await insertPost(query, { slug: 'noslides', slides: null }), 'auto')).queued, false);
  assert.equal((await queuePublish(query, await insertPost(query, { slug: 'long', caption: 'x'.repeat(2200) }), 'auto')).queued, false);
  const ok = await insertPost(query, { slug: 'ok' });
  const first = await queuePublish(query, ok, 'auto');
  assert.equal(first.queued, true);
  assert.equal((await queuePublish(query, ok, 'auto')).queued, false, 'one in flight per post');
  assert.equal(carouselCaption(RENDER), 'A caption.\n\nPhoto: Someone / CC BY 4.0');
});

test('end to end: run post scheduled into today, released when due, published, marked on post and schedule', async () => {
  const { query } = await scratchDb();
  const runId = await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true });
  const best = await insertPost(query, { runId, slug: 'post-x-1' });
  await insertPost(query, { runId, slug: 'post-x-2' });
  const now = new Date('2026-10-08T07:30:00Z');
  const scheduled = await scheduleRunPosts(query, runId!, now, () => 0);
  assert.deepEqual(scheduled.map((s) => s.scheduled), [true, true], 'the run\'s top two posts (SH-48)');
  const sched = (await query(`SELECT id, post_id, ny_date::text AS d, slot, publish_at FROM social.posting_schedule ORDER BY publish_at`)).rows;
  assert.equal(sched.length, 2);
  assert.equal(sched[0].post_id, best, 'the best-ranked story (lowest slug number) takes the first window');
  assert.deepEqual(sched.map((r: { slot: string; d: string }) => [r.d, r.slot]), [[calendarDateKey(now), 'morning'], [calendarDateKey(now), 'afternoon']]);

  // A person approves the first; make it due, then release and publish.
  assert.equal(await approveSchedule(query, sched[0].id), true);
  await query(`UPDATE social.posting_schedule SET publish_at = now() - interval '1 minute' WHERE id = $1`, [sched[0].id]);
  assert.equal(await releaseDueSchedules(query), 1);
  const { meta, calls } = stubMeta();
  const out = await claimAndPublish({ query, meta, signImage: sign, sleep: async () => undefined });
  assert.equal(out?.status, 'published');
  assert.deepEqual(calls.slice(0, 3), ['item https://signed/posts/post-x-1/slide-1.jpg', 'item https://signed/posts/post-x-1/slide-2.jpg', 'item https://signed/posts/post-x-1/slide-3.jpg']);
  assert.match(calls[3]!, /^carousel child-1,child-2,child-3 /);
  const attempt = (await query(`SELECT status, media_id, permalink, child_container_ids FROM social.publish_attempts`)).rows[0];
  assert.equal(attempt.status, 'published');
  assert.equal(attempt.media_id, 'media-1');
  assert.deepEqual(attempt.child_container_ids, ['child-1', 'child-2', 'child-3']);
  assert.equal((await query(`SELECT status FROM social.posting_schedule WHERE id = $1`, [sched[0].id])).rows[0].status, 'published');
  const post = (await query(`SELECT status, published_at FROM social.posts WHERE id = $1`, [best])).rows[0];
  assert.equal(post.status, 'published');
  assert.ok(post.published_at);
  // A second release finds nothing; the post cannot go twice.
  assert.equal(await releaseDueSchedules(query), 0);
  assert.equal((await queuePublish(query, best, 'force')).queued, false);
});

test('approval: a due slot nobody approved is cancelled, never posted; with require_approval off it goes', async () => {
  const { query } = await scratchDb();
  assert.equal((await query(`SELECT value FROM social.settings WHERE key = 'require_approval'`)).rows[0].value, true);
  const runId = await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true });
  await insertPost(query, { runId, slug: 'post-y-1' });
  await scheduleRunPost(query, runId!, new Date('2026-10-08T07:30:00Z'), () => 0);
  await query(`UPDATE social.posting_schedule SET publish_at = now() - interval '1 minute'`);
  assert.equal(await releaseDueSchedules(query), 0);
  const row = (await query(`SELECT status, error FROM social.posting_schedule`)).rows[0];
  assert.equal(row.status, 'cancelled');
  assert.match(row.error, /approved/);
  assert.equal((await query(`SELECT count(*)::int AS n FROM social.publish_attempts`)).rows[0].n, 0);

  await query(`UPDATE social.runs SET status = 'ok' WHERE status = 'requested'`);
  const other = await requestRun(query, 'manual', { capUsd: 2, hookPass: true });
  await insertPost(query, { runId: other, slug: 'post-z-1' });
  await scheduleRunPost(query, other!, new Date('2026-10-09T07:30:00Z'), () => 0);
  await query(`UPDATE social.posting_schedule SET publish_at = now() - interval '1 minute' WHERE status = 'scheduled'`);
  assert.equal(await releaseDueSchedules(query, { requireApproval: false }), 1);
});

test('publish: Instagram ERROR fails the attempt and the slot; a near-full quota never creates containers', async () => {
  const { query } = await scratchDb();
  const a = await insertPost(query, { slug: 'a' });
  await queuePublish(query, a, 'approve');
  const failing = stubMeta({ async containerStatus() { return { statusCode: 'ERROR', status: 'bad image' }; } });
  const out = await claimAndPublish({ query, meta: failing.meta, signImage: sign, sleep: async () => undefined });
  assert.equal(out?.status, 'failed');
  assert.match((await query(`SELECT error FROM social.publish_attempts`)).rows[0].error, /ERROR.*bad image/);

  const b = await insertPost(query, { slug: 'b' });
  await queuePublish(query, b, 'approve');
  const full = stubMeta({ async publishingLimit() { return { quotaUsage: 98, quotaTotal: 100 }; } });
  const blocked = await claimAndPublish({ query, meta: full.meta, signImage: sign });
  assert.equal(blocked?.status, 'failed');
  assert.equal(full.calls.filter((c) => c.startsWith('item')).length, 0);
});

// ── Insights ────────────────────────────────────────────────────────────────

test('insights: a fresh carousel is read and stored; blanks never overwrite a stored number', async () => {
  const { query } = await scratchDb();
  const postId = await insertPost(query, { slug: 'p' });
  const finished = new Date('2026-10-08T12:00:00Z');
  await query(
    `INSERT INTO social.publish_attempts (post_id, trigger, status, caption, image_objects, media_id, finished_at)
     VALUES ($1, 'auto', 'published', 'c', '[]'::jsonb, 'm1', $2)`,
    [postId, finished.toISOString()],
  );
  let reach: number | null = 120;
  const client: CarouselInsightsClient = {
    async insights() { return { views: 300, reach, likes: 10, comments: 1, saved: 4, shares: 2, total_interactions: 17, follows: 3, profile_visits: 9, raw: {} }; },
  };
  const first = await pollCarouselInsights(query, client, new Date('2026-10-08T13:00:00Z'));
  assert.deepEqual([first.considered, first.written], [1, 1]);
  reach = null;
  await pollCarouselInsights(query, client, new Date('2026-10-08T14:00:00Z'));
  const row = (await query(`SELECT views, reach, saved, follows, profile_visits FROM social.media_insights WHERE media_id = 'm1'`)).rows[0];
  assert.deepEqual([row.views, row.reach, row.saved, row.follows, row.profile_visits], [300, 120, 4, 3, 9]);
  // Within the 30-minute cooldown nothing is due.
  assert.equal((await pollCarouselInsights(query, client, new Date('2026-10-08T14:10:00Z'))).considered, 0);
});
