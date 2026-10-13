/**
 * The hub's "made" list (REEL_MADE_SQL): a finished reel video that has not
 * gone anywhere yet. Only an ACTIVE slot (scheduled / publishing), a published
 * attempt, or a rejection takes it off the list. A cancelled or failed slot,
 * or a failed attempt, leaves it there so it can be placed again.
 * Offline: PGlite with the real schema files. No Claude, no Instagram.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { REEL_MADE_SQL } from '@/lib/social-hub/queries/reels';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const IDEA = '60000000-0000-4000-8000-000000000001';
const SLATE = '60000000-0000-4000-8000-000000000002';
const VIDEO = '60000000-0000-4000-8000-000000000003';
const RUN = '60000000-0000-4000-8000-000000000004';
const ITEM = '60000000-0000-4000-8000-000000000005';

async function seed(): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${IDEA}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('${SLATE}', '${RUN}', '2026-10-12', now(), 'p1', 'p2');
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path)
    VALUES ('${VIDEO}', '${IDEA}', '${SLATE}', 'ok', now(), 'videos/x.mp4');
    INSERT INTO social_hub.content_items (id, vertical, format, native_ref, idea_ref) VALUES ('${ITEM}', 'reels', 'reel', '${VIDEO}', '${IDEA}');`);
  return pg;
}

const made = async (pg: PGlite) => (await pg.query<{ video_job_id: string }>(REEL_MADE_SQL)).rows.map((r) => r.video_job_id);

const slot = (pg: PGlite, status: string, day: string, slotName = 'morning') =>
  pg.exec(`INSERT INTO social_hub.schedule (content_item_id, vertical, idea_ref, ny_date, slot, publish_at, status, source)
           VALUES ('${ITEM}', 'reels', '${IDEA}', '${day}', '${slotName}', now(), '${status}', 'user')`);

const attempt = (pg: PGlite, status: string) =>
  pg.exec(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, payload)
           VALUES ('${ITEM}', 'reels', 'approve', '${status}', 'c', '{}'::jsonb)`);

test('a finished video with nothing against it is on the made list', async () => {
  const pg = await seed();
  assert.deepEqual(await made(pg), [VIDEO]);
});

test('a cancelled (unscheduled) slot does not hide the made video', async () => {
  const pg = await seed();
  await slot(pg, 'cancelled', '2026-10-13');
  assert.deepEqual(await made(pg), [VIDEO]);
});

test('a failed slot and a failed attempt do not hide the made video', async () => {
  const pg = await seed();
  await slot(pg, 'failed', '2026-10-13');
  await attempt(pg, 'failed');
  assert.deepEqual(await made(pg), [VIDEO]);
});

test('an active slot (scheduled or publishing) hides the made video', async () => {
  for (const status of ['scheduled', 'publishing']) {
    const pg = await seed();
    await slot(pg, status, '2026-10-13');
    assert.deepEqual(await made(pg), [], status);
  }
});

test('a published slot or published attempt hides the made video', async () => {
  const bySlot = await seed();
  await slot(bySlot, 'published', '2026-10-13');
  assert.deepEqual(await made(bySlot), []);
  const byAttempt = await seed();
  await attempt(byAttempt, 'published');
  assert.deepEqual(await made(byAttempt), []);
});

test('a rejection hides the made video even with no slot', async () => {
  const pg = await seed();
  await pg.exec(`INSERT INTO social_hub.approvals (content_item_id, decision, via) VALUES ('${ITEM}', 'rejected', 'user')`);
  assert.deepEqual(await made(pg), []);
});
