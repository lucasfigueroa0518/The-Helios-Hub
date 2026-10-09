/**
 * Explainer Reels overnight (docs/social-overnight.md): only approved renders
 * whose video is in the bucket are scheduled and published; slots, attempts
 * and insights live on the lifecycle spine (social_hub, D36). Offline: the
 * real schemas on PGlite, a stubbed
 * Meta client, a stubbed bucket.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Queryable } from '@/lib/explainers/db';
import { pollExplainerInsights, type ExplainerInsightsClient } from '@/lib/explainers/publish/insights';
import { explainerItemId } from '@/lib/explainers/publish/items';
import { saveFeedback } from '@/lib/explainers/repository';
import type { ReelMetaClient } from '@/lib/explainers/publish/meta';
import { claimAndPublish, publishReadiness, queuePublish } from '@/lib/explainers/publish/publish';
import { publishingLive, releaseDueSchedules, scheduleApproved } from '@/lib/explainers/publish/schedule';
import { bucketArtifactStore, localArtifactStore } from '@/lib/explainers/storage';

import { scratchExplainersDb } from './explainers-pglite';

async function renderedJob(db: Queryable, opts: { verdict?: 'approved' | 'rejected' | null; location?: 'local' | 'bucket'; caption?: string | null; title?: string } = {}) {
  const { rows: t } = await db.query<{ id: string }>(
    `INSERT INTO explainers.topics (title, origin, status) VALUES ($1, 'manual', 'rendered') RETURNING id`,
    [opts.title ?? 'What is an API?'],
  );
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at)
     VALUES ($1, 'ok', 'click', 'development', 5, 'm', 'm', now()) RETURNING id`,
    [t[0]!.id],
  );
  const jobId = j[0]!.id;
  await db.query(
    `INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', $2, 5000000, $3)`,
    [jobId, `jobs/${jobId}/video.mp4`, opts.location ?? 'bucket'],
  );
  if (opts.caption !== null) {
    await db.query(`INSERT INTO explainers.artifacts (job_id, kind, content) VALUES ($1, 'post_caption', $2)`, [jobId, opts.caption ?? 'AI BRAIN BREAK - EPISODE 1: APIs']);
  }
  if (opts.verdict !== null) {
    // The review page's own write path: it mirrors the verdict onto the spine.
    await saveFeedback(db, { jobId, verdict: opts.verdict ?? 'approved', tags: [] });
  }
  return jobId;
}

function stubMeta(overrides: Partial<ReelMetaClient> = {}) {
  const calls: string[] = [];
  const meta: ReelMetaClient = {
    async createReel(input) { calls.push(`reel ${input.videoUrl} feed=${input.shareToFeed}`); return 'container-1'; },
    async containerStatus() { calls.push('status'); return { statusCode: 'FINISHED', status: null }; },
    async publishContainer(id) { calls.push(`publish ${id}`); return 'media-9'; },
    async permalink() { return 'https://instagram.com/reel/xyz'; },
    async publishingLimit() { return { quotaUsage: 2, quotaTotal: 100 }; },
    ...overrides,
  };
  return { meta, calls };
}

const signVideo = async (key: string) => `https://signed/${key}`;

test('approval gate: unreviewed, rejected, local-only, or captionless renders never publish', async () => {
  const { db } = await scratchExplainersDb();
  const notes = async (jobId: string) => {
    const r = await publishReadiness(db, jobId);
    return r.ok ? 'ok' : r.note;
  };
  assert.match(await notes(await renderedJob(db, { verdict: null, title: 'a' })), /approved/);
  assert.match(await notes(await renderedJob(db, { verdict: 'rejected', title: 'b' })), /rejected/);
  assert.match(await notes(await renderedJob(db, { location: 'local', title: 'c' })), /not in Storage/);
  assert.match(await notes(await renderedJob(db, { caption: null, title: 'd' })), /caption/);
  assert.equal(await notes(await renderedJob(db, { title: 'e' })), 'ok');
});

test('require_approval off: unreviewed renders may go, rejected ones never', async () => {
  const { db } = await scratchExplainersDb();
  await db.query(`UPDATE explainers.settings SET value = 'false'::jsonb WHERE key = 'require_approval'`);
  const unreviewed = await renderedJob(db, { verdict: null, title: 'u' });
  await renderedJob(db, { verdict: 'rejected', title: 'r' });
  assert.equal((await publishReadiness(db, unreviewed)).ok, true);
  assert.equal(await scheduleApproved(db, new Date('2026-10-08T12:00:00Z'), () => 0), 1);
});

test('publishing_live is off by default; approved renders take two windows a day (1:00–2:30, 3:30–5:00 PM)', async () => {
  const { db } = await scratchExplainersDb();
  assert.equal(await publishingLive(db), false);
  await renderedJob(db, { verdict: null, title: 'unreviewed' });
  const first = await renderedJob(db, { title: 'first' });
  const second = await renderedJob(db, { title: 'second' });
  const third = await renderedJob(db, { title: 'third' });
  const now = new Date('2026-10-08T12:00:00Z'); // 8:00 AM EDT
  assert.equal(await scheduleApproved(db, now, () => 0), 3);
  const { rows } = await db.query<{ job_id: string; d: string; slot: string; publish_at: Date }>(
    `SELECT ci.native_ref AS job_id, s.ny_date::text AS d, s.slot, s.publish_at
       FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id ORDER BY s.publish_at`,
  );
  assert.deepEqual(rows.map((r) => [r.job_id, r.d, r.slot]), [
    [first, '2026-10-08', 'afternoon'],
    [second, '2026-10-08', 'late'],
    [third, '2026-10-09', 'afternoon'],
  ]);
  assert.equal(new Date(rows[0]!.publish_at).toISOString(), '2026-10-08T17:00:00.000Z'); // 1:00 PM EDT
  assert.equal(new Date(rows[1]!.publish_at).toISOString(), '2026-10-08T19:30:00.000Z'); // 3:30 PM EDT
  assert.equal(await scheduleApproved(db, now, () => 0), 0, 'already on the clock');
});

test('posts_per_day 1 keeps one window; another type\'s feed post 30 minutes away pushes the minute', async () => {
  const { db } = await scratchExplainersDb();
  await db.query(`INSERT INTO explainers.settings (key, value) VALUES ('posts_per_day', '1'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const a = await renderedJob(db, { title: 'a' });
  const b = await renderedJob(db, { title: 'b' });
  // Own feed post at 1:10 PM EDT on 10-08 (a manual slot): the draw must keep ≥ 30 minutes from it.
  await db.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'explainers', '2026-10-07', 'afternoon', '2026-10-08T17:10:00Z', 'scheduled', 'user')`,
    [await explainerItemId(db, b)],
  );
  assert.equal(await scheduleApproved(db, new Date('2026-10-08T12:00:00Z'), () => 0), 1);
  const row = (await db.query<{ d: string; publish_at: Date }>(
    `SELECT s.ny_date::text AS d, s.publish_at FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id WHERE ci.native_ref = $1`,
    [a],
  )).rows[0]!;
  assert.equal(row.d, '2026-10-08');
  assert.equal(new Date(row.publish_at).toISOString(), '2026-10-08T17:40:00.000Z', 'first minute 30 minutes clear of 1:10 PM');
});

test('end to end: a due slot is released, published as a feed reel, and marked; it cannot post twice', async () => {
  const { db } = await scratchExplainersDb();
  const jobId = await renderedJob(db);
  await scheduleApproved(db, new Date('2026-10-08T12:00:00Z'), () => 0);
  await db.query(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  assert.equal(await releaseDueSchedules(db), 1);
  const { meta, calls } = stubMeta();
  const out = await claimAndPublish({ db, meta, signVideo, sleep: async () => undefined });
  assert.equal(out?.status, 'published');
  assert.equal(calls[0], `reel https://signed/jobs/${jobId}/video.mp4 feed=true`);
  const attempt = (await db.query<{ status: string; media_id: string; caption: string }>(`SELECT status, media_id, caption FROM social_hub.publish_attempts`)).rows[0]!;
  assert.deepEqual([attempt.status, attempt.media_id, attempt.caption], ['published', 'media-9', 'AI BRAIN BREAK - EPISODE 1: APIs']);
  assert.equal((await db.query<{ status: string }>(`SELECT status FROM social_hub.schedule`)).rows[0]!.status, 'published');
  const again = await queuePublish(db, jobId, 'force');
  assert.equal(again.queued, false);
  assert.equal(await scheduleApproved(db, new Date(), () => 0), 0);
});

test('publish: an EXPIRED container and a near-full account quota both fail without posting', async () => {
  const { db } = await scratchExplainersDb();
  await queuePublish(db, await renderedJob(db, { title: 'x' }), 'approve');
  const expired = stubMeta({ async containerStatus() { return { statusCode: 'EXPIRED', status: null }; } });
  assert.equal((await claimAndPublish({ db, meta: expired.meta, signVideo, sleep: async () => undefined }))?.status, 'failed');
  assert.equal(expired.calls.filter((c) => c.startsWith('publish')).length, 0);

  await queuePublish(db, await renderedJob(db, { title: 'y' }), 'approve');
  const full = stubMeta({ async publishingLimit() { return { quotaUsage: 97, quotaTotal: 100 }; } });
  assert.equal((await claimAndPublish({ db, meta: full.meta, signVideo }))?.status, 'failed');
  assert.equal(full.calls.length, 0);
});

test('insights: reel metrics stored with skip rate as a fraction; blanks keep earlier numbers', async () => {
  const { db } = await scratchExplainersDb();
  const jobId = await renderedJob(db);
  await db.query(
    `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, payload, media_id, finished_at)
     VALUES ($1, 'explainers', 'auto', 'published', 'c', '{"video_object": "v"}', 'm1', '2026-10-08T12:00:00Z')`,
    [await explainerItemId(db, jobId)],
  );
  let views: number | null = 900;
  const client: ExplainerInsightsClient = {
    async insights() {
      return { views, reach: 700, likes: 30, comments: 2, saved: 5, shares: 3, total_interactions: 40, ig_reels_avg_watch_time: 12000, ig_reels_video_view_total_time: 9e6, reels_skip_rate: 42, raw: {} };
    },
  };
  assert.equal((await pollExplainerInsights(db, client, new Date('2026-10-08T13:00:00Z'))).written, 1);
  views = null;
  await pollExplainerInsights(db, client, new Date('2026-10-08T14:00:00Z'));
  const row = (await db.query<{ views: number; skip_rate: number; avg_watch_time_ms: number }>(`SELECT views, skip_rate, avg_watch_time_ms FROM social_hub.media_insights`)).rows[0]!;
  assert.deepEqual([row.views, row.skip_rate, row.avg_watch_time_ms], [900, 0.42, 12000]);
});

test('bucket store: keeps the local copy and uploads the same key with its content type', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expl-store-'));
  const src = path.join(dir, 'video.mp4');
  fs.writeFileSync(src, 'mp4 bytes');
  const uploads: string[] = [];
  const store = bucketArtifactStore(localArtifactStore(path.join(dir, 'root')), {
    async upload(key, body, type) { uploads.push(`${key} ${type} ${body.length}`); },
    async sign(key) { return key; },
  });
  const out = await store.put('jobs/j1/video.mp4', src);
  assert.equal(out.location, 'bucket');
  assert.deepEqual(uploads, ['jobs/j1/video.mp4 video/mp4 9']);
  assert.ok(store.localPath('jobs/j1/video.mp4'));
});

test('a rejection in the review wins even when the spine still says approved (a failed mirror write, D41)', async () => {
  const { db } = await scratchExplainersDb();
  const jobId = await renderedJob(db, { title: 'mirror' });
  assert.equal((await publishReadiness(db, jobId)).ok, true);
  // The review page saved "rejected" but the spine sync never ran.
  await db.query(`UPDATE explainers.feedback SET verdict = 'rejected' WHERE job_id = $1`, [jobId]);
  const ready = await publishReadiness(db, jobId);
  assert.equal(ready.ok, false);
  assert.match((ready as { note: string }).note, /rejected/);
  assert.equal(await scheduleApproved(db, new Date('2026-10-08T12:00:00Z'), () => 0), 0);
});
