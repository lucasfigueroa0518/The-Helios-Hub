import assert from 'node:assert/strict';
import test from 'node:test';

import { lfdItemId } from '@/lib/lfd/items';
import { claimAndPublishLfd, queueLfdPublish } from '@/lib/lfd/publish';
import { rejectItem } from '@/lib/social-hub/spine';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import type { Query } from '@/lib/social/store/pg';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

function stubMeta(overrides: Partial<CarouselMetaClient> = {}) {
  const calls: string[] = [];
  let n = 0;
  const meta: CarouselMetaClient = {
    async createImageItem(url) { calls.push(`item ${url}`); return `child-${++n}`; },
    async createCarousel(children, caption) { calls.push(`carousel ${children.length} ${caption.length}`); return 'parent-1'; },
    async containerStatus() { calls.push('status'); return { statusCode: 'FINISHED', status: null }; },
    async publishContainer(id) { calls.push(`publish ${id}`); return 'media-1'; },
    async permalink() { return 'https://instagram.com/p/lfd'; },
    async publishingLimit() { return { quotaUsage: 3, quotaTotal: 100 }; },
    ...overrides,
  };
  return { meta, calls };
}

const sign = async (objectPath: string) => `https://signed/${objectPath}`;

test('a review post with its slides queues one attempt on the spine; a second is refused', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const id = await seedLfdPost(query);
  assert.equal((await queueLfdPublish(q, id, 'approve')).queued, true);
  const row = (await q(`SELECT a.vertical, a.trigger, a.caption, a.payload, ci.native_ref, ci.idea_ref, ci.format
                           FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id`)).rows[0];
  assert.deepEqual([row.vertical, row.trigger, row.native_ref, row.idea_ref, row.format], ['last_few_days', 'approve', id, null, 'feed']);
  assert.equal(row.payload.image_objects.length, 8);
  assert.match(row.caption, /^Do you realize/);
  const second = await queueLfdPublish(q, id, 'force');
  assert.deepEqual([second.queued, second.queued ? '' : second.note], [false, 'This Last Few Days post is already publishing or published.']);
});

test('only a review post with 2–10 images queues', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const rejected = await seedLfdPost(query, { slug: 'lfd-a', status: 'rejected' });
  const one = await seedLfdPost(query, { slug: 'lfd-b', slides: 1 });
  const r1 = await queueLfdPublish(q, rejected, 'approve');
  assert.match(r1.queued ? '' : r1.note, /Only posts in review publish \(this one is rejected\)/);
  const r2 = await queueLfdPublish(q, one, 'approve');
  assert.match(r2.queued ? '' : r2.note, /needs 2–10 slide images in Storage \(has 1\)/);
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0].n, 0);
});

test('publishing marks the lfd post, the attempt and the photos, never a carousel row', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const id = await seedLfdPost(query);
  await queueLfdPublish(q, id, 'approve');
  const { meta, calls } = stubMeta();
  const out = await claimAndPublishLfd({ query: q, meta, signImage: sign, sleep: async () => undefined, now: () => Date.parse('2026-10-13T13:40:00Z') });
  assert.equal(out?.status, 'published');
  assert.equal(calls.filter((c) => c.startsWith('item ')).length, 8);
  assert.equal(calls[0], 'item https://signed/lfd/lfd-2026-10-13/slide-01.jpg');
  const post = (await q(`SELECT status, published_at FROM lfd.posts WHERE id = $1`, [id])).rows[0];
  assert.equal(post.status, 'published');
  assert.equal(new Date(post.published_at).toISOString(), '2026-10-13T13:40:00.000Z');
  const attempt = (await q(`SELECT status, media_id, permalink FROM social_hub.publish_attempts`)).rows[0];
  assert.deepEqual([attempt.status, attempt.media_id, attempt.permalink], ['published', 'media-1', 'https://instagram.com/p/lfd']);
  const photos = (await q(`SELECT url, story_id, slide, source, post_id FROM social.used_photos ORDER BY slide`)).rows;
  assert.deepEqual(photos.map((p) => [p.url, p.story_id, p.slide, p.source, p.post_id]), [
    ['https://p/haiku.jpg', `lfd:${id}`, 2, 'lfd', null],
    ['https://p/person.jpg', `lfd:${id}`, 4, 'lfd', null],
  ]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM social.posts`)).rows[0].n, 0);
});

test('a rejected item fails at carry without making containers', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const id = await seedLfdPost(query);
  await queueLfdPublish(q, id, 'approve');
  await rejectItem(q, (await lfdItemId(q, id))!);
  const { meta, calls } = stubMeta();
  const out = await claimAndPublishLfd({ query: q, meta, signImage: sign, sleep: async () => undefined });
  assert.equal(out?.status, 'failed');
  assert.deepEqual(calls, []);
  assert.match((await q(`SELECT error FROM social_hub.publish_attempts`)).rows[0].error, /This Last Few Days post was rejected after its slot opened/);
  assert.equal((await q(`SELECT status FROM lfd.posts WHERE id = $1`, [id])).rows[0].status, 'review');
});

test('when marking the lfd post published throws after Instagram took it, the attempt stays published and it never re-queues', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const id = await seedLfdPost(query);
  await queueLfdPublish(q, id, 'approve');
  let thrown = false;
  const flaky: Query = async (text, params) => {
    if (!thrown && text.startsWith(`UPDATE lfd.posts SET status = 'published'`)) {
      thrown = true;
      throw new Error('database blip');
    }
    return q(text, params);
  };
  const { meta, calls } = stubMeta();
  const out = await claimAndPublishLfd({ query: flaky, meta, signImage: sign, sleep: async () => undefined });
  assert.equal(out?.status, 'published');
  assert.equal(calls.filter((c) => c.startsWith('publish')).length, 1);
  const attempt = (await q(`SELECT status, media_id, permalink FROM social_hub.publish_attempts`)).rows[0];
  assert.deepEqual([attempt.status, attempt.media_id, attempt.permalink], ['published', 'media-1', 'https://instagram.com/p/lfd']);
  assert.equal((await q(`SELECT status FROM lfd.posts WHERE id = $1`, [id])).rows[0].status, 'published', 'the retry marked it');

  // Even with the lfd row still in review, a published attempt refuses a new one (publish_once holds).
  await q(`UPDATE lfd.posts SET status = 'review' WHERE id = $1`, [id]);
  const again = await queueLfdPublish(q, id, 'force');
  assert.equal(again.queued, false);
  assert.equal(again.queued ? false : again.alreadyPublished, true);
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0].n, 1);
});
