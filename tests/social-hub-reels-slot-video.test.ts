/**
 * A booked reel slot with no publish attempt yet (an auto slot waiting for the
 * owner's approval) used to reach the hub with no video, so the Content page
 * showed "Not made yet" for a reel the night had built (2026-10-13). The hub
 * now shows the video the publisher will post for it: the idea's newest
 * finished video that has its song and its copy (publish/schedule.ts
 * readyVideo). Offline: PGlite with the real schema files.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { readReels } from '@/lib/social-hub/queries/reels';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const IDEA = '70000000-0000-4000-8000-000000000001';
const SLATE = '70000000-0000-4000-8000-000000000002';
const OLD = '70000000-0000-4000-8000-000000000003';
const NEW = '70000000-0000-4000-8000-000000000004';
const NOSONG = '70000000-0000-4000-8000-000000000005';
const RUN = '70000000-0000-4000-8000-000000000006';
const SCHEDULE = '70000000-0000-4000-8000-000000000007';

async function seed(): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${IDEA}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('${SLATE}', '${RUN}', '2026-10-13', now(), 'p1', 'p2');
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path) VALUES
      ('${OLD}', '${IDEA}', '${SLATE}', 'ok', now() - interval '2 days', 'videos/old.mp4'),
      ('${NEW}', '${IDEA}', '${SLATE}', 'ok', now() - interval '1 hour', 'videos/new.mp4'),
      ('${NOSONG}', '${IDEA}', '${SLATE}', 'ok', now(), 'videos/nosong.mp4');
    INSERT INTO reels.song_picks (video_job_id, post_idea_id, status) VALUES ('${OLD}', '${IDEA}', 'ok'), ('${NEW}', '${IDEA}', 'ok');
    INSERT INTO reels.idea_copy (post_idea_id, slate_id, status, prompt_version, model, bucket, framework) VALUES ('${IDEA}', '${SLATE}', 'ok', 'v1', 'm', 'B', 'f');`);
  return pg;
}

const spineWith = (contentRef: string | null) => ({
  attempts: [],
  insights: [],
  schedules: [{
    schedule_id: SCHEDULE, vertical: 'reels' as const, content_ref: contentRef, idea_ref: IDEA, ny_date: '2026-10-13', slot: 'morning',
    publish_at: '2026-10-13T13:20:00Z', status: 'scheduled', source: 'auto', error: null, approved_at: null, created_at: '2026-10-13T05:14:00Z',
  }],
});

const read = async (pg: PGlite, contentRef: string | null) => readReels((t, p) => pg.query(t, p as never) as never, spineWith(contentRef) as never);

test('a booked slot with no video link shows the idea\'s newest finished video that has its song and copy', async () => {
  const pg = await seed();
  const r = await read(pg, null);
  assert.equal(r.schedules.length, 1);
  assert.equal(r.schedules[0]!.video_job_id, NEW, 'the newest video with a song, not the older one and not the one with no song');
  assert.equal(r.schedules[0]!.video_storage_path, 'videos/new.mp4');
});

test('a slot that already names its video keeps it', async () => {
  const pg = await seed();
  const r = await read(pg, OLD);
  assert.equal(r.schedules[0]!.video_job_id, OLD);
});

test('a booked slot whose idea has no finished video with a song and copy stays without a video', async () => {
  const { pg } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${IDEA}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('${SLATE}', '${RUN}', '2026-10-13', now(), 'p1', 'p2');
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path) VALUES ('${NOSONG}', '${IDEA}', '${SLATE}', 'ok', now(), 'videos/nosong.mp4');`);
  const r = await read(pg, null);
  assert.equal(r.schedules[0]!.video_job_id, null);
});
