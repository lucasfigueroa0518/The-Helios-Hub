/**
 * Regenerate on an approved or scheduled explainer (idea pool standard, 2026-10-21), offline on PGlite with the
 * real schemas: the new render is queued, and the version it replaces is unscheduled and no longer approved, so
 * nothing posts what was not reviewed after the regenerate. A cap refusal changes nothing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExplainersDb, Queryable } from '@/lib/explainers/db';
import { explainerActions } from '@/lib/publishing/actions/explainers';
import { requestRerender, saveFeedback } from '@/lib/explainers/repository';
import { scheduleApproved, unscheduleJob } from '@/lib/explainers/publish/schedule';
import { loadSettings, saveSetting } from '@/lib/explainers/settings';

import { scratchExplainersDb } from './explainers-pglite';

async function approvedScheduled(db: Queryable) {
  const { rows: t } = await db.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status) VALUES ('What is an API?', 'manual', 'rendered') RETURNING id`);
  const topicId = t[0]!.id;
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at) VALUES ($1, 'ok', 'click', 'development', 5, 'm', 'm', now()) RETURNING id`,
    [topicId],
  );
  const jobId = j[0]!.id;
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', 'v.mp4', 5000000, 'bucket')`, [jobId]);
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, content) VALUES ($1, 'post_caption', 'caption')`, [jobId]);
  await saveFeedback(db, { jobId, verdict: 'approved', tags: [] });
  await db.query(`INSERT INTO explainers.settings (key, value) VALUES ('publishing_live', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await scheduleApproved(db, new Date('2026-10-08T12:00:00Z'), () => 0);
  return { topicId, jobId };
}

const actionsOn = (db: ExplainersDb) =>
  explainerActions({
    db: async () => db,
    loadSettings: async (d: ExplainersDb) => loadSettings(d),
    requestRerender: requestRerender as never,
    unscheduleJob,
    latestJobId: async (d: ExplainersDb, topicId: string) => (await d.query<{ id: string }>(`SELECT id::text AS id FROM explainers.jobs WHERE topic_id = $1 AND status = 'ok' ORDER BY finished_at DESC NULLS LAST, seq DESC LIMIT 1`, [topicId])).rows[0]?.id ?? null,
  } as unknown as Parameters<typeof explainerActions>[0]);

const state = async (db: ExplainersDb, jobId: string) => ({
  approved: (await db.query(`SELECT 1 FROM explainers.feedback WHERE job_id = $1 AND verdict = 'approved'`, [jobId])).rows.length > 0,
  scheduled: (await db.query(`SELECT 1 FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id WHERE ci.native_ref = $1 AND s.status = 'scheduled'`, [jobId])).rows.length > 0,
});

test('Regenerate queues a new render and takes the old version off the calendar and out of approval', async () => {
  const { db } = await scratchExplainersDb();
  const { topicId, jobId } = await approvedScheduled(db);
  assert.deepEqual(await state(db, jobId), { approved: true, scheduled: true });
  const out = await actionsOn(db).regenerate!({ topicId }, 'tommy');
  assert.equal(out.ok, true);
  assert.match(out.note, /unscheduled and no longer approved/);
  assert.deepEqual(await state(db, jobId), { approved: false, scheduled: false });
  const jobs = await db.query<{ status: string }>(`SELECT status FROM explainers.jobs WHERE topic_id = $1 ORDER BY seq`, [topicId]);
  assert.deepEqual(jobs.rows.map((r) => r.status), ['ok', 'requested']);
});

test('a refused Regenerate (daily cap) leaves the approval and the slot alone', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'mode', 'production');
  const { topicId, jobId } = await approvedScheduled(db);
  await saveSetting(db, 'daily_render_cap', 0);
  const out = await actionsOn(db).regenerate!({ topicId }, 'tommy');
  assert.equal(out.ok, false);
  assert.deepEqual(await state(db, jobId), { approved: true, scheduled: true });
});
