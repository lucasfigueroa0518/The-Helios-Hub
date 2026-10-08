/**
 * Carousels on the lifecycle spine (D36) and content that survives with its
 * idea (P2-M4: SH-50 – SH-54, SH-60). Offline: the real social and social_hub
 * schema files on PGlite, stub pipeline stages, no Claude, no Meta.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { rejectItem } from '@/lib/social-hub/spine';
import { carouselItemId } from '@/lib/social/overnight/items';
import { approvePost, NOT_APPROVED_NOTE, REJECTED_NOTE, releaseDueSchedules, schedulePost, scheduleRunPosts } from '@/lib/social/overnight/schedule';
import { carryAttempt, queuePublish } from '@/lib/social/overnight/publish';
import { requestRun } from '@/lib/social/overnight/runs';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages } from '@/lib/social/pipeline/stubs';
import type { StageName } from '@/lib/social/pipeline/types';
import { recordShipList, storedPostFor, type Query } from '@/lib/social/store/pg';

const schemaSql = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function scratchDb(): Promise<{ query: Query; pg: PGlite }> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  await pg.exec(schemaSql('social_hub_schema.sql'));
  const query: Query = async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
  return { query, pg };
}

const RENDER = { caption: 'A caption.', attributionBlock: 'Photo: Someone', slides: [] };

async function insertPost(
  query: Query,
  opts: { slug: string; storyId?: string; runId?: string | null; status?: string; origin?: string; slides?: boolean; createdAt?: string },
): Promise<string> {
  const slides = opts.slides === false ? null : JSON.stringify(['a.jpg', 'b.jpg', 'c.jpg'].map((f) => `posts/${opts.slug}/${f}`));
  const { rows } = await query(
    `INSERT INTO social.posts (run_id, slug, story_id, title, status, render, origin, slide_objects, created_at)
     VALUES ($1, $2, $3, 't', $4, $5::jsonb, $6, $7::jsonb, coalesce($8::timestamptz, now())) RETURNING id`,
    [opts.runId ?? null, opts.slug, opts.storyId ?? null, opts.status ?? 'review', JSON.stringify(RENDER), opts.origin ?? 'pipeline', slides, opts.createdAt ?? null],
  );
  return rows[0].id as string;
}

const makeDue = (query: Query) => query(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute' WHERE status = 'scheduled'`);

// ── The orchestrator (SH-60) ────────────────────────────────────────────────

test('a story with a stored finished post keeps its rank, counts toward the day, and runs no stage', async () => {
  const calls: Array<{ stage: StageName; storyId: string }> = [];
  const meter = createCostMeter({ capUsd: 5 });
  const result = await runDay({
    articles: STUB_ARTICLES,
    stages: createStubStages({ calls }),
    meter,
    log: createInMemorySetAsideLog(),
    now: new Date('2026-10-04T15:00:00Z'),
    targetPosts: 2,
    stored: async (storyId) => (storyId === 'story-a' ? 'stored-post-a' : null),
  });
  assert.deepEqual(result.shipped, [
    { storyId: 'story-a', reusedPostId: 'stored-post-a' },
    { storyId: 'story-b', reusedPostId: null },
  ]);
  assert.equal(result.posts.length, 1, 'only story-b was made today');
  assert.equal(calls.some((c) => c.storyId === 'story-a'), false, 'no stage ran (and nothing was spent) for the reused story');
  assert.equal(result.stopReason, 'target-reached');
});

test('without a stored lookup every story runs, as before', async () => {
  const result = await runDay({
    articles: STUB_ARTICLES,
    stages: createStubStages(),
    meter: createCostMeter({ capUsd: 5 }),
    log: createInMemorySetAsideLog(),
    now: new Date('2026-10-04T15:00:00Z'),
    targetPosts: 2,
  });
  assert.deepEqual(result.shipped.map((e) => e.reusedPostId), [null, null]);
  assert.equal(result.posts.length, 2);
});

// ── Which stored post counts (SH-54: the newest version is the current one) ─

test('stored post: the newest pipeline post in review with slides; a newer rejected, published or slide-less one blocks reuse', async () => {
  const { query } = await scratchDb();
  assert.equal(await storedPostFor(query, 'story-1'), null, 'nothing generated yet');
  const older = await insertPost(query, { slug: 'old', storyId: 'story-1', createdAt: '2026-10-05T07:00:00Z' });
  await insertPost(query, { slug: 'dev', storyId: 'story-1', origin: 'dev', createdAt: '2026-10-07T07:00:00Z' });
  assert.equal(await storedPostFor(query, 'story-1'), older, 'dev renders never count');

  const newer = await insertPost(query, { slug: 'new', storyId: 'story-1', createdAt: '2026-10-06T07:00:00Z' });
  assert.equal(await storedPostFor(query, 'story-1'), newer);

  await rejectItem(query, (await carouselItemId(query, newer))!);
  assert.equal(await storedPostFor(query, 'story-1'), null, 'the current version was rejected: the story runs again, nothing older is used');

  await insertPost(query, { slug: 'noslides', storyId: 'story-2', slides: false });
  assert.equal(await storedPostFor(query, 'story-2'), null, 'slides not stored yet');
  await insertPost(query, { slug: 'posted', storyId: 'story-3', status: 'published' });
  assert.equal(await storedPostFor(query, 'story-3'), null, 'already posted');
});

// ── The worker schedules the ship list (SH-60) ──────────────────────────────

test('the run\'s ship list puts a reused stored post in its rank, ahead of the run\'s own posts', async () => {
  const { query } = await scratchDb();
  const yesterday = await insertPost(query, { slug: 'post-old-1', storyId: 'story-1', createdAt: '2026-10-07T07:00:00Z' });
  const runId = (await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true }))!;
  const fresh = await insertPost(query, { slug: 'post-new-1', storyId: 'story-2', runId });
  await recordShipList(query, runId, [yesterday, fresh]);
  const out = await scheduleRunPosts(query, runId, new Date('2026-10-08T07:30:00Z'), () => 0);
  assert.deepEqual(out.map((o) => o.scheduled), [true, true]);
  const rows = (await query(
    `SELECT ci.native_ref AS post_id, s.slot FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id ORDER BY s.publish_at`,
  )).rows;
  assert.deepEqual(rows.map((r) => [r.post_id, r.slot]), [[yesterday, 'morning'], [fresh, 'afternoon']]);
  const idea = (await query(`SELECT idea_ref FROM social_hub.content_items WHERE native_ref = $1`, [yesterday])).rows[0];
  assert.equal(idea.idea_ref, 'story-1', 'the item carries its post idea');
});

// ── Approval belongs to the content (D36) and Content ready (P2-M4) ─────────

test('a carousel in review is approved into the earliest open window and posts when due', async () => {
  const { query } = await scratchDb();
  const postId = await insertPost(query, { slug: 'ready', storyId: 'story-1' });
  const placed = await approvePost(query, postId, new Date('2026-10-08T07:30:00Z'));
  assert.equal(placed.scheduled, true);
  const approval = (await query(`SELECT decision, via FROM social_hub.approvals`)).rows[0];
  assert.deepEqual([approval.decision, approval.via], ['approved', 'user']);
  await makeDue(query);
  assert.equal(await releaseDueSchedules(query, { requireApproval: true }), 1, 'approved content posts');
});

test('an unapproved slot is cancelled; the post returns to Content ready and approving it gives it a new slot', async () => {
  const { query } = await scratchDb();
  const postId = await insertPost(query, { slug: 'missed', storyId: 'story-1' });
  await schedulePost(query, postId, 'auto', new Date('2026-10-08T07:30:00Z'), undefined, () => 0);
  await makeDue(query);
  assert.equal(await releaseDueSchedules(query, { requireApproval: true }), 0);
  const cancelled = (await query(`SELECT status, error FROM social_hub.schedule`)).rows[0];
  assert.deepEqual([cancelled.status, cancelled.error], ['cancelled', NOT_APPROVED_NOTE]);
  // Still in review, no live slot: Content ready. A person approves it later.
  const again = await approvePost(query, postId, new Date('2026-10-08T07:30:00Z'));
  assert.equal(again.scheduled, true);
  assert.equal((await query(`SELECT count(*)::int AS n FROM social_hub.schedule WHERE status = 'scheduled'`)).rows[0].n, 1);
});

test('rejected content never posts, even with require_approval off', async () => {
  const { query } = await scratchDb();
  const postId = await insertPost(query, { slug: 'no', storyId: 'story-1' });
  await schedulePost(query, postId, 'auto', new Date('2026-10-08T07:30:00Z'), undefined, () => 0);
  await rejectItem(query, (await carouselItemId(query, postId))!);
  await makeDue(query);
  assert.equal(await releaseDueSchedules(query, { requireApproval: false }), 0);
  const row = (await query(`SELECT status, error FROM social_hub.schedule`)).rows[0];
  assert.deepEqual([row.status, row.error], ['cancelled', REJECTED_NOTE]);
  assert.equal((await query(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0].n, 0);
});

test('one item per content: scheduling and approving the same post twice reuses its item and keeps the first approval time', async () => {
  const { query } = await scratchDb();
  const postId = await insertPost(query, { slug: 'twice', storyId: 'story-1' });
  const first = await approvePost(query, postId, new Date('2026-10-08T07:30:00Z'));
  const firstAt = (await query(`SELECT decided_at FROM social_hub.approvals`)).rows[0].decided_at;
  const second = await approvePost(query, postId, new Date('2026-10-08T07:30:00Z'));
  assert.ok(first.scheduled && second.scheduled && first.id === second.id, 'a post already on the clock keeps its slot');
  assert.equal((await query(`SELECT count(*)::int AS n FROM social_hub.content_items`)).rows[0].n, 1);
  assert.deepEqual((await query(`SELECT decided_at FROM social_hub.approvals`)).rows[0].decided_at, firstAt);
});

// ── Review fixes (D41) ───────────────────────────────────────────────────────

test('a post whose publish may have reached Instagram (a worker died mid-publish) is never reused', async () => {
  const { query } = await scratchDb();
  const postId = await insertPost(query, { slug: 'maybe-live', storyId: 'story-9' });
  const itemId = (await carouselItemId(query, postId))!;
  await query(
    `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, error)
     VALUES ($1, 'carousels', 'auto', 'failed', 'c', 'The worker stopped while this carousel was publishing. Check Instagram before trying again.')`,
    [itemId],
  );
  assert.equal(await storedPostFor(query, 'story-9'), null);
  // A clean failure before anything went out (e.g. the quota gate) still allows reuse.
  const clean = await insertPost(query, { slug: 'clean-fail', storyId: 'story-10' });
  await query(
    `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, error)
     VALUES ($1, 'carousels', 'auto', 'failed', 'c', 'The Instagram account has 3 of 100 posts left in its 24-hour quota.')`,
    [(await carouselItemId(query, clean))!],
  );
  assert.equal(await storedPostFor(query, 'story-10'), clean);
});

test('the ship list fills today\'s windows even when a reused post already waits in a later slot', async () => {
  const { query } = await scratchDb();
  const waiting = await insertPost(query, { slug: 'post-w', storyId: 'story-1', createdAt: '2026-10-06T07:00:00Z' });
  await approvePost(query, waiting, new Date('2026-10-09T07:30:00Z'));
  const runId = (await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true }))!;
  const a = await insertPost(query, { slug: 'post-a', storyId: 'story-2', runId });
  const b = await insertPost(query, { slug: 'post-b', storyId: 'story-3', runId });
  await recordShipList(query, runId, [waiting, a, b]);
  const out = await scheduleRunPosts(query, runId, new Date('2026-10-08T07:30:00Z'), () => 0);
  assert.deepEqual(out.map((o) => o.scheduled), [true, true], 'both of today\'s windows filled by the run\'s own posts');
  const today = (await query(`SELECT count(*)::int AS n FROM social_hub.schedule WHERE ny_date = '2026-10-08'`)).rows[0].n;
  assert.equal(today, 2);
});

test('an uppercase id still finds the post\'s one item', async () => {
  const { query } = await scratchDb();
  const postId = await insertPost(query, { slug: 'case', storyId: 'story-1' });
  assert.equal(await carouselItemId(query, postId.toUpperCase()), await carouselItemId(query, postId));
  assert.equal((await query(`SELECT count(*)::int AS n FROM social_hub.content_items`)).rows[0].n, 1);
});

test('a carousel rejected after its attempt was queued is never posted', async () => {
  const { query } = await scratchDb();
  const postId = await insertPost(query, { slug: 'late-no', storyId: 'story-1' });
  const queued = await queuePublish(query, postId, 'approve');
  assert.equal(queued.queued, true);
  await rejectItem(query, (await carouselItemId(query, postId))!);
  const calls: string[] = [];
  const meta = {
    async createImageItem() { calls.push('item'); return 'c'; },
    async createCarousel() { calls.push('carousel'); return 'p'; },
    async containerStatus() { return { statusCode: 'FINISHED', status: null }; },
    async publishContainer() { calls.push('publish'); return 'm'; },
    async permalink() { return null; },
    async publishingLimit() { return { quotaUsage: 0, quotaTotal: 100 }; },
  };
  const id = (queued as { id: string }).id;
  await query(`UPDATE social_hub.publish_attempts SET status = 'creating', started_at = now() WHERE id = $1`, [id]);
  const out = await carryAttempt({ query, meta, signImage: async (p) => p, sleep: async () => undefined }, id);
  assert.equal(out.status, 'failed');
  assert.deepEqual(calls, [], 'no container was made');
});

test('Reject (D47): the carousel never posts or gets reused, and its waiting slot is cancelled with the reason', async () => {
  const { query } = await scratchDb();
  const { rejectPost } = await import('@/lib/social/overnight/schedule');
  const postId = await insertPost(query, { slug: 'nope', storyId: 'story-7' });
  await approvePost(query, postId, new Date('2026-10-08T07:30:00Z'));
  assert.equal(await rejectPost(query, postId, 'tommy'), true);
  const slot = (await query(`SELECT status, error FROM social_hub.schedule`)).rows[0];
  assert.deepEqual([slot.status, slot.error], ['cancelled', REJECTED_NOTE]);
  const decision = (await query(`SELECT decision, decided_by FROM social_hub.approvals`)).rows[0];
  assert.deepEqual([decision.decision, decision.decided_by], ['rejected', 'tommy']);
  assert.equal(await storedPostFor(query, 'story-7'), null, 'a rejected post is never reused');
});
