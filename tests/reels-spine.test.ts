/**
 * Trial Reels on the lifecycle spine (D39): slots, attempts, approvals and
 * insights written through the real Reels code paths, offline. The shared
 * pool (lib/db.ts) is pointed at PGlite with the real schema files; Meta is
 * a stub. No Claude, no Instagram.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import type { ContainerInput, MetaClient } from '@/lib/reels/music/meta';
import { claimAndPublish, queuePublish } from '@/lib/reels/music/publish';
import { pollDueInsights } from '@/lib/reels/media-insights/poll';
import { forcePost, NOT_APPROVED_NOTE, releaseDueSchedules, schedulePostIdea } from '@/lib/reels/publish/schedule';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const IDEA = '50000000-0000-4000-8000-000000000001';
const SLATE = '50000000-0000-4000-8000-000000000002';
const VIDEO = '50000000-0000-4000-8000-000000000003';
const RUN = '50000000-0000-4000-8000-000000000004';
const NOW = new Date('2026-10-08T07:30:00Z'); // 3:30 AM New York

/** Point lib/db.ts's shared pool at PGlite for this test. */
async function spineDb(): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = {
    query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]),
  };
  return pg;
}

/** A finished reel with its copy and song: postable. */
async function seedReel(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${IDEA}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('${SLATE}', '${RUN}', '2026-10-08', now(), 'p1', 'p2');
    INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags)
    VALUES ('${SLATE}', '${IDEA}', 'v1', 'm', 'b', 'f', 'ok', 'A new model shipped today.', 'Follow for more.', ARRAY['#ai']);
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path)
    VALUES ('${VIDEO}', '${IDEA}', '${SLATE}', 'ok', now(), 'videos/x.mp4');
    INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist)
    VALUES ('${VIDEO}', '${IDEA}', 'ok', now(), 'aud-7', 'Song', 'Artist');`);
}

function stubMeta() {
  const containers: ContainerInput[] = [];
  const meta: MetaClient = {
    async trending() { return []; },
    async downloadPreview() { return { bytes: Buffer.alloc(0), contentType: null }; },
    async createReelContainer(input) { containers.push(input); return 'c-1'; },
    async containerStatus() { return { statusCode: 'FINISHED', status: null }; },
    async publishContainer() { return 'media-1'; },
    async permalink() { return 'https://instagram.com/reel/x'; },
    async publishingLimit() { return { quotaUsage: 3, quotaTotal: 100 }; },
  };
  return { meta, containers };
}

const due = (pg: PGlite) => pg.exec(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute' WHERE status = 'scheduled'`);

test('a nightly slot books the idea with no video; unapproved, it is cancelled when due (require_approval on)', async () => {
  const pg = await spineDb();
  await seedReel(pg);
  const booked = await schedulePostIdea(IDEA, 'auto', null, NOW);
  assert.equal(booked.scheduled, true);
  const slot = (await pg.query<{ idea_ref: string; content_item_id: string | null; approved_at: string | null }>(
    `SELECT idea_ref, content_item_id, approved_at FROM social_hub.schedule WHERE vertical = 'reels'`,
  )).rows[0]!;
  assert.deepEqual([slot.idea_ref, slot.content_item_id, slot.approved_at], [IDEA, null, null]);
  const again = await schedulePostIdea(IDEA, 'auto', null, NOW);
  assert.ok(again.scheduled && booked.scheduled && again.schedule.id === booked.schedule.id, 'one active slot per idea');

  await due(pg);
  assert.equal(await releaseDueSchedules(), 0);
  const row = (await pg.query<{ status: string; error: string }>(`SELECT status, error FROM social_hub.schedule`)).rows[0]!;
  assert.deepEqual([row.status, row.error], ['cancelled', NOT_APPROVED_NOTE]);
});

test('an approved slot attaches the video, carries the approval, and posts a trial reel with its song', async () => {
  const pg = await spineDb();
  await seedReel(pg);
  await schedulePostIdea(IDEA, 'auto', null, NOW);
  // A person approves the idea's slot before there is a video item (the approve-trial-reel path).
  const approved = await schedulePostIdea(IDEA, 'user', null, NOW);
  assert.equal(approved.scheduled, true);
  await due(pg);
  assert.equal(await releaseDueSchedules(), 1);

  const item = (await pg.query<{ id: string; native_ref: string; idea_ref: string }>(`SELECT id, native_ref, idea_ref FROM social_hub.content_items WHERE vertical = 'reels'`)).rows[0]!;
  assert.deepEqual([item.native_ref, item.idea_ref], [VIDEO, IDEA], 'the item is the video, its idea the post idea');
  const decision = (await pg.query<{ decision: string; via: string }>(`SELECT decision, via FROM social_hub.approvals WHERE content_item_id = $1`, [item.id])).rows[0]!;
  assert.deepEqual([decision.decision, decision.via], ['approved', 'user'], 'the slot approval is carried onto the video');

  const { meta, containers } = stubMeta();
  const out = await claimAndPublish({ meta, signVideo: async (p) => `https://signed/${p}`, sleep: async () => undefined });
  assert.equal(out?.status, 'published');
  assert.equal(containers[0]!.graduationStrategy, 'MANUAL', 'a trial reel stays off the grid');
  assert.equal(containers[0]!.audioId, 'aud-7');
  assert.equal((await pg.query<{ status: string }>(`SELECT status FROM social_hub.schedule`)).rows[0]!.status, 'published');
  assert.equal((await pg.query<{ published: boolean }>(`SELECT published FROM reels.published_status WHERE post_idea_id = $1`, [IDEA])).rows[0]!.published, true);
  const payload = (await pg.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM social_hub.publish_attempts`)).rows[0]!.payload;
  assert.equal(payload.post_idea_id, IDEA);
  assert.equal(payload.song_title, 'Song');
});

test('Force post is approval, posts once; a mix test may post the same reel again', async () => {
  const pg = await spineDb();
  await seedReel(pg);
  await schedulePostIdea(IDEA, 'auto', null, NOW);
  const forced = await forcePost(VIDEO);
  assert.equal(forced.queued, true);
  assert.equal((await pg.query<{ status: string }>(`SELECT status FROM social_hub.schedule`)).rows[0]!.status, 'cancelled', 'the slot cannot fire too');
  assert.equal((await pg.query<{ via: string }>(`SELECT via FROM social_hub.approvals`)).rows[0]!.via, 'force');
  const { meta } = stubMeta();
  await claimAndPublish({ meta, signVideo: async (p) => p, sleep: async () => undefined });
  assert.equal((await queuePublish(VIDEO, 'force')).queued, false, 'already published');
  assert.equal((await queuePublish(VIDEO, 'mix_test', { audioVolume: 40, videoVolume: 100 })).queued, true, 'mix_test is the deliberate repeat');
});

test('every Reels reader runs on the spine and sees the published reel', async () => {
  const pg = await spineDb();
  await seedReel(pg);
  await forcePost(VIDEO);
  const { meta } = stubMeta();
  await claimAndPublish({ meta, signVideo: async (p) => p, sleep: async () => undefined });

  const { loadPerformancePage } = await import('@/lib/reels/analytics/performance-store');
  const { loadPublishedStoryKeys, recentPublishedHeadlines } = await import('@/lib/reels/copy/held-out');
  const { loadMatchPool } = await import('@/lib/reels/grouping/content-candidates');
  const { loadHealthPage } = await import('@/lib/reels/health');
  const { loadReelsInsights } = await import('@/lib/reels/insights');
  const { loadReelSongs } = await import('@/lib/reels/music/overview');
  const { poolForEviction } = await import('@/lib/reels/music/store');
  const { loadSlateRanked } = await import('@/lib/reels/scoring/store');

  const performance = await loadPerformancePage({});
  assert.equal(performance.reels.length, 1, 'analytics reads the published reel from the spine');
  assert.equal((await loadReelSongs([VIDEO]))[VIDEO]?.publish?.status, 'published');
  // The rest only need to run against the spine without error.
  await loadPublishedStoryKeys();
  await recentPublishedHeadlines();
  await loadMatchPool();
  await loadHealthPage();
  await loadReelsInsights();
  await poolForEviction();
  await loadSlateRanked('2026-10-08');
});

test('insights land on the spine with shared_to_feed; mix tests are never read', async () => {
  const pg = await spineDb();
  await seedReel(pg);
  await forcePost(VIDEO);
  const { meta } = stubMeta();
  await claimAndPublish({ meta, signVideo: async (p) => p, sleep: async () => undefined, now: () => Date.parse('2026-10-08T12:00:00Z') });
  const status = await pollDueInsights({
    now: new Date('2026-10-08T13:00:00Z'),
    force: true,
    client: {
      async reelInsights() {
        return { views: 500, reach: 400, likes: 20, comments: 2, saved: 3, shares: 4, reposts: 1, totalInteractions: 30, avgWatchTimeMs: 6000, totalWatchTimeMs: 3e6, skipRate: 0.3, sharedToFeed: false, raw: {} };
      },
    },
  });
  assert.equal(status.written, 1);
  const row = (await pg.query<{ vertical: string; views: number; shared_to_feed: boolean; skip_rate: number }>(
    `SELECT vertical, views, shared_to_feed, skip_rate FROM social_hub.media_insights`,
  )).rows[0]!;
  assert.deepEqual([row.vertical, row.views, row.shared_to_feed, row.skip_rate], ['reels', 500, false, 0.3]);
});

test('the account gate now covers Trial Reels: too little quota left fails the try before any container (D40)', async () => {
  const pg = await spineDb();
  await seedReel(pg);
  assert.equal((await forcePost(VIDEO)).queued, true);
  const { meta, containers } = stubMeta();
  meta.publishingLimit = async () => ({ quotaUsage: 97, quotaTotal: 100 });
  const out = await claimAndPublish({ meta, signVideo: async (p) => p, sleep: async () => undefined });
  assert.equal(out?.status, 'failed');
  assert.equal(containers.length, 0, 'no trial container was made');
  const row = (await pg.query<{ error: string }>(`SELECT error FROM social_hub.publish_attempts WHERE vertical = 'reels'`)).rows[0]!;
  assert.match(row.error, /3 of 100 posts left in its 24-hour quota/);
});
