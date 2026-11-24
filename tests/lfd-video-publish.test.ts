// Last Few Days video slides on Instagram (MD-LFD D19): a saved video posts as a VIDEO carousel child, polled to
// FINISHED before the parent; a slide revised since its MP4 was made posts its JPEG. Stubbed Meta client, PGlite.
import assert from 'node:assert/strict';
import test from 'node:test';

import { claimAndPublishLfd, queueLfdPublish, withVideoSlides } from '@/lib/lfd/publish';
import { videoCheck } from '@/lib/lfd/video';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import type { Query } from '@/lib/social/store/pg';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const sign = async (objectPath: string, seconds: number) => `https://signed/${objectPath}?s=${seconds}`;

function stubMeta(o: { childStatuses?: string[]; noVideo?: boolean } = {}) {
  const calls: string[] = [];
  const statuses = [...(o.childStatuses ?? ['IN_PROGRESS', 'FINISHED'])];
  let n = 0;
  const meta: CarouselMetaClient = {
    async createImageItem(url) { calls.push(`image ${url}`); return `child-${++n}`; },
    ...(o.noVideo ? {} : { async createVideoItem(url: string) { calls.push(`video ${url}`); return `video-${++n}`; } }),
    async createCarousel(children) { calls.push(`carousel ${children.join(',')}`); return 'parent-1'; },
    async containerStatus(id) {
      calls.push(`status ${id}`);
      if (id.startsWith('video-')) return { statusCode: statuses.shift() ?? 'FINISHED', status: null };
      return { statusCode: 'FINISHED', status: null };
    },
    async publishContainer(id) { calls.push(`publish ${id}`); return 'media-1'; },
    async permalink() { return 'https://instagram.com/p/lfd'; },
    async publishingLimit() { return { quotaUsage: 3, quotaTotal: 100 }; },
  };
  return { meta, calls };
}

/** Give story 0 of a seeded post a saved video; `stale` saves a check for words the story no longer has. */
async function withVideo(q: Query, id: string, stale = false): Promise<void> {
  const { stories } = (await q(`SELECT stories FROM lfd.posts WHERE id = $1`, [id])).rows[0] as { stories: Array<Record<string, unknown>> };
  const s = stories[0]!;
  const check = videoCheck({ setup: String(s.setup ?? ''), headline: stale ? 'an older headline' : String(s.headline), body: String(s.body), photo: s.photo as { src: string } });
  stories[0] = { ...s, photoSource: 'video', video: { object: 'lfd/lfd-2026-10-13/video-abc.mp4', band: 'lfd/lfd-2026-10-13/video-abc-band.mp4', seconds: 8, fit: 'crop', tier: 'golden', sourceUrl: 'https://youtube.com/x', check } };
  await q(`UPDATE lfd.posts SET stories = $2::jsonb WHERE id = $1`, [id, JSON.stringify(stories)]);
}

test('withVideoSlides swaps story i\'s MP4 into slide i + 2 only while its check matches', () => {
  const objects = ['c.jpg', 's1.jpg', 's2.jpg', 'f.jpg'];
  const story = { setup: '', headline: 'H', body: 'B', photo: { src: 'storage:p.jpg' } };
  const check = videoCheck(story);
  assert.deepEqual(withVideoSlides(objects, [{ ...story, video: { object: 'v.mp4', check } }, { headline: 'x' }]), ['c.jpg', 'v.mp4', 's2.jpg', 'f.jpg']);
  assert.deepEqual(withVideoSlides(objects, [{ ...story, headline: 'Revised', video: { object: 'v.mp4', check } }]), objects, 'a revised slide posts its JPEG');
  assert.deepEqual(withVideoSlides(objects, [story]), objects, 'no video, no change');
});

test('a video slide posts as a VIDEO child, polled to FINISHED before the carousel parent', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const id = await seedLfdPost(query);
  await withVideo(q, id);
  assert.equal((await queueLfdPublish(q, id, 'approve')).queued, true);
  const payload = (await q(`SELECT payload FROM social_hub.publish_attempts`)).rows[0].payload as { image_objects: string[] };
  assert.equal(payload.image_objects[1], 'lfd/lfd-2026-10-13/video-abc.mp4');
  const { meta, calls } = stubMeta();
  const slept: number[] = [];
  const out = await claimAndPublishLfd({ query: q, meta, signImage: sign, sleep: async (ms) => { slept.push(ms); }, now: () => Date.parse('2026-10-13T13:40:00Z') });
  assert.equal(out?.status, 'published');
  assert.equal(calls[0], 'image https://signed/lfd/lfd-2026-10-13/slide-01.jpg?s=7200');
  assert.equal(calls[1], 'video https://signed/lfd/lfd-2026-10-13/video-abc.mp4?s=7200');
  assert.equal(calls.filter((c) => c.startsWith('image ')).length, 7);
  const carousel = calls.findIndex((c) => c.startsWith('carousel '));
  const childPolls = calls.map((c, i) => (c === 'status video-2' ? i : -1)).filter((i) => i >= 0);
  assert.equal(childPolls.length, 2, 'IN_PROGRESS, then FINISHED');
  assert.ok(childPolls.every((i) => i < carousel), 'the child is FINISHED before the parent is made');
  assert.match(calls[carousel]!, /^carousel child-1,video-2,child-3/);
  assert.deepEqual(slept.slice(0, 1), [10_000]);
  assert.equal((await q(`SELECT status FROM lfd.posts WHERE id = $1`, [id])).rows[0].status, 'published');
});

test('a slide revised since its MP4 was made posts its JPEG', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const id = await seedLfdPost(query);
  await withVideo(q, id, true);
  await queueLfdPublish(q, id, 'approve');
  const { meta, calls } = stubMeta();
  const out = await claimAndPublishLfd({ query: q, meta, signImage: sign, sleep: async () => undefined, now: () => Date.parse('2026-10-13T13:40:00Z') });
  assert.equal(out?.status, 'published');
  assert.equal(calls.filter((c) => c.startsWith('video ')).length, 0);
  assert.equal(calls.filter((c) => c.startsWith('image ')).length, 8);
});

test('a video child Instagram cannot process fails the attempt before any parent is made', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const id = await seedLfdPost(query);
  await withVideo(q, id);
  await queueLfdPublish(q, id, 'approve');
  const { meta, calls } = stubMeta({ childStatuses: ['ERROR'] });
  const out = await claimAndPublishLfd({ query: q, meta, signImage: sign, sleep: async () => undefined, now: () => Date.parse('2026-10-13T13:40:00Z') });
  assert.equal(out?.status, 'failed');
  assert.ok(!calls.some((c) => c.startsWith('carousel ')));
  const attempt = (await q(`SELECT status, error FROM social_hub.publish_attempts`)).rows[0];
  assert.match(attempt.error, /could not process a video slide/);
  assert.equal((await q(`SELECT status FROM lfd.posts WHERE id = $1`, [id])).rows[0].status, 'review');
});

test('a client that cannot post video fails the attempt rather than posting a still', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const id = await seedLfdPost(query);
  await withVideo(q, id);
  await queueLfdPublish(q, id, 'approve');
  const { meta } = stubMeta({ noVideo: true });
  const out = await claimAndPublishLfd({ query: q, meta, signImage: sign, sleep: async () => undefined, now: () => Date.parse('2026-10-13T13:40:00Z') });
  assert.equal(out?.status, 'failed');
});
