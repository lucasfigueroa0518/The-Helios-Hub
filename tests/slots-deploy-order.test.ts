/**
 * Deploy order (spec §5): the worker code may reach a database before the
 * schema apply adds social_hub.schedule.feed_mode. In legacy mode every
 * scheduler and both publish queues must still work there. Offline PGlite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { saveFeedback } from '@/lib/explainers/repository';
import { queuePublish as queueExplainer } from '@/lib/explainers/publish/publish';
import { scheduleJob } from '@/lib/explainers/publish/schedule';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { scheduleLfdPost } from '@/lib/lfd/schedule';
import { queuePublish as queueReel } from '@/lib/reels/music/publish';
import { schedulePostIdea } from '@/lib/reels/publish/schedule';
import { schedulePost } from '@/lib/social/overnight/schedule';

import { scratchExplainersDb } from './explainers-pglite';
import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const NOW = new Date('2026-10-20T04:00:00Z'); // Tue Oct 20, midnight New York
const LATE_TUESDAY = new Date('2026-10-21T02:00:00Z'); // Tue Oct 20, 10:00 PM New York
const first = () => 0;
const DROP = `ALTER TABLE social_hub.schedule DROP COLUMN feed_mode CASCADE`;

type PoolHolder = { __outreachHubPool?: unknown };

/** Point lib/db.ts's shared pool at PGlite for one test, and put the old one back after. */
function usePool(t: test.TestContext, pg: PGlite): void {
  const holder = globalThis as PoolHolder;
  const before = holder.__outreachHubPool;
  holder.__outreachHubPool = { query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]) };
  t.after(() => {
    if (before === undefined) delete holder.__outreachHubPool;
    else holder.__outreachHubPool = before;
  });
}

test('own and busy feed times without feed_mode: Explainers are all Main, no reel is Main', async () => {
  const { pg, query } = await openHubTestDb();
  const item = (await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('explainers', 'reel', 'e1') RETURNING id`)).rows[0]!.id;
  await pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'explainers', '2026-10-20', 'late', '2026-10-20T23:30:00Z', 'scheduled', 'auto')`,
    [item],
  );
  await pg.exec(DROP);
  const q = query as never;
  assert.deepEqual((await ownFeedTimes(q, 'explainers', NOW)).map((d) => d.toISOString()), ['2026-10-20T23:30:00.000Z']);
  assert.deepEqual(await ownFeedTimes(q, 'reels', NOW), []);
  assert.deepEqual((await busyFeedTimes(q, NOW)).map((d) => d.toISOString()), ['2026-10-20T23:30:00.000Z']);
});

test('explainers: scheduleJob and queuePublish work without feed_mode (legacy)', async () => {
  const { db } = await scratchExplainersDb();
  await db.query(DROP);
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

  const booked = await scheduleJob(db, jobId, 'auto', NOW, undefined, first);
  assert.equal(booked.scheduled, true, booked.scheduled ? '' : booked.note);
  // A second booking attempt returns early on the existing booking (it doesn't book or read spacing again).
  assert.equal((await scheduleJob(db, jobId, 'auto', NOW, undefined, first)).scheduled, true);

  const queued = await queueExplainer(db, jobId, 'approve');
  assert.equal(queued.queued, true, queued.queued ? '' : queued.note);
  const { rows } = await db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM social_hub.publish_attempts`);
  assert.deepEqual(rows[0]!.payload, { video_object: 'v.mp4', share_to_feed: true });
});

test('carousels: schedulePost works without feed_mode (legacy)', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(DROP);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO social.posts (slug, title, status, render, origin, slide_objects)
     VALUES ('c-wed', 't', 'review', '{"caption":"A caption.","slides":[]}'::jsonb, 'pipeline', '["posts/c-wed/a.jpg"]'::jsonb) RETURNING id`,
  );
  const out = await schedulePost(query as never, rows[0]!.id, 'auto', LATE_TUESDAY, '2026-10-21', first);
  assert.equal(out.scheduled, true);
});

test('last few days: scheduleLfdPost works without feed_mode (legacy)', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(DROP);
  const tue = await seedLfdPost(query, { nyDate: '2026-10-20' });
  assert.equal((await scheduleLfdPost(query as never, tue, 'auto', NOW, '2026-10-20', first)).scheduled, true);
});

const IDEA = '72000000-0000-4000-8000-000000000001';
const SLATE = '72000000-0000-4000-8000-000000000002';
const VIDEO = '72000000-0000-4000-8000-000000000003';
const RUN = '72000000-0000-4000-8000-000000000004';

test('reels: schedulePostIdea and queuePublish work without feed_mode (legacy)', async (t) => {
  const { pg } = await openHubTestDb();
  usePool(t, pg);
  await pg.exec(DROP);
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

  const out = await schedulePostIdea(IDEA, 'auto', null, NOW, '2026-10-20');
  assert.equal(out.scheduled, true, out.note);

  const queued = await queueReel(VIDEO, 'approve');
  assert.equal(queued.queued, true, queued.queued ? '' : queued.note);
  const { rows } = await pg.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM social_hub.publish_attempts`);
  assert.equal(rows[0]!.payload.graduation_strategy, 'SS_PERFORMANCE', 'a trial reel, as before');
});
