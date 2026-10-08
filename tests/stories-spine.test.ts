/**
 * IG Stories projected onto the lifecycle spine (D44). Offline: the real
 * stories and social_hub schema files on PGlite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { claimNextAttempt } from '@/lib/publishing/publisher';
import { approveSet, failSet, markPublished, markPublishing, recordFrameContainer, recordFramePublished, recordInsights, rejectSet, scheduleSet } from '@/lib/stories/repository';
import { accountBusy, projectAllSets } from '@/lib/stories/spine';

import { harnessDb } from './stories-harness';

const SET = '60000000-0000-4000-8000-000000000001';

async function readySet(db: Awaited<ReturnType<typeof harnessDb>>['db'], trigger: 'click' | 'auto' = 'click') {
  await db.query(
    `INSERT INTO stories.sets (id, series, ny_date, status, trigger, style) VALUES ($1, 'guess_the_number', '2026-10-08', 'ready', $2, 'polished')`,
    [SET, trigger],
  );
  for (const seq of [1, 2]) {
    await db.query(
      `INSERT INTO stories.frames (id, set_id, seq, role, backdrop, copy, storage_path) VALUES ($1, $2, $3, 'question', 'black', '{}'::jsonb, $4)`,
      [`60000000-0000-4000-8000-00000000001${seq}`, SET, seq, `sets/${SET}/0${seq}.jpg`],
    );
  }
}

const spine = async (db: Awaited<ReturnType<typeof harnessDb>>['db']) => ({
  item: (await db.query<{ idea_ref: string; format: string }>(`SELECT idea_ref, format FROM social_hub.content_items WHERE vertical = 'stories'`)).rows[0],
  approval: (await db.query<{ decision: string; via: string }>(`SELECT decision, via FROM social_hub.approvals`)).rows[0],
  slot: (await db.query<{ slot: string; status: string }>(`SELECT slot, status FROM social_hub.schedule WHERE vertical = 'stories'`)).rows[0],
  attempt: (await db.query<{ status: string; child_container_ids: string[]; media_id: string | null }>(`SELECT status, child_container_ids, media_id FROM social_hub.publish_attempts WHERE vertical = 'stories'`)).rows[0],
});

test('a set\'s life on the spine: approved, slotted under its series, publishing, then partial when it stops with a frame live', async () => {
  const { db } = await harnessDb();
  await readySet(db);
  assert.equal((await spine(db)).item, undefined, 'a set nobody approved or slotted is not on the spine yet');

  await approveSet(db, SET);
  let s = await spine(db);
  assert.deepEqual([s.item?.idea_ref, s.item?.format], ['guess_the_number:2026-10-08', 'story']);
  assert.deepEqual([s.approval?.decision, s.approval?.via], ['approved', 'user']);

  await scheduleSet(db, SET, new Date('2026-10-08T13:00:00Z'));
  s = await spine(db);
  assert.deepEqual([s.slot?.slot, s.slot?.status], ['guess_the_number', 'scheduled']);
  assert.equal(s.attempt, undefined);

  await markPublishing(db, SET);
  assert.equal((await spine(db)).attempt?.status, 'publishing');
  // Another type's claim waits while the Story set is publishing (one post at a time on the account).
  await db.query(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('carousels', 'feed', 'p1')`);
  await db.query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) SELECT id, 'carousels', 'auto', 'requested', 'c' FROM social_hub.content_items WHERE native_ref = 'p1'`);
  assert.equal(await claimNextAttempt((t, p) => db.query(t, p) as never, ['carousels']), null);

  await recordFrameContainer(db, '60000000-0000-4000-8000-000000000011', 'c1');
  await recordFramePublished(db, '60000000-0000-4000-8000-000000000011', 'm1', new Date('2026-10-08T13:00:30Z'));
  await failSet(db, SET, 'publish: frame 2: Meta returned 500 (1 frame(s) already live)');
  s = await spine(db);
  assert.equal(s.attempt?.status, 'partial', 'frames already live stay live; the set is partial, not a clean failure');
  assert.deepEqual(s.attempt?.child_container_ids, ['c1']);
  assert.equal(s.attempt?.media_id, 'm1');
  assert.equal(s.slot?.status, 'failed');
});

test('a published set and its captures: the day\'s latest per frame, with navigation in extra', async () => {
  const { db } = await harnessDb();
  await readySet(db, 'auto');
  await approveSet(db, SET);
  await scheduleSet(db, SET, new Date('2026-10-08T13:00:00Z'));
  await markPublishing(db, SET);
  await recordFramePublished(db, '60000000-0000-4000-8000-000000000011', 'm1');
  await recordFramePublished(db, '60000000-0000-4000-8000-000000000012', 'm2');
  await markPublished(db, SET);
  assert.equal((await spine(db)).attempt?.status, 'published');
  assert.equal((await spine(db)).approval?.via, 'auto', 'an auto series approving itself');
  await recordInsights(db, '60000000-0000-4000-8000-000000000011', { reach: 100, taps_forward: 7, exits: 2 }, {}, false, new Date('2026-10-08T15:00:00Z'));
  await recordInsights(db, '60000000-0000-4000-8000-000000000011', { reach: 140, taps_forward: 9, exits: 3 }, {}, false, new Date('2026-10-08T17:00:00Z'));
  const rows = (await db.query<{ reach: number; extra: { taps_forward: number; exits: number; final: boolean } }>(
    `SELECT reach, extra FROM social_hub.media_insights WHERE media_id = 'm1'`,
  )).rows;
  assert.equal(rows.length, 1, 'one row per frame per New York day');
  assert.deepEqual([rows[0]!.reach, rows[0]!.extra.taps_forward, rows[0]!.extra.exits, rows[0]!.extra.final], [140, 9, 3, false]);
});

test('a rejected set is rejected on the spine and its slot is cancelled; a set that never reached publishing has no attempt', async () => {
  const { db } = await harnessDb();
  await readySet(db);
  await approveSet(db, SET);
  await scheduleSet(db, SET, new Date('2026-10-08T13:00:00Z'));
  await rejectSet(db, SET, { note: 'off-brand', by: 'lucas' });
  const s = await spine(db);
  assert.equal(s.approval?.decision, 'rejected');
  assert.equal(s.slot?.status, 'cancelled');
  assert.equal(s.attempt, undefined);
});

test('accountBusy: another type mid-publish holds a set back; a stale leftover does not', async () => {
  const { db } = await harnessDb();
  assert.equal(await accountBusy(db), false);
  await db.query(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('explainers', 'reel', 'j1')`);
  await db.query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, started_at) SELECT id, 'explainers', 'auto', 'processing', 'c', now() FROM social_hub.content_items WHERE native_ref = 'j1'`);
  assert.equal(await accountBusy(db), true);
  await db.query(`UPDATE social_hub.publish_attempts SET started_at = now() - interval '45 minutes'`);
  assert.equal(await accountBusy(db), false);
});

test('the backfill projects every set and a second run changes nothing', async () => {
  const { db } = await harnessDb();
  await readySet(db);
  await db.query(`UPDATE stories.sets SET status = 'published', approved_at = now(), publish_at = '2026-10-08T13:00:00Z', published_at = '2026-10-08T13:01:00Z' WHERE id = $1`, [SET]);
  await db.query(`UPDATE stories.frames SET ig_media_id = 'm' || seq, published_at = now() WHERE set_id = $1`, [SET]);
  assert.equal(await projectAllSets(db), 1);
  const count = async () => (await db.query<{ n: string }>(
    `SELECT (SELECT count(*) FROM social_hub.content_items) || '/' || (SELECT count(*) FROM social_hub.schedule) || '/' || (SELECT count(*) FROM social_hub.publish_attempts) AS n`,
  )).rows[0]!.n;
  const first = await count();
  assert.equal(first, '1/1/1');
  await projectAllSets(db);
  assert.equal(await count(), first);
  assert.equal((await spine(db)).attempt?.status, 'published');
});
