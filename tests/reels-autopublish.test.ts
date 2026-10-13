/**
 * Trial Reels auto-publish path, offline (PGlite + stub Meta, no Claude, no
 * Instagram): with require_approval off, a selected reel on a slate becomes a
 * scheduled slot and posts with no human approval; one bounded retry for a
 * clean failure; which finished videos the nightly fill may reuse (D55).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { reusableVideos } from '@/lib/reels/pipeline/fill';
import type { MetaClient } from '@/lib/reels/music/meta';
import { claimAndPublish } from '@/lib/reels/music/publish';
import { releaseDueSchedules, retryFailedSlots, retryableError, scheduleSelectedSlate } from '@/lib/reels/publish/schedule';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const IDEA = '70000000-0000-4000-8000-000000000001';
const SLATE = '70000000-0000-4000-8000-000000000002';
const VIDEO = '70000000-0000-4000-8000-000000000003';
const RUN = '70000000-0000-4000-8000-000000000004';
const NEXT_SLATE = '70000000-0000-4000-8000-000000000005';
const RUN2 = '70000000-0000-4000-8000-000000000006';
const ONE_AM = new Date('2026-10-08T05:00:00Z'); // 1:00 AM New York, Oct 8

async function db(): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = {
    query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]),
  };
  return pg;
}

/** A finished, postable reel made on `madeOn`, and a slate for `slateDay` that selected the idea. */
async function seed(pg: PGlite, opts: { madeOn?: string; slateDay?: string; origin?: 'timely' | 'carryover'; settings?: boolean } = {}): Promise<void> {
  const madeOn = opts.madeOn ?? '2026-10-08';
  const slateDay = opts.slateDay ?? '2026-10-08';
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${IDEA}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('${SLATE}', '${RUN}', '${madeOn}', now(), 'p1', 'p2');
    INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags)
    VALUES ('${SLATE}', '${IDEA}', 'v1', 'm', 'b', 'f', 'ok', 'A new model shipped today.', 'Follow for more.', ARRAY['#ai']);
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path)
    VALUES ('${VIDEO}', '${IDEA}', '${SLATE}', 'ok', now(), 'videos/x.mp4');
    INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist)
    VALUES ('${VIDEO}', '${IDEA}', 'ok', now(), 'aud-7', 'Song', 'Artist');`);
  if (slateDay !== madeOn) {
    await pg.exec(`INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN2}', 'scheduled', 'ok');
      INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('${NEXT_SLATE}', '${RUN2}', '${slateDay}', now(), 'p1', 'p2')`);
  }
  const onSlate = slateDay !== madeOn ? NEXT_SLATE : SLATE;
  await pg.exec(`INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, components)
                 VALUES ('${onSlate}', '${IDEA}', '${opts.origin ?? 'timely'}', 1, 1, true, '{}'::jsonb)`);
  if (opts.settings !== false) {
    await pg.exec(`INSERT INTO reels.settings (key, value) VALUES ('publishing_live', 'true'::jsonb), ('require_approval', 'false'::jsonb)
                   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  }
}

function stubMeta(opts: { failSign?: boolean } = {}) {
  const meta: MetaClient = {
    async trending() { return []; },
    async downloadPreview() { return { bytes: Buffer.alloc(0), contentType: null }; },
    async createReelContainer() { return 'c-1'; },
    async containerStatus() { return { statusCode: 'FINISHED', status: null }; },
    async publishContainer() { return 'media-1'; },
    async permalink() { return 'https://instagram.com/reel/x'; },
    async publishingLimit() { return { quotaUsage: 3, quotaTotal: 100 }; },
  };
  const signVideo = async (p: string) => {
    if (opts.failSign) throw new Error('Frame sign failed (400): Invalid Compact JWS');
    return `https://signed/${p}`;
  };
  return { meta, signVideo, sleep: async () => undefined };
}

test('require_approval off: a selected reel gets an auto slot in the first open window and posts with no human approval', async () => {
  const pg = await db();
  await seed(pg);
  // 1 AM run: the slot is booked while the video is still being made, so it has no item or approval.
  assert.deepEqual(await scheduleSelectedSlate(SLATE, ONE_AM), { scheduled: 1 });
  const slot = (await pg.query<{ slot: string; ny_date: string; source: string; approved_at: string | null; publish_at: string }>(
    `SELECT slot, ny_date::text AS ny_date, source, approved_at, publish_at FROM social_hub.schedule`,
  )).rows[0]!;
  assert.deepEqual([slot.slot, slot.ny_date, slot.source, slot.approved_at], ['morning', '2026-10-08', 'auto', null]);
  const at = new Date(slot.publish_at).getTime();
  assert.ok(at >= new Date('2026-10-08T12:45:00Z').getTime() && at <= new Date('2026-10-08T14:00:00Z').getTime(), 'inside 8:45-10:00 AM ET');

  await pg.exec(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  assert.equal(await releaseDueSchedules(), 1, 'released without any approval');
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.approvals`)).rows.length, 0, 'no human approval was written');
  const out = await claimAndPublish(stubMeta());
  assert.equal(out?.status, 'published');
  assert.equal((await pg.query<{ status: string }>(`SELECT status FROM social_hub.schedule`)).rows[0]!.status, 'published');
  assert.equal((await pg.query<{ trigger: string }>(`SELECT trigger FROM social_hub.publish_attempts`)).rows[0]!.trigger, 'auto');
});

test('publishing_live off: the nightly run books nothing', async () => {
  const pg = await db();
  await seed(pg, { settings: false });
  assert.deepEqual(await scheduleSelectedSlate(SLATE, ONE_AM), { scheduled: 0 });
});

async function failedSlot(pg: PGlite, failedMinutesBefore: number, overrides: { containerId?: string; error?: string } = {}): Promise<void> {
  await seed(pg);
  await scheduleSelectedSlate(SLATE, ONE_AM);
  await pg.exec(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  await releaseDueSchedules();
  const failed = await claimAndPublish(stubMeta({ failSign: true }));
  assert.equal(failed?.status, 'failed');
  await pg.query(
    `UPDATE social_hub.publish_attempts SET finished_at = $1::timestamptz - ($4::int * interval '1 minute'),
            container_id = $2, error = coalesce($3, error)`,
    [IN_WINDOW.toISOString(), overrides.containerId ?? null, overrides.error ?? null, failedMinutesBefore],
  );
  assert.equal((await pg.query<{ status: string }>(`SELECT status FROM social_hub.schedule`)).rows[0]!.status, 'failed');
}

// The slot is on Oct 8 morning (ends 10:00 AM ET = 14:00Z). "now" values below are inside / after that window.
const IN_WINDOW = new Date('2026-10-08T13:30:00Z');
const AFTER_WINDOW = new Date('2026-10-08T14:30:00Z');

test('one retry: a clean failure reopens its slot after a few minutes while the window is open, then posts', async () => {
  const pg = await db();
  await failedSlot(pg, 5);
  assert.equal(await retryFailedSlots(IN_WINDOW), 1);
  assert.equal((await pg.query<{ status: string; error: string | null }>(`SELECT status, error FROM social_hub.schedule`)).rows[0]!.status, 'scheduled');
  assert.equal(await releaseDueSchedules(), 1, 'the reopened slot is released as a new attempt');
  assert.equal((await claimAndPublish(stubMeta()))?.status, 'published');
  assert.equal((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0]!.n, 2, 'the failed try stays in the history');
});

test('no retry: too soon, window over, already tried twice, reached Instagram, or an unfixable error', async () => {
  const tooSoon = await db();
  await failedSlot(tooSoon, 1);
  assert.equal(await retryFailedSlots(IN_WINDOW), 0, 'too soon');

  const late = await db();
  await failedSlot(late, 5);
  assert.equal(await retryFailedSlots(AFTER_WINDOW), 0, 'window ended');

  const reached = await db();
  await failedSlot(reached, 5, { containerId: 'c-9' });
  assert.equal(await retryFailedSlots(IN_WINDOW), 0, 'a container exists on Instagram: a person checks first');

  const stopped = await db();
  await failedSlot(stopped, 5, { error: 'The worker stopped while this reel was publishing. Check Instagram before approving again.' });
  assert.equal(await retryFailedSlots(IN_WINDOW), 0, 'worker death may have posted');

  const twice = await db();
  await failedSlot(twice, 5);
  await retryFailedSlots(IN_WINDOW);
  await releaseDueSchedules();
  assert.equal((await claimAndPublish(stubMeta({ failSign: true })))?.status, 'failed');
  await twice.query(`UPDATE social_hub.publish_attempts SET finished_at = '2026-10-08T13:00:00Z'`);
  assert.equal(await retryFailedSlots(IN_WINDOW), 0, 'only one retry');
  assert.equal((await twice.query<{ status: string }>(`SELECT status FROM social_hub.schedule`)).rows[0]!.status, 'failed');
});

test('retryableError rules out rejections, caption refusals, gone videos and dead workers', () => {
  assert.equal(retryableError('Frame sign failed (400): Invalid Compact JWS'), true);
  assert.equal(retryableError('Instagram could not process the reel (ERROR): x'), true);
  assert.equal(retryableError('This reel was rejected after its slot opened; nothing was posted.'), false);
  assert.equal(retryableError('The caption still has a dash after repair, so it was not posted.'), false);
  assert.equal(retryableError('The video for this reel is gone.'), false);
});

test('reuse (D55): a carryover idea whose finished video is from an earlier day is reused; a timely pick is built fresh', async () => {
  const carry = await db();
  await seed(carry, { madeOn: '2026-10-07', slateDay: '2026-10-08', origin: 'carryover' });
  assert.deepEqual([...(await reusableVideos(NEXT_SLATE, [IDEA]))], [[IDEA, VIDEO]]);

  const timely = await db();
  await seed(timely, { madeOn: '2026-10-07', slateDay: '2026-10-08', origin: 'timely' });
  assert.equal((await reusableVideos(NEXT_SLATE, [IDEA])).size, 0, 'SH-59: a timely re-win is made fresh');

  const rejected = await db();
  await seed(rejected, { madeOn: '2026-10-07', slateDay: '2026-10-08', origin: 'carryover' });
  await rejected.exec(`
    INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('reels', 'reel', '${VIDEO}', '${IDEA}');
    INSERT INTO social_hub.approvals (content_item_id, decision, via) SELECT id, 'rejected', 'user' FROM social_hub.content_items;`);
  assert.equal((await reusableVideos(NEXT_SLATE, [IDEA])).size, 0, 'a rejected video is never reused');
});

test('require_approval ON: an unapproved auto slot is cancelled at its window; approving first posts it', async () => {
  const nobody = await db();
  await seed(nobody);
  await nobody.exec(`UPDATE reels.settings SET value = 'true'::jsonb WHERE key = 'require_approval'`);
  assert.deepEqual(await scheduleSelectedSlate(SLATE, ONE_AM), { scheduled: 1 });
  await nobody.exec(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  assert.equal(await releaseDueSchedules(), 0);
  const row = (await nobody.query<{ status: string; error: string }>(`SELECT status, error FROM social_hub.schedule`)).rows[0]!;
  assert.deepEqual([row.status, row.error], ['cancelled', 'Nobody approved this reel before its slot, so it was not posted.']);

  const approved = await db();
  await seed(approved);
  await approved.exec(`UPDATE reels.settings SET value = 'true'::jsonb WHERE key = 'require_approval'`);
  await scheduleSelectedSlate(SLATE, ONE_AM);
  // The owner approves at 8:00 AM, before the 8:45 window opens: the booked slot is approved, not rebooked.
  const { schedulePostIdea } = await import('@/lib/reels/publish/schedule');
  const out = await schedulePostIdea(IDEA, 'user', VIDEO, new Date('2026-10-08T12:00:00Z'));
  assert.ok(out.scheduled);
  assert.equal((await approved.query(`SELECT 1 FROM social_hub.schedule WHERE approved_at IS NOT NULL`)).rows.length, 1);
  await approved.exec(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  assert.equal(await releaseDueSchedules(), 1);
  assert.equal((await claimAndPublish(stubMeta()))?.status, 'published');
});
