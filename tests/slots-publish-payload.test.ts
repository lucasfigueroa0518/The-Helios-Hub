/**
 * Trial / Main end to end (spec §5): queuePublish writes the booking's mode
 * into social_hub.publish_attempts.payload, and the Explainer carry turns it
 * into the container request. No booking (legacy) keeps the old payload
 * exactly. Offline PGlite; Meta is a stub; nothing is sent.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import type { Queryable } from '@/lib/explainers/db';
import { explainerItemId, spineOf } from '@/lib/explainers/publish/items';
import type { ReelMetaClient } from '@/lib/explainers/publish/meta';
import { claimAndPublish, queuePublish as queueExplainer } from '@/lib/explainers/publish/publish';
import { saveFeedback } from '@/lib/explainers/repository';
import { TRIAL_GRADUATION_STRATEGY } from '@/lib/reels/config';
import { queuePublish as queueReel } from '@/lib/reels/music/publish';
import { reelItemId } from '@/lib/reels/publish/items';
import { bookSlot } from '@/lib/social-hub/spine';
import type { FeedMode } from '@/lib/social-hub/slots/types';

import { scratchExplainersDb } from './explainers-pglite';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const AT = new Date('2026-10-20T17:30:00Z');

// ---- Explainers ----

async function explainerJob(db: Queryable): Promise<string> {
  const { rows: t } = await db.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status) VALUES ('What is an API?', 'manual', 'rendered') RETURNING id`);
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at)
     VALUES ($1, 'ok', 'click', 'development', 5, 'm', 'm', now()) RETURNING id`,
    [t[0]!.id],
  );
  const jobId = j[0]!.id;
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', 'v.mp4', 5000000, 'bucket')`, [jobId]);
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, content) VALUES ($1, 'post_caption', 'The door between two programs.')`, [jobId]);
  await saveFeedback(db, { jobId, verdict: 'approved', tags: [] });
  return jobId;
}

/** Queue one Explainer (booked with `mode`, or not booked), carry it through a stub Meta, and return the payload and the container input. */
async function explainerRun(mode: FeedMode | null) {
  const { db } = await scratchExplainersDb();
  const jobId = await explainerJob(db);
  if (mode) {
    const itemId = (await explainerItemId(db, jobId))!;
    await bookSlot(spineOf(db), { vertical: 'explainers', itemId, nyDate: '2026-10-20', slot: 'afternoon', publishAt: AT, source: 'auto', feedMode: mode });
  }
  const queued = await queueExplainer(db, jobId, 'approve');
  assert.equal(queued.queued, true);
  const payload = (await db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM social_hub.publish_attempts`)).rows[0]!.payload;
  const created: Array<Parameters<ReelMetaClient['createReel']>[0]> = [];
  const meta: ReelMetaClient = {
    async createReel(input) { created.push(input); return 'container-1'; },
    async containerStatus() { return { statusCode: 'FINISHED', status: null }; },
    async publishContainer() { return 'media-1'; },
    async permalink() { return 'https://instagram.com/reel/x'; },
    async publishingLimit() { return { quotaUsage: 1, quotaTotal: 100 }; },
  };
  const carried = await claimAndPublish({ db, meta, signVideo: async (p) => `https://signed/${p}`, sleep: async () => undefined });
  assert.equal(carried?.status, 'published');
  return { payload, created: created[0]! };
}

test('explainers, no booking (legacy): the payload is exactly the old one and the container shares to the feed', async () => {
  const { payload, created } = await explainerRun(null);
  assert.deepEqual(payload, { video_object: 'v.mp4', share_to_feed: true });
  assert.equal(created.shareToFeed, true);
  assert.equal(created.graduationStrategy, null);
});

test('explainers, Main booking: share_to_feed true, no trial params', async () => {
  const { payload, created } = await explainerRun('main');
  assert.deepEqual(payload, { video_object: 'v.mp4', share_to_feed: true });
  assert.equal(created.shareToFeed, true);
  assert.equal(created.graduationStrategy, null);
});

test('explainers, Trial booking: trial params, share_to_feed left out', async () => {
  const { payload, created } = await explainerRun('trial');
  assert.deepEqual(payload, { video_object: 'v.mp4', graduation_strategy: TRIAL_GRADUATION_STRATEGY });
  assert.equal(created.shareToFeed, null, 'not sent');
  assert.equal(created.graduationStrategy, TRIAL_GRADUATION_STRATEGY);
});

// ---- Text on Screen (reels): the app pool, pointed at PGlite ----

const IDEA = '73000000-0000-4000-8000-000000000001';
const SLATE = '73000000-0000-4000-8000-000000000002';
const VIDEO = '73000000-0000-4000-8000-000000000003';
const RUN = '73000000-0000-4000-8000-000000000004';

type PoolHolder = { __outreachHubPool?: unknown };

async function reelsDb(t: test.TestContext): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  const holder = globalThis as PoolHolder;
  const before = holder.__outreachHubPool;
  holder.__outreachHubPool = { query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]) };
  t.after(() => {
    if (before === undefined) delete holder.__outreachHubPool;
    else holder.__outreachHubPool = before;
  });
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${IDEA}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('${SLATE}', '${RUN}', '2026-10-20', now(), 'p1', 'p2');
    INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags)
    VALUES ('${SLATE}', '${IDEA}', 'v1', 'm', 'b', 'f', 'ok', 'A new model shipped today.', 'Follow for more.', ARRAY['#ai']);
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path)
    VALUES ('${VIDEO}', '${IDEA}', '${SLATE}', 'ok', now(), 'videos/x.mp4');
    INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist)
    VALUES ('${VIDEO}', '${IDEA}', 'ok', now(), 'aud-7', 'Song', 'Artist');`);
  return pg;
}

async function reelPayload(t: test.TestContext, mode: FeedMode | null): Promise<Record<string, unknown>> {
  const pg = await reelsDb(t);
  if (mode) {
    const itemId = await reelItemId(VIDEO);
    await bookSlot((text, params) => pg.query(text, params as unknown[]) as never, { vertical: 'reels', itemId, ideaRef: IDEA, nyDate: '2026-10-20', slot: 'morning', publishAt: AT, source: 'auto', feedMode: mode });
  }
  const queued = await queueReel(VIDEO, 'approve');
  assert.equal(queued.queued, true);
  return (await pg.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM social_hub.publish_attempts`)).rows[0]!.payload;
}

const REEL_BASE = { audio_id: 'aud-7', song_title: 'Song', song_artist: 'Artist', audio_volume: 100, video_volume: 100, post_idea_id: IDEA };

test('reels, no booking (legacy): the old trial payload, every key', async (t) => {
  const payload = await reelPayload(t, null);
  const { song_pick_id, ...rest } = payload;
  assert.equal(typeof song_pick_id, 'string');
  assert.deepEqual(rest, { ...REEL_BASE, graduation_strategy: TRIAL_GRADUATION_STRATEGY, share_to_feed: null });
});

test('reels, Trial booking: trial params, share_to_feed left to the OPEN-3 setting', async (t) => {
  const { song_pick_id: _, ...rest } = await reelPayload(t, 'trial');
  assert.deepEqual(rest, { ...REEL_BASE, graduation_strategy: TRIAL_GRADUATION_STRATEGY, share_to_feed: null });
});

test('reels, Main booking: no trial params, shared to the feed', async (t) => {
  const { song_pick_id: _, ...rest } = await reelPayload(t, 'main');
  assert.deepEqual(rest, { ...REEL_BASE, graduation_strategy: null, share_to_feed: true });
});
