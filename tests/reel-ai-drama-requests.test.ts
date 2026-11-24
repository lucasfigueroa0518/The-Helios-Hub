import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recordCost } from '@/lib/reel-ai-drama/cost';
import { CANCELLED_TEXT, CancelledByPerson, claimNextJob, finishJob, setStage } from '@/lib/reel-ai-drama/production/jobs';
import {
  cancelDramaJob,
  type DramaRequestRunners,
  latestCalibration,
  queueDramaRequest,
  rejectPitch,
  requestDramaJob,
  retryDramaJob,
  revivePitch,
  runNextDramaRequest,
} from '@/lib/reel-ai-drama/requests';

import { dramaHubDb, finishedJob, pitch, setDrama } from './reel-ai-drama-hub-fixture';

const status = async (db: Awaited<ReturnType<typeof dramaHubDb>>, table: 'pitches' | 'jobs', id: string) =>
  (await db.query<{ status: string }>(`SELECT status FROM reel_ai_drama.${table} WHERE id = $1`, [id])).rows[0]?.status;

test('develop / calibrate clicks queue once, run through stub runners, keep the calibration report', async () => {
  const db = await dramaHubDb();
  const first = await queueDramaRequest(db, 'develop', 'lucas');
  assert.ok(first);
  assert.equal(await queueDramaRequest(db, 'develop', 'lucas'), null, 'one live develop at a time');
  assert.ok(await queueDramaRequest(db, 'calibrate', 'lucas'));

  const runs: string[] = [];
  const runners: DramaRequestRunners = {
    develop: async () => (runs.push('develop'), { pitches: 2 }),
    calibrate: async (d) => {
      runs.push('calibrate');
      await recordCost(d, { mode: 'development', vendor: 'anthropic', component: 'jev', usd: 0.4 });
      return { verdict: 'calibrated' };
    },
  };
  assert.equal((await runNextDramaRequest(db, runners))?.status, 'ok');
  assert.equal((await runNextDramaRequest(db, runners))?.status, 'ok');
  assert.equal(await runNextDramaRequest(db, runners), null);
  assert.deepEqual(runs, ['develop', 'calibrate']);
  const cal = await latestCalibration(db);
  assert.deepEqual(cal?.report, { verdict: 'calibrated' });
  assert.ok(Math.abs((cal?.usd ?? 0) - 0.4) < 1e-9);

  assert.ok(await queueDramaRequest(db, 'develop', 'lucas'), 'a finished request frees the slot');
  const failed = await runNextDramaRequest(db, { ...runners, develop: async () => { throw new Error('no web'); } });
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.error, 'no web');
});

test('reject and revive a pitch; refusals carry a status', async () => {
  const db = await dramaHubDb();
  const id = await pitch(db);
  assert.deepEqual(await rejectPitch(db, id, 'lucas', 'off-brand'), { id, status: 'rejected' });
  const { rows } = await db.query<{ reject_reason: string }>(`SELECT reject_reason FROM reel_ai_drama.pitches WHERE id = $1`, [id]);
  assert.equal(rows[0].reject_reason, 'by lucas: off-brand');
  await assert.rejects(rejectPitch(db, id, 'lucas'), (e: Error & { status?: number }) => e.status === 409 || e.status === 400);
  assert.equal((await revivePitch(db, id)).status, 'pooled');
  assert.equal(await status(db, 'pitches', id), 'pooled');
  await assert.rejects(revivePitch(db, id), /can’t be revived/);
  await assert.rejects(rejectPitch(db, '00000000-0000-4000-8000-000000000000', 'x'), (e: Error & { status?: number }) => e.status === 404);
});

test('cancel: a queued job is killed and its pitch pooled; a running one stops at its next stage', async () => {
  const db = await dramaHubDb();
  const queuedPitch = await pitch(db);
  const queued = await requestDramaJob(db, { pitchId: queuedPitch, by: 'lucas' });
  assert.ok(queued.ok);
  if (!queued.ok) return;
  assert.deepEqual(await cancelDramaJob(db, queued.jobId), { status: 'killed' });
  assert.equal(await status(db, 'pitches', queuedPitch), 'pooled');

  const runningPitch = await pitch(db);
  const running = await requestDramaJob(db, { pitchId: runningPitch, by: 'lucas' });
  assert.ok(running.ok);
  if (!running.ok) return;
  const job = await claimNextJob(db);
  assert.equal(job?.id, running.jobId);
  assert.deepEqual(await cancelDramaJob(db, running.jobId), { status: 'cancel_requested' });
  await assert.rejects(setStage(db, running.jobId, 'writer'), (e: unknown) => e instanceof CancelledByPerson);
  await finishJob(db, running.jobId, { status: 'failed', error: CANCELLED_TEXT });
  assert.equal(await status(db, 'pitches', runningPitch), 'pooled', 'a cancel never retires the pitch');
  await assert.rejects(cancelDramaJob(db, running.jobId), /already finished/);

  // Retry: the failed job runs again under its own id, with the cancel cleared.
  assert.deepEqual(await retryDramaJob(db, running.jobId), { jobId: running.jobId });
  const { rows } = await db.query<{ status: string; cancel_requested_at: string | null }>(`SELECT status, cancel_requested_at FROM reel_ai_drama.jobs WHERE id = $1`, [running.jobId]);
  assert.deepEqual(rows[0], { status: 'queued', cancel_requested_at: null });
  await assert.rejects(retryDramaJob(db, running.jobId), /queued/);
});

test('requestDramaJob: the daily render cap and spend cap refuse; two clicks queue one job', async () => {
  const db = await dramaHubDb();
  const id = await pitch(db);
  const [a, b] = await Promise.all([requestDramaJob(db, { pitchId: id, by: 'x' }), requestDramaJob(db, { pitchId: id, by: 'y' })]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM reel_ai_drama.jobs WHERE pitch_id = $1`, [id]);
  assert.equal(rows[0].n, 1);

  await setDrama(db, 'daily_render_cap', 1);
  assert.deepEqual(await requestDramaJob(db, { pitchId: await pitch(db), by: 'x' }), { ok: false, reason: 'daily_render_cap' });

  const spent = await dramaHubDb();
  const { jobId } = await finishedJob(spent);
  await recordCost(spent, { jobId, mode: 'production', vendor: 'anthropic', component: 'writer', usd: 25 });
  assert.deepEqual(await requestDramaJob(spent, { pitchId: await pitch(spent), by: 'x' }), { ok: false, reason: 'daily_spend_cap' });
  assert.deepEqual(await requestDramaJob(spent, { pitchId: 'nope', by: 'x' }), { ok: false, reason: 'not_found' });
});
