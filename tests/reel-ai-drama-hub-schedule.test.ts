import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recordCost } from '@/lib/reel-ai-drama/cost';
import {
  dramaItemId,
  dramaReleaseDue,
  runDramaNight,
  scheduleApprovedDrama,
  scheduleDramaJob,
  setDramaVerdict,
} from '@/lib/reel-ai-drama/hub';

import { dramaHubDb, finishedJob, pitch, setDrama } from './reel-ai-drama-hub-fixture';

type Db = Awaited<ReturnType<typeof dramaHubDb>>;
const MONDAY = new Date('2026-11-09T15:00:00Z'); // Monday 10:00 New York
const slotsOf = async (db: Db, jobId: string) =>
  (await db.query<{ slot: string; status: string; ny_date: string; feed_mode: string | null; source: string; error: string | null }>(
    `SELECT s.slot, s.status, s.ny_date::text AS ny_date, s.feed_mode, s.source, s.error FROM social_hub.schedule s
       JOIN social_hub.content_items ci ON ci.id = s.content_item_id WHERE ci.native_ref = $1 ORDER BY s.publish_at`,
    [jobId],
  )).rows;

test('legacy booking: the evening window, one a day; a video only on disk is never booked', async () => {
  const db = await dramaHubDb();
  const { jobId } = await finishedJob(db);
  const booked = await scheduleDramaJob(db, jobId, 'auto', MONDAY);
  assert.equal(booked.scheduled, true);
  if (booked.scheduled) {
    const at = new Date(booked.publishAt).getTime();
    assert.ok(at >= Date.parse('2026-11-10T01:00:00Z') && at <= Date.parse('2026-11-10T01:45:59Z'), booked.publishAt);
  }
  assert.deepEqual((await slotsOf(db, jobId)).map((s) => [s.slot, s.ny_date]), [['evening', '2026-11-09']]);
  assert.deepEqual(await scheduleDramaJob(db, jobId, 'auto', MONDAY), booked, 'a booked reel keeps its slot');

  const { jobId: second } = await finishedJob(db);
  const next = await scheduleDramaJob(db, second, 'auto', MONDAY);
  assert.equal(next.scheduled, true);
  assert.equal((await slotsOf(db, second))[0].ny_date, '2026-11-10', 'one evening slot a day');
  const today = await scheduleDramaJob(db, (await finishedJob(db)).jobId, 'auto', MONDAY, '2026-11-09');
  assert.equal(today.scheduled, false);

  const { jobId: local } = await finishedJob(db, { location: 'local' });
  const refused = await scheduleDramaJob(db, local, 'auto', MONDAY);
  assert.equal(refused.scheduled, false);
  if (!refused.scheduled) assert.match(refused.note, /not in Storage/);
});

test('template booking: the calendar slot and its feed mode', async () => {
  const db = await dramaHubDb();
  await db.query(`INSERT INTO social_hub.settings (key, value) VALUES ('slot_source', '"template"'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await db.query(`INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, feed_mode) VALUES ($1, 'reel_ai_drama', 1200, 'trial')`, [weekday]);
  }
  const { jobId } = await finishedJob(db);
  const booked = await scheduleDramaJob(db, jobId, 'user', MONDAY);
  assert.equal(booked.scheduled, true);
  const [slot] = await slotsOf(db, jobId);
  assert.equal(slot.slot, 't1200');
  assert.equal(slot.feed_mode, 'trial');
  assert.equal(slot.source, 'user');
});

test('scheduleApprovedDrama books approved reels only while live; releaseDue: reject wins, approval gate, else queue', async () => {
  const db = await dramaHubDb();
  const approved = await finishedJob(db);
  const unreviewed = await finishedJob(db);
  const rejected = await finishedJob(db);
  await setDramaVerdict(db, approved.jobId, 'approved', 'lucas');
  assert.equal(await scheduleApprovedDrama(db, MONDAY), 0, 'nothing is booked while publishing is off');
  await setDrama(db, 'publishing_live', true);
  assert.equal(await scheduleApprovedDrama(db, MONDAY), 1);
  // The night's unapproved booking, and a rejected one.
  assert.equal((await scheduleDramaJob(db, unreviewed.jobId, 'auto', MONDAY)).scheduled, true);
  assert.equal((await scheduleDramaJob(db, rejected.jobId, 'auto', MONDAY)).scheduled, true);
  await setDramaVerdict(db, rejected.jobId, 'rejected', 'lucas');
  await db.query(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute' WHERE status = 'scheduled'`);

  assert.equal(await dramaReleaseDue(db), 1);
  assert.equal((await slotsOf(db, approved.jobId))[0].status, 'publishing');
  assert.match((await slotsOf(db, unreviewed.jobId))[0].error ?? '', /Nobody approved/);
  assert.match((await slotsOf(db, rejected.jobId))[0].error ?? '', /rejected/);
  const { rows } = await db.query<{ trigger: string }>(`SELECT trigger FROM social_hub.publish_attempts WHERE vertical = 'reel_ai_drama'`);
  assert.deepEqual(rows.map((r) => r.trigger), ['auto']);
});

test('releaseDue with approval off queues an unreviewed reel', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'publishing_live', true);
  await setDrama(db, 'require_approval', false);
  const { jobId } = await finishedJob(db);
  assert.equal((await scheduleDramaJob(db, jobId, 'auto', MONDAY)).scheduled, true);
  await db.query(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  assert.equal(await dramaReleaseDue(db), 1);
});

test('runDramaNight: off, a request per quota under the caps, once a day', async () => {
  const db = await dramaHubDb();
  assert.deepEqual(await runDramaNight({ db, now: MONDAY }), { status: 'skipped', reason: 'auto_off' });
  await setDrama(db, 'auto', true);
  assert.deepEqual(await runDramaNight({ db, now: MONDAY }), { status: 'skipped', reason: 'pool_empty' });

  const best = await pitch(db, { title: 'Best', rank: 0.9 });
  await pitch(db, { title: 'Second', rank: 0.6 });
  const night = await runDramaNight({ db, now: MONDAY });
  assert.equal(night.status, 'ok');
  if (night.status !== 'ok') return;
  assert.equal(night.quota, 1);
  assert.equal(night.requested.length, 1);
  const { rows } = await db.query<{ pitch_id: string; trigger: string; night_date: string; requested_by: string }>(
    `SELECT pitch_id::text AS pitch_id, trigger, night_date::text AS night_date, requested_by FROM reel_ai_drama.jobs`,
  );
  assert.deepEqual(rows, [{ pitch_id: best, trigger: 'auto', night_date: '2026-11-09', requested_by: 'night' }]);
  assert.deepEqual(await runDramaNight({ db, now: MONDAY }), { status: 'skipped', reason: 'already_ran_today' });
  const { rows: nights } = await db.query<{ status: string }>(`SELECT status FROM reel_ai_drama.nights`);
  assert.deepEqual(nights.map((n) => n.status), ['ok'], 'one row a day; the earlier pool_empty skip gave way');
});

test('runDramaNight honours a pin, archives, the spread rule, and places a surviving render instead of making it again', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'auto', true);
  await setDrama(db, 'publishing_live', true);
  await pitch(db, { title: 'Top', rank: 0.95, player: 'openai' });
  const pinned = await pitch(db, { title: 'Pinned', rank: 0.2 });
  await db.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('reel_ai_drama', $1, '2026-11-09', 'pin')`, [`reel_ai_drama:pitch:${pinned}`]);
  const night = await runDramaNight({ db, now: MONDAY });
  assert.equal(night.status, 'ok');
  const { rows } = await db.query<{ pitch_id: string }>(`SELECT pitch_id::text AS pitch_id FROM reel_ai_drama.jobs`);
  assert.deepEqual(rows.map((r) => r.pitch_id), [pinned]);

  // Next day: an approved, unposted render outranks the pool and is booked, not made again.
  const db2 = await dramaHubDb();
  await setDrama(db2, 'auto', true);
  await setDrama(db2, 'publishing_live', true);
  const survivorPitch = await pitch(db2, { title: 'Survivor', status: 'made', rank: 0.99 });
  const { jobId } = await finishedJob(db2, { pitchId: survivorPitch });
  await setDramaVerdict(db2, jobId, 'approved', 'lucas');
  const archived = await pitch(db2, { title: 'Archived', rank: 0.98 });
  await db2.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('reel_ai_drama', $1, '2026-11-09', 'archive')`, [`reel_ai_drama:pitch:${archived}`]);
  const out = await runDramaNight({ db: db2, now: MONDAY });
  assert.equal(out.status, 'ok');
  if (out.status !== 'ok') return;
  assert.deepEqual(out.requested, []);
  assert.equal(out.allocated[0].jobId, jobId);
  assert.equal(out.allocated[0].scheduled?.scheduled, true);
  assert.ok(await dramaItemId(db2, jobId));

  // Spread: a player made within spread_days is skipped for the pool's next pitch.
  const db3 = await dramaHubDb();
  await setDrama(db3, 'auto', true);
  await finishedJob(db3, { pitchId: await pitch(db3, { status: 'made', player: 'openai' }) });
  await db3.query(`UPDATE reel_ai_drama.pitches SET made_at = now()`);
  await pitch(db3, { title: 'Same player', rank: 0.9, player: 'openai' });
  const other = await pitch(db3, { title: 'Other player', rank: 0.5, player: 'anthropic' });
  const spread = await runDramaNight({ db: db3, now: new Date() });
  assert.equal(spread.status, 'ok');
  const { rows: made } = await db3.query<{ pitch_id: string }>(`SELECT pitch_id::text AS pitch_id FROM reel_ai_drama.jobs WHERE trigger = 'auto'`);
  assert.deepEqual(made.map((r) => r.pitch_id), [other]);
});

test('runDramaNight: quota filled by a person, the daily spend cap, the daily render cap', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'auto', true);
  await pitch(db, { rank: 0.9 });
  const { jobId } = await finishedJob(db);
  const itemId = (await dramaItemId(db, jobId))!;
  await db.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source)
     VALUES ($1, 'reel_ai_drama', '2026-11-09', 'evening', '2026-11-10T01:10:00Z', 'scheduled', 'user')`,
    [itemId],
  );
  assert.deepEqual(await runDramaNight({ db, now: MONDAY }), { status: 'skipped', reason: 'quota_filled' });

  const spent = await dramaHubDb();
  await setDrama(spent, 'auto', true);
  await pitch(spent, { rank: 0.9 });
  const { jobId: paid } = await finishedJob(spent, { title: 'paid' });
  await recordCost(spent, { jobId: paid, mode: 'production', vendor: 'anthropic', component: 'writer', usd: 25 });
  assert.deepEqual(await runDramaNight({ db: spent }), { status: 'skipped', reason: 'daily_spend_cap' });

  const capped = await dramaHubDb();
  await setDrama(capped, 'auto', true);
  await setDrama(capped, 'daily_render_cap', 1);
  await finishedJob(capped);
  await pitch(capped, { rank: 0.9 });
  const night = await runDramaNight({ db: capped });
  assert.equal(night.status, 'ok');
  if (night.status === 'ok') assert.deepEqual(night.requested, [], 'the render cap holds the night');
  const { rows } = await capped.query<{ skip_reason: string | null }>(`SELECT skip_reason FROM reel_ai_drama.nights`);
  assert.equal(rows[0].skip_reason, 'daily_cap');
});
