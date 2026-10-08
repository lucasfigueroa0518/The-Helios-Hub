/**
 * Stable hub ids (D46): one post per piece of content, under the same id from
 * Content ready through published. Offline: PGlite with every schema file.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDataset, findPost } from '@/lib/social-hub/dataset';
import { hubId } from '@/lib/social-hub/ids';
import { readAll } from '@/lib/social-hub/load';
import { approvePost } from '@/lib/social/overnight/schedule';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { IDS, seedHubFixture } from './fixtures/social-hub/seed';

test('a carousel keeps one id from Content ready → scheduled → publishing → published', async () => {
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  await pg.exec(`UPDATE social.posts SET slide_objects = '["a.jpg","b.jpg","c.jpg"]'::jsonb WHERE id = '${IDS.socPost2}'`);
  const stableId = hubId('carousels', 'content', IDS.socPost2);
  const view = async () => {
    const d = buildDataset(await readAll(query), null, new Date('2026-10-08T12:00:00Z'));
    const mine = d.posts.filter((p) => p.vertical === 'carousels' && (p.id === stableId || p.aliases?.includes(stableId)));
    assert.equal(mine.length, 1, 'exactly one hub post for the content');
    return { post: mine[0]!, d };
  };

  let { post } = await view();
  assert.deepEqual([post.id, post.status], [stableId, 'ready']);

  const placed = await approvePost(query as never, IDS.socPost2, new Date('2026-10-09T11:00:00Z'));
  assert.equal(placed.scheduled, true);
  ({ post } = await view());
  assert.deepEqual([post.id, post.status], [stableId, 'scheduled']);
  assert.ok(post.refs.scheduleId, 'the slot is on the post for its actions');

  await pg.exec(`
    INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, requested_at)
    SELECT content_item_id, 'carousels', 'approve', 'processing', 'c', now() FROM social_hub.schedule WHERE status = 'scheduled' AND vertical = 'carousels';
    UPDATE social_hub.schedule SET status = 'publishing', publish_attempt_id = (SELECT id FROM social_hub.publish_attempts WHERE status = 'processing') WHERE status = 'scheduled' AND vertical = 'carousels';`);
  ({ post } = await view());
  assert.deepEqual([post.id, post.status], [stableId, 'publishing']);

  await pg.exec(`
    UPDATE social_hub.publish_attempts SET status = 'published', finished_at = now(), media_id = 'm-new' WHERE status = 'processing';
    UPDATE social_hub.schedule SET status = 'published' WHERE status = 'publishing';`);
  let d;
  ({ post, d } = await view());
  assert.deepEqual([post.id, post.status], [stableId, 'published']);
  // Links made at any earlier stage still open it.
  assert.equal(findPost(d, hubId('carousels', 'post', IDS.socPost2))?.id, stableId);
  assert.equal(findPost(d, hubId('carousels', 'schedule', post.refs.scheduleId!))?.id, stableId);
  assert.equal(findPost(d, hubId('carousels', 'attempt', post.refs.attemptId!))?.id, stableId);
});

test('every vertical\'s posts carry content ids (a Reels slot before its video: the idea)', async () => {
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  const d = buildDataset(await readAll(query), null, new Date('2026-10-08T12:00:00Z'));
  for (const p of d.posts) {
    assert.match(p.id, /^(carousels|explainers|reels|stories):(idea:)?[0-9a-f-]{36}$/, p.id);
  }
  assert.equal(new Set(d.posts.map((p) => p.id)).size, d.posts.length, 'ids are unique');
});
