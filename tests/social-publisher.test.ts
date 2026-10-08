/**
 * The account gate and the single publisher (unification Moves 5–6, D40).
 * Offline: every schema file on PGlite, stub Meta clients, no Storage.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkAccountQuota, DEFAULT_QUOTA_RESERVE } from '@/lib/instagram/account-gate';
import { carouselsDriver } from '@/lib/publishing/drivers/carousels';
import type { PublishDriver } from '@/lib/publishing/drivers/types';
import { claimNextAttempt, publisherMode, publisherOwnsPublishing, publisherTick } from '@/lib/publishing/publisher';
import type { SpineQuery } from '@/lib/social-hub/spine';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import { queuePublish } from '@/lib/social/overnight/publish';
import { schedulePost } from '@/lib/social/overnight/schedule';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const limit = (quotaUsage: number, quotaTotal: number | null = 100) => ({ publishingLimit: async () => ({ quotaUsage, quotaTotal }) });

// ── The account gate ─────────────────────────────────────────────────────────

test('gate: one post is refused below the reserve (the rule every publisher had); a Story set needs room for every frame', async () => {
  assert.equal(DEFAULT_QUOTA_RESERVE, 5);
  assert.deepEqual(await checkAccountQuota({ ops: limit(95), reserve: 5 }), { ok: true, left: 5 }, '5 left: still posts, as before');
  const refused = await checkAccountQuota({ ops: limit(96), reserve: 5 });
  assert.equal(refused.ok, false);
  assert.match((refused as { message: string }).message, /4 of 100 posts left in its 24-hour quota/, 'the hub reads this wording');
  assert.equal((await checkAccountQuota({ ops: limit(90), need: 6, reserve: 5 })).ok, true, '10 left: room for 6 frames above the reserve');
  assert.equal((await checkAccountQuota({ ops: limit(91), need: 6, reserve: 5 })).ok, false);
  assert.deepEqual(await checkAccountQuota({ ops: limit(500, null), reserve: 5 }), { ok: true, left: null }, 'no total reported: not blocked');
});

test('gate: the reserve is an account setting, and every reading is recorded for the hub', async () => {
  const { pg, query } = await openHubTestDb({ withHubSchema: true });
  const q = query as unknown as SpineQuery;
  assert.equal((await checkAccountQuota({ ops: limit(93), query: q })).ok, true, 'default reserve 5: 7 left posts');
  await pg.exec(`UPDATE social_hub.settings SET value = '8'::jsonb WHERE key = 'quota_reserve'`);
  assert.equal((await checkAccountQuota({ ops: limit(93), query: q })).ok, false, 'reserve raised to 8 without a code change');
  const rows = (await pg.query<{ quota_usage: number }>(`SELECT quota_usage FROM social_hub.publishing_quota`)).rows;
  assert.equal(rows.length, 2);
});

// ── The publisher ───────────────────────────────────────────────────────────

function stubDriver(vertical: PublishDriver['vertical'], opts: { live?: boolean; carried?: string[] } = {}): PublishDriver {
  return {
    vertical,
    live: async () => opts.live ?? true,
    requireApproval: async () => true,
    failStale: async () => undefined,
    releaseDue: async () => 0,
    carry: async (id) => {
      opts.carried?.push(`${vertical}:${id}`);
      return { id, status: 'published' };
    },
    pollInsights: async () => ({ considered: 0, written: 0, blocked: null, detail: null }),
  };
}

async function seedAttempt(pg: Awaited<ReturnType<typeof openHubTestDb>>['pg'], vertical: 'carousels' | 'explainers', ref: string, at: string, status = 'requested') {
  const { rows } = await pg.query<{ id: string }>(
    `WITH item AS (INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ($1, $2, $3) RETURNING id)
     INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, requested_at, caption)
     SELECT id, $1, 'auto', $4, $5::timestamptz, 'c' FROM item RETURNING id`,
    [vertical, vertical === 'carousels' ? 'feed' : 'reel', ref, status, at],
  );
  return rows[0]!.id;
}

test('publisher: off by default, so the type workers keep publishing exactly as before', async () => {
  const { pg, query } = await openHubTestDb({ withHubSchema: true });
  const q = query as unknown as SpineQuery;
  assert.equal(await publisherMode(q), 'off');
  assert.equal(await publisherOwnsPublishing(q), false);
  const carried: string[] = [];
  await seedAttempt(pg, 'carousels', 'p1', '2026-10-08T12:00:00Z');
  assert.deepEqual(await publisherTick(q, [stubDriver('carousels', { carried })]), { mode: 'off' });
  assert.deepEqual(carried, []);
});

test('publisher shadow: reports what it would do and changes nothing', async () => {
  const { pg, query } = await openHubTestDb({ withHubSchema: true });
  const q = query as unknown as SpineQuery;
  await pg.exec(`UPDATE social_hub.settings SET value = '"shadow"'::jsonb WHERE key = 'publisher_mode'`);
  const a = await seedAttempt(pg, 'explainers', 'j1', '2026-10-08T12:00:00Z');
  const carried: string[] = [];
  const result = await publisherTick(q, [stubDriver('carousels', { carried }), stubDriver('explainers', { carried })]);
  assert.equal(result.mode, 'shadow');
  assert.deepEqual((result as { plan: { next: unknown } }).plan.next, { attemptId: a, vertical: 'explainers' });
  assert.deepEqual(carried, [], 'nothing carried');
  assert.equal((await pg.query<{ status: string }>(`SELECT status FROM social_hub.publish_attempts`)).rows[0]!.status, 'requested', 'nothing claimed');
  assert.equal(await publisherOwnsPublishing(q), false, 'the type workers still post in shadow mode');
});

test('publisher live: one post at a time across every type, oldest first; a type switched off is never carried', async () => {
  const { pg, query } = await openHubTestDb({ withHubSchema: true });
  const q = query as unknown as SpineQuery;
  await pg.exec(`UPDATE social_hub.settings SET value = '"live"'::jsonb WHERE key = 'publisher_mode'`);
  assert.equal(await publisherOwnsPublishing(q), true);
  const explainer = await seedAttempt(pg, 'explainers', 'j1', '2026-10-08T12:00:00Z');
  const carousel = await seedAttempt(pg, 'carousels', 'p1', '2026-10-08T12:05:00Z');
  const carried: string[] = [];
  const drivers = [stubDriver('carousels', { carried }), stubDriver('explainers', { carried, live: false })];
  const first = await publisherTick(q, drivers);
  assert.deepEqual(first, { mode: 'live', released: 0, published: { id: carousel, vertical: 'carousels', status: 'published' } }, 'the explainer is older, but Explainers are not live');
  // A post already in flight on the account blocks every type's next claim.
  await pg.exec(`UPDATE social_hub.publish_attempts SET status = 'processing' WHERE id = '${carousel}'`);
  assert.equal(await claimNextAttempt(q, ['explainers', 'carousels']), null);
  await pg.exec(`UPDATE social_hub.publish_attempts SET status = 'published' WHERE id = '${carousel}'`);
  assert.deepEqual(await claimNextAttempt(q, ['explainers', 'carousels']), { id: explainer, vertical: 'explainers' });
  assert.deepEqual(carried, [`carousels:${carousel}`]);
});

test('publisher live end to end: an approved carousel slot is released, gated, and posted through the Carousels driver', async () => {
  const { pg, query } = await openHubTestDb({ withHubSchema: true });
  const q = query as never;
  await pg.exec(`
    UPDATE social_hub.settings SET value = '"live"'::jsonb WHERE key = 'publisher_mode';
    UPDATE social.settings SET value = 'true'::jsonb WHERE key = 'publishing_live';
    INSERT INTO social.posts (id, slug, story_id, title, status, render, origin, slide_objects)
    VALUES ('40000000-0000-4000-8000-000000000001', 'pub-1', 's1', 't', 'review', '{"caption": "Hello.", "slides": []}', 'pipeline', '["a.jpg","b.jpg"]');`);
  const placed = await schedulePost(q, '40000000-0000-4000-8000-000000000001', 'user', new Date('2026-10-08T11:00:00Z'), undefined, () => 0);
  assert.equal(placed.scheduled, true);
  await pg.exec(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  const calls: string[] = [];
  const meta: CarouselMetaClient = {
    async createImageItem(url) { calls.push(`item ${url}`); return `child-${calls.length}`; },
    async createCarousel() { calls.push('carousel'); return 'parent'; },
    async containerStatus() { return { statusCode: 'FINISHED', status: null }; },
    async publishContainer() { calls.push('publish'); return 'media-1'; },
    async permalink() { return 'https://instagram.com/p/x'; },
    async publishingLimit() { return { quotaUsage: 10, quotaTotal: 100 }; },
  };
  const driver = carouselsDriver({ query: q, meta: () => meta, signImage: async (p) => `https://signed/${p}`, token: () => 't' });
  const result = await publisherTick(query as unknown as SpineQuery, [driver]);
  assert.equal(result.mode, 'live');
  assert.equal((result as { released: number }).released, 1);
  assert.equal((result as { published: { status: string } }).published.status, 'published');
  assert.deepEqual(calls, ['item https://signed/a.jpg', 'item https://signed/b.jpg', 'carousel', 'publish']);
  assert.equal((await pg.query<{ status: string }>(`SELECT status FROM social_hub.schedule`)).rows[0]!.status, 'published');
  assert.equal((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.publishing_quota`)).rows[0]!.n, 1, 'the gate recorded its reading');
  // Already published: neither the publisher nor a type worker can post it again.
  assert.equal((await queuePublish(q, '40000000-0000-4000-8000-000000000001', 'force')).queued, false);
});
