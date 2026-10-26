/**
 * AI Events for the single publisher (plan M4): its own switches, its queue rule, the shared
 * feed-carousel carry, and the calendar snapshot after a post goes out. Offline: a stub Meta
 * client and a stub snapshot.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_EVENTS_IG_LOCATION_ID } from '@/lib/ai-events/config';
import { carryAiEventsAttempt, queueAiEventsPublish } from '@/lib/ai-events/publish';
import { approveAiEventsPost } from '@/lib/ai-events/schedule';
import { aiEventsDriver } from '@/lib/publishing/drivers/ai-events';
import { publisherTick } from '@/lib/publishing/publisher';
import { claimFeedAttempt } from '@/lib/social/overnight/publish';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import type { Query } from '@/lib/social/store/pg';

import { openAiEventsDb, seedAiEventsPost } from './fixtures/ai-events/seed';

const meta: CarouselMetaClient = {
  async createImageItem() { return 'child'; },
  async createCarousel() { return 'parent'; },
  async containerStatus() { return { statusCode: 'FINISHED', status: null }; },
  async publishContainer() { return 'media-ae'; },
  async permalink() { return 'https://instagram.com/p/ae'; },
  async publishingLimit() { return { quotaUsage: 3, quotaTotal: 100 }; },
};

function driverFor(q: Query, snapshots: string[] = []) {
  return aiEventsDriver({
    query: q,
    meta: () => meta,
    signImage: async (p) => `https://signed/${p}`,
    token: () => 't',
    snapshot: async (reason) => {
      snapshots.push(reason);
    },
  });
}

test('the publisher releases an approved due AI Events post, carries it, and republishes the calendar', async () => {
  const { query } = await openAiEventsDb({ publishingLive: true });
  const q = query as unknown as Query;
  await q(`INSERT INTO social_hub.settings (key, value) VALUES ('publisher_mode', '"live"'::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  const id = await seedAiEventsPost(query);
  assert.equal((await approveAiEventsPost(q, id, new Date('2026-10-25T16:30:00Z'))).scheduled, true);
  await q(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  const snapshots: string[] = [];
  const driver = driverFor(q, snapshots);
  assert.equal(driver.vertical, 'ai_events');
  const tick = await publisherTick(q, [driver]);
  assert.deepEqual(tick.mode === 'live' ? [tick.released, tick.published?.vertical, tick.published?.status] : [tick.mode], [1, 'ai_events', 'published']);
  const post = (await q(`SELECT status, published_at FROM ai_events.posts WHERE id = $1`, [id])).rows[0];
  assert.equal(post.status, 'published');
  assert.ok(post.published_at);
  assert.equal((await q(`SELECT status FROM social_hub.schedule`)).rows[0].status, 'published');
  assert.deepEqual(snapshots, ['ai_events published']);
});

test('the driver is off while publishing_live is off, and when the ai_events schema is missing', async () => {
  const { query } = await openAiEventsDb();
  const q = query as unknown as Query;
  assert.equal(await driverFor(q).live(), false);
  assert.equal(await driverFor(q).requireApproval(), true);
  const broken: Query = async (text) => {
    if (/ai_events\./.test(text)) throw new Error('relation "ai_events.settings" does not exist');
    return { rows: [] };
  };
  assert.equal(await driverFor(broken).live(), false);
  assert.equal(await driverFor(broken).requireApproval(), true);
});

test('the queue rule: review posts with 2–10 slides only; a failed post never republishes the calendar', async () => {
  const { query } = await openAiEventsDb({ publishingLive: true });
  const q = query as unknown as Query;
  const id = await seedAiEventsPost(query);
  await q(`UPDATE ai_events.posts SET slide_objects = '["one.jpg"]'::jsonb WHERE id = $1`, [id]);
  const one = await queueAiEventsPublish(q, id, 'force');
  assert.equal(one.queued, false);
  assert.match(one.queued ? '' : one.note, /2–10 slide images/);
  await q(`UPDATE ai_events.posts SET slide_objects = '["a.jpg", "b.jpg"]'::jsonb, status = 'rejected' WHERE id = $1`, [id]);
  assert.match((await queueAiEventsPublish(q, id, 'force') as { note: string }).note, /Only posts in review publish/);

  await q(`UPDATE ai_events.posts SET status = 'review' WHERE id = $1`, [id]);
  assert.equal((await queueAiEventsPublish(q, id, 'force')).queued, true);
  const attempt = (await claimFeedAttempt(q, 'ai_events'))!;
  const snapshots: string[] = [];
  const failing: CarouselMetaClient = { ...meta, async containerStatus() { return { statusCode: 'ERROR', status: 'bad image' }; } };
  const out = await carryAiEventsAttempt({ query: q, meta: failing, signImage: async (p) => p }, attempt, { snapshot: async (r) => { snapshots.push(r); } });
  assert.equal(out.status, 'failed');
  assert.deepEqual(snapshots, []);
  assert.equal((await q(`SELECT status FROM ai_events.posts WHERE id = $1`, [id])).rows[0].status, 'review');
});

test('a Miami post is geotagged on the CAROUSEL parent (AE-34)', async () => {
  const { query } = await openAiEventsDb({ publishingLive: true });
  const q = query as unknown as Query;
  const id = await seedAiEventsPost(query, { metro: 'miami' });
  assert.equal((await queueAiEventsPublish(q, id, 'force')).queued, true);
  const attempt = (await claimFeedAttempt(q, 'ai_events'))!;
  let location: string | undefined;
  const tagging: CarouselMetaClient = {
    ...meta,
    async createCarousel(_children, _caption, locationId) {
      location = locationId;
      return 'parent';
    },
  };
  assert.equal((await carryAiEventsAttempt({ query: q, meta: tagging, signImage: async (p) => p }, attempt)).status, 'published');
  assert.equal(location, AI_EVENTS_IG_LOCATION_ID.miami);
});
