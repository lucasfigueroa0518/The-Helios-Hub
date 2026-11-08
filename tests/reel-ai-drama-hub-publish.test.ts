import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ReelMetaClient } from '@/lib/explainers/publish/meta';
import {
  dramaCaption,
  dramaCarryAttempt,
  dramaFailStaleAttempts,
  dramaQueuePublish,
  hardPublishDramaJob,
  pollDramaInsights,
  setDramaVerdict,
} from '@/lib/reel-ai-drama/hub';
import { claimAndCarryDrama, composeDramaCaption } from '@/lib/reel-ai-drama/publish/publish';
import { afterDramaJob } from '@/lib/reel-ai-drama/requests';

import { dramaHubDb, finishedJob, POST, setDrama } from './reel-ai-drama-hub-fixture';

function stubMeta(calls: string[] = []): ReelMetaClient {
  return {
    async createReel(input) {
      calls.push(`create:${input.shareToFeed}:${input.caption.slice(0, 12)}`);
      return 'container-1';
    },
    async containerStatus() {
      calls.push('status');
      return { statusCode: 'FINISHED', status: null };
    },
    async publishContainer() {
      calls.push('publish');
      return 'media-1';
    },
    async permalink() {
      return 'https://instagram.com/p/x';
    },
    async publishingLimit() {
      return { quotaUsage: 1, quotaTotal: 50 };
    },
  } as ReelMetaClient;
}

const claim = (db: Awaited<ReturnType<typeof dramaHubDb>>, id: string) =>
  db.query(`UPDATE social_hub.publish_attempts SET status = 'creating', started_at = now() WHERE id = $1`, [id]);

test('caption source: the newest post_caption, else composed from post_text; within 2200 characters', async () => {
  const db = await dramaHubDb();
  const { jobId } = await finishedJob(db);
  assert.equal(await dramaCaption(db, jobId), `${POST.caption}\n\n${POST.question}\n\nPhoto: AP\nPhoto: Reuters`);
  await afterDramaJob(db, { id: jobId, trigger: 'click' });
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM reel_ai_drama.artifacts WHERE job_id = $1 AND kind = 'post_caption'`, [jobId]);
  assert.equal(rows[0].n, 1, 'a finished job writes its posting caption');
  await db.query(`INSERT INTO reel_ai_drama.artifacts (job_id, kind, content) VALUES ($1, 'post_caption', 'A revised caption')`, [jobId]);
  assert.equal(await dramaCaption(db, jobId), 'A revised caption');

  const long = composeDramaCaption({ caption: 'x'.repeat(2100), question: 'q?', credits: ['c'.repeat(200), 'short'] })!;
  assert.ok(long.length <= 2200);
  assert.ok(!long.includes('short'), 'credits are trimmed first');
  assert.equal(composeDramaCaption(null), null);
  const { jobId: none } = await finishedJob(db, { post: null });
  assert.equal(await dramaCaption(db, none), null);
});

test('queue readiness: finished, not rejected, approved (or approval off, or force), video in the bucket, a caption', async () => {
  const db = await dramaHubDb();
  const unapproved = await finishedJob(db);
  const notReady = await dramaQueuePublish(db, unapproved.jobId, 'auto');
  assert.equal(notReady.queued, false);
  if (!notReady.queued) assert.match(notReady.note, /approved/);
  await setDramaVerdict(db, unapproved.jobId, 'approved', 'lucas');
  assert.equal((await dramaQueuePublish(db, unapproved.jobId, 'approve')).queued, true);

  const local = await finishedJob(db, { location: 'local' });
  await setDramaVerdict(db, local.jobId, 'approved', 'lucas');
  const l = await dramaQueuePublish(db, local.jobId, 'approve');
  assert.equal(l.queued, false);
  if (!l.queued) assert.match(l.note, /not in Storage/);

  const noCaption = await finishedJob(db, { post: null });
  const c = await dramaQueuePublish(db, noCaption.jobId, 'force');
  assert.equal(c.queued, false);
  if (!c.queued) assert.match(c.note, /caption/);

  const rejected = await finishedJob(db);
  await setDramaVerdict(db, rejected.jobId, 'rejected', 'lucas');
  assert.equal((await dramaQueuePublish(db, rejected.jobId, 'force')).queued, false);

  await setDrama(db, 'require_approval', false);
  assert.equal((await dramaQueuePublish(db, (await finishedJob(db)).jobId, 'auto')).queued, true);
});

test('hard publish refuses while publishing is off, and records nothing', async () => {
  const db = await dramaHubDb();
  const { jobId } = await finishedJob(db);
  const out = await hardPublishDramaJob(db, jobId, 'lucas');
  assert.equal(out.queued, false);
  if (!out.queued) assert.match(out.note, /Publishing is switched off/);
  const { rows } = await db.query(`SELECT 1 FROM reel_ai_drama.feedback WHERE job_id = $1`, [jobId]);
  assert.equal(rows.length, 0);
});

test('carry with a stub Meta client: container, poll, publish, permalink; the slot is marked', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'publishing_live', true);
  const { jobId } = await finishedJob(db);
  const queued = await hardPublishDramaJob(db, jobId, 'lucas');
  assert.ok(queued.queued);
  if (!queued.queued) return;
  await claim(db, queued.id);
  const calls: string[] = [];
  const signed: string[] = [];
  const out = await dramaCarryAttempt({ db, meta: stubMeta(calls), signVideo: async (p) => (signed.push(p), 'https://signed/video.mp4'), sleep: async () => undefined }, queued.id);
  assert.deepEqual(out, { id: queued.id, status: 'published' });
  assert.match(signed[0], /reel-ai-drama\/jobs\/.+\/video\.mp4$/);
  assert.deepEqual(calls, ['create:true:The deal nob', 'status', 'publish']);
  const { rows } = await db.query<{ status: string; media_id: string; permalink: string }>(`SELECT status, media_id, permalink FROM social_hub.publish_attempts WHERE id = $1`, [queued.id]);
  assert.deepEqual(rows[0], { status: 'published', media_id: 'media-1', permalink: 'https://instagram.com/p/x' });
  const again = await dramaQueuePublish(db, jobId, 'force');
  assert.equal(again.queued, false);
  if (!again.queued) assert.equal(again.alreadyPublished, true);
});

test('publisher off: the drama worker claims the oldest AI Drama attempt and carries it; nothing left, null', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'publishing_live', true);
  const { jobId } = await finishedJob(db);
  const queued = await hardPublishDramaJob(db, jobId, 'lucas');
  assert.ok(queued.queued);
  if (!queued.queued) return;
  const calls: string[] = [];
  const deps = { db, meta: stubMeta(calls), signVideo: async () => 'https://signed/video.mp4', sleep: async () => undefined };
  assert.deepEqual(await claimAndCarryDrama(deps), { id: queued.id, status: 'published' });
  assert.equal(await claimAndCarryDrama(deps), null);
});

test('rejected after its slot opened: nothing is posted', async () => {
  const db = await dramaHubDb();
  const { jobId } = await finishedJob(db);
  await setDramaVerdict(db, jobId, 'approved', 'lucas');
  const queued = await dramaQueuePublish(db, jobId, 'approve');
  assert.ok(queued.queued);
  if (!queued.queued) return;
  await setDramaVerdict(db, jobId, 'rejected', 'lucas');
  await claim(db, queued.id);
  const calls: string[] = [];
  const out = await dramaCarryAttempt({ db, meta: stubMeta(calls), signVideo: async () => 'https://signed' }, queued.id);
  assert.equal(out.status, 'failed');
  assert.deepEqual(calls, []);
  const { rows } = await db.query<{ error: string }>(`SELECT error FROM social_hub.publish_attempts WHERE id = $1`, [queued.id]);
  assert.match(rows[0].error, /rejected after its slot opened/);
});

test('stale attempts fail; insights write vertical reel_ai_drama', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'publishing_live', true);
  const { jobId } = await finishedJob(db);
  const q = await hardPublishDramaJob(db, jobId, 'lucas');
  assert.ok(q.queued);
  if (!q.queued) return;
  await db.query(`UPDATE social_hub.publish_attempts SET status = 'processing', started_at = now() - interval '2 hours' WHERE id = $1`, [q.id]);
  await dramaFailStaleAttempts(db);
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM social_hub.publish_attempts WHERE id = $1`, [q.id]);
  assert.equal(rows[0].status, 'failed');

  await db.query(`UPDATE social_hub.publish_attempts SET status = 'published', media_id = 'm-9', finished_at = now() - interval '2 days' WHERE id = $1`, [q.id]);
  const client = { insights: async () => ({ views: 10, reach: 5, likes: 1, comments: 0, saved: 0, shares: 0, total_interactions: 1, ig_reels_avg_watch_time: 1000, ig_reels_video_view_total_time: 9000, reels_skip_rate: 0.3, raw: {} }) };
  const out = await pollDramaInsights(db, client as never, new Date());
  assert.equal(out.written, 1);
  const { rows: ins } = await db.query<{ vertical: string; views: number }>(`SELECT vertical, views FROM social_hub.media_insights WHERE media_id = 'm-9'`);
  assert.equal(ins[0].vertical, 'reel_ai_drama');
});
