import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dramaItemId,
  dramaVerdictOf,
  hardPublishDramaJob,
  latestDramaJobId,
  scheduleDramaJob,
  setDramaVerdict,
  unscheduleDramaJob,
} from '@/lib/reel-ai-drama/hub';

import { dramaHubDb, finishedJob, setDrama } from './reel-ai-drama-hub-fixture';

const decision = async (db: Awaited<ReturnType<typeof dramaHubDb>>, itemId: string) =>
  (await db.query<{ decision: string; via: string }>(`SELECT decision, via FROM social_hub.approvals WHERE content_item_id = $1`, [itemId])).rows[0] ?? null;

test('identity: one spine item per job (vertical reel_ai_drama, format reel, idea_ref = pitch)', async () => {
  const db = await dramaHubDb();
  const { jobId, pitchId } = await finishedJob(db);
  const a = await dramaItemId(db, jobId);
  const b = await dramaItemId(db, jobId.toUpperCase());
  assert.ok(a);
  assert.equal(a, b, 'native_ref is the database id, never the caller spelling');
  const { rows } = await db.query(`SELECT vertical, format, idea_ref FROM social_hub.content_items WHERE id = $1`, [a]);
  assert.deepEqual(rows[0], { vertical: 'reel_ai_drama', format: 'reel', idea_ref: pitchId });
  assert.equal(await dramaItemId(db, '00000000-0000-4000-8000-000000000000'), null);
  assert.equal(await dramaItemId(db, 'not-a-uuid'), null);
  assert.equal(await latestDramaJobId(db, pitchId), jobId);
});

test('verdicts: tags and note kept, unknown tag is a 400, spine mirrors approve / reject', async () => {
  const db = await dramaHubDb();
  const { jobId } = await finishedJob(db);
  await setDramaVerdict(db, jobId, 'approved', 'lucas', { tags: ['hook', 'sound'], note: 'Great open' });
  assert.equal(await dramaVerdictOf(db, jobId), 'approved');
  const itemId = (await dramaItemId(db, jobId))!;
  assert.equal((await decision(db, itemId))?.decision, 'approved');

  // No review given: the earlier tags and note stay.
  await setDramaVerdict(db, jobId, 'rejected', 'lucas');
  const { rows } = await db.query<{ tags: string[]; note: string }>(`SELECT tags, note FROM reel_ai_drama.feedback WHERE job_id = $1`, [jobId]);
  assert.deepEqual(rows[0], { tags: ['hook', 'sound'], note: 'Great open' });
  assert.equal((await decision(db, itemId))?.decision, 'rejected');

  await assert.rejects(setDramaVerdict(db, jobId, 'approved', 'lucas', { tags: ['nope'] }), (e: Error & { status?: number }) => e.status === 400);
  await assert.rejects(setDramaVerdict(db, '00000000-0000-4000-8000-000000000000', 'approved', 'x'), (e: Error & { status?: number }) => e.status === 404);
  assert.equal(await dramaVerdictOf(db, jobId), 'rejected', 'the refused call changed nothing');
});

test('hard publish: a click is approval (force), a rejection is terminal, the waiting slot is cancelled', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'publishing_live', true);
  const { jobId } = await finishedJob(db);
  const booked = await scheduleDramaJob(db, jobId, 'auto', new Date('2026-11-09T15:00:00Z'));
  assert.equal(booked.scheduled, true);

  const out = await hardPublishDramaJob(db, jobId, 'lucas');
  assert.equal(out.queued, true);
  const itemId = (await dramaItemId(db, jobId))!;
  assert.deepEqual(await decision(db, itemId), { decision: 'approved', via: 'force' });
  const { rows: slots } = await db.query<{ status: string }>(`SELECT status FROM social_hub.schedule WHERE content_item_id = $1`, [itemId]);
  assert.deepEqual(slots.map((s) => s.status), ['cancelled']);
  const { rows: attempts } = await db.query<{ trigger: string; caption: string; payload: { video_object: string; share_to_feed?: boolean } }>(
    `SELECT trigger, caption, payload FROM social_hub.publish_attempts WHERE content_item_id = $1`,
    [itemId],
  );
  assert.equal(attempts[0].trigger, 'force');
  assert.match(attempts[0].payload.video_object, /video\.mp4$/);
  assert.equal(attempts[0].payload.share_to_feed, true);

  const { jobId: rejected } = await finishedJob(db);
  await setDramaVerdict(db, rejected, 'rejected', 'lucas');
  const refused = await hardPublishDramaJob(db, rejected, 'lucas');
  assert.equal(refused.queued, false);
  if (!refused.queued) assert.equal(refused.terminal, true);
});

test('unschedule: slot cancelled, approval withdrawn; refused while posting', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'publishing_live', true);
  const { jobId } = await finishedJob(db);
  await setDramaVerdict(db, jobId, 'approved', 'lucas');
  assert.equal((await scheduleDramaJob(db, jobId, 'user', new Date('2026-11-09T15:00:00Z'))).scheduled, true);
  const out = await unscheduleDramaJob(db, jobId);
  assert.equal(out.ok, true);
  assert.match(out.note, /not approved any more/);
  assert.equal(await dramaVerdictOf(db, jobId), null);
  assert.equal(await decision(db, (await dramaItemId(db, jobId))!), null);

  const { jobId: posting } = await finishedJob(db);
  assert.equal((await hardPublishDramaJob(db, posting, 'lucas')).queued, true);
  const busy = await unscheduleDramaJob(db, posting);
  assert.equal(busy.ok, false);
  assert.equal((await unscheduleDramaJob(db, '00000000-0000-4000-8000-000000000000')).ok, false);
});
