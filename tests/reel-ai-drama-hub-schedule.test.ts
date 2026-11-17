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

import { PENDING_ITEMS_SQL } from '@/lib/photos/pending';
import { fillDates } from '@/lib/social-hub/lead';
import { ownHeldItem, usedCandidates } from '@/lib/reel-ai-drama/harvest/reuse';
import { afterDramaJob, dramaSpendOn } from '@/lib/reel-ai-drama/requests';

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

test('runDramaNight: off, a request per quota under the caps, once a day; made 2 days ahead (Bald-Eagle D4, D8)', async () => {
  const db = await dramaHubDb();
  assert.deepEqual(await runDramaNight({ db, now: MONDAY }), { status: 'skipped', reason: 'auto_off' });
  await setDrama(db, 'auto', true);
  assert.deepEqual(await runDramaNight({ db, now: MONDAY }), { status: 'skipped', reason: 'pool_empty' });

  // The cutover night (Monday): nothing is filled yet, so it fills every date fillDates names (through Wednesday), one
  // reel each, best pitch first.
  const DATES = fillDates('2026-11-09', 2);
  assert.deepEqual(DATES, ['2026-11-09', '2026-11-10', '2026-11-11'], 'the run day too: an unfilled run day is filled on the cutover');
  const pitches: string[] = [];
  for (let i = 0; i <= DATES.length; i += 1) pitches.push(await pitch(db, { title: `P${i}`, rank: 0.9 - i * 0.1 }));
  const night = await runDramaNight({ db, now: MONDAY });
  assert.equal(night.status, 'ok');
  if (night.status !== 'ok') return;
  assert.equal(night.quota, DATES.length);
  assert.equal(night.requested.length, DATES.length);
  assert.deepEqual(night.dates.map((d) => [d.nyDate, d.status]), DATES.map((d) => [d, 'ok']));
  const jobs = async () => (await db.query<{ pitch_id: string; trigger: string; night_date: string; requested_by: string }>(
    `SELECT pitch_id::text AS pitch_id, trigger, night_date::text AS night_date, requested_by FROM reel_ai_drama.jobs ORDER BY night_date`,
  )).rows;
  assert.deepEqual(await jobs(), DATES.map((d, i) => ({ pitch_id: pitches[i], trigger: 'auto', night_date: d, requested_by: 'night' })), 'each job carries the date it is made for');
  assert.deepEqual(await runDramaNight({ db, now: MONDAY }), { status: 'skipped', reason: 'already_ran_today' });
  const nights = async () => (await db.query<{ d: string; status: string }>(`SELECT ny_date::text AS d, status FROM reel_ai_drama.nights ORDER BY ny_date`)).rows;
  assert.deepEqual(await nights(), DATES.map((d) => ({ d, status: 'ok' })), 'one row a date filled; the earlier pool_empty skips gave way');

  // Steady state (Tuesday): every date up to Wednesday is already filled, so the night makes only Thursday's.
  const TUESDAY = new Date(MONDAY.getTime() + 86_400_000);
  const next = await runDramaNight({ db, now: TUESDAY });
  assert.equal(next.status, 'ok');
  if (next.status !== 'ok') return;
  assert.deepEqual(next.dates.filter((d) => d.status === 'ok').map((d) => d.nyDate), ['2026-11-12']);
  assert.ok(next.dates.every((d) => d.nyDate === '2026-11-12' || (d.status === 'skipped' && d.reason === 'already_ran_today')));
  assert.deepEqual((await jobs()).map((j) => [j.pitch_id, j.night_date]), [...DATES.map((d, i) => [pitches[i], d]), [pitches[DATES.length], '2026-11-12']]);
  assert.deepEqual(await runDramaNight({ db, now: TUESDAY }), { status: 'skipped', reason: 'already_ran_today' }, 'once a night');
});

test('lead time: a night reel books on its target date when it finishes and when approved, never today (Bald-Eagle D4)', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'publishing_live', true);
  // Made Monday night for Wednesday. Monday's and Tuesday's evening windows are open, and it still books Wednesday.
  const { jobId } = await finishedJob(db, { nightDate: '2026-11-11' });
  const booked = await afterDramaJob(db, { id: jobId, trigger: 'auto' }, MONDAY);
  assert.equal(booked.booked?.scheduled, true);
  assert.deepEqual((await slotsOf(db, jobId)).map((s) => [s.ny_date, s.source]), [['2026-11-11', 'auto']]);

  // Approve keeps the target date's slot (approval with today as the bound, as the hub's Approve passes).
  await setDramaVerdict(db, jobId, 'approved', 'lucas');
  assert.deepEqual(await scheduleDramaJob(db, jobId, 'auto', MONDAY, '2026-11-09'), booked.booked, 'a booked reel keeps its slot');

  // Not booked yet (its finish booking found the target taken): Approve books its target date only, never today's leftover.
  const { jobId: other } = await finishedJob(db, { nightDate: '2026-11-11' });
  const refused = await scheduleDramaJob(db, other, 'auto', MONDAY, '2026-11-09');
  assert.equal(refused.scheduled, false, 'Wednesday’s one evening window is taken: nothing, not Monday');
  if (!refused.scheduled) assert.match(refused.note, /2026-11-11/);
  // The worker's booking of approved reels: the target date or later, never before it.
  await setDramaVerdict(db, other, 'approved', 'lucas');
  assert.equal(await scheduleApprovedDrama(db, MONDAY), 1);
  assert.deepEqual((await slotsOf(db, other)).map((s) => s.ny_date), ['2026-11-12']);

  // A person's reel (no target date) books today as before.
  const { jobId: mine } = await finishedJob(db);
  assert.equal((await scheduleDramaJob(db, mine, 'auto', MONDAY, '2026-11-09')).scheduled, true);
  assert.deepEqual((await slotsOf(db, mine)).map((s) => s.ny_date), ['2026-11-09']);
});

test('runDramaNight honours a pin, archives, the spread rule, and places a surviving render instead of making it again', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'auto', true);
  await setDrama(db, 'publishing_live', true);
  const top = await pitch(db, { title: 'Top', rank: 0.95, player: 'openai' });
  const pinned = await pitch(db, { title: 'Pinned', rank: 0.2 });
  await db.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('reel_ai_drama', $1, '2026-11-09', 'pin')`, [`reel_ai_drama:pitch:${pinned}`]);
  const night = await runDramaNight({ db, now: MONDAY });
  assert.equal(night.status, 'ok');
  const DATES = fillDates('2026-11-09', 2);
  const { rows } = await db.query<{ pitch_id: string; night_date: string }>(`SELECT pitch_id::text AS pitch_id, night_date::text AS night_date FROM reel_ai_drama.jobs ORDER BY night_date`);
  assert.deepEqual(rows.map((r) => [r.pitch_id, r.night_date]), [[pinned, DATES[0]], [top, DATES[1]]], 'the pin first, on the first date filled');

  // Next day: an approved, unposted render outranks the pool and is booked on the date filled, not made again.
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
  assert.equal(out.allocated.length, 1, 'placed once, not again for the second date');
  assert.equal(out.allocated[0].jobId, jobId);
  assert.equal(out.allocated[0].scheduled?.scheduled, true);
  assert.deepEqual((await slotsOf(db2, jobId)).map((s) => s.ny_date), [DATES[0]], 'on the first date filled');
  assert.ok(await dramaItemId(db2, jobId));

  // Spread: a player made within spread_days is skipped for the pool's next pitch, on every date the night fills.
  const db3 = await dramaHubDb();
  await setDrama(db3, 'auto', true);
  await finishedJob(db3, { pitchId: await pitch(db3, { status: 'made', player: 'openai' }) });
  await db3.query(`UPDATE reel_ai_drama.pitches SET made_at = now()`);
  await pitch(db3, { title: 'Same player', rank: 0.9, player: 'openai' });
  const other = await pitch(db3, { title: 'Other player', rank: 0.5, player: 'anthropic' });
  await pitch(db3, { title: 'Other player again', rank: 0.4, player: 'anthropic' });
  const spread = await runDramaNight({ db: db3, now: new Date() });
  assert.equal(spread.status, 'ok');
  const { rows: made } = await db3.query<{ pitch_id: string }>(`SELECT pitch_id::text AS pitch_id FROM reel_ai_drama.jobs WHERE trigger = 'auto'`);
  assert.deepEqual(made.map((r) => r.pitch_id), [other], 'tonight’s pick counts for the second date too');
});

test('runDramaNight: quota filled (every booking on the target date), the daily spend cap and render cap by target date', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'auto', true);
  await pitch(db, { rank: 0.9 });
  const book = async (nyDate: string, source: 'auto' | 'user') => {
    const { jobId } = await finishedJob(db);
    const itemId = (await dramaItemId(db, jobId))!;
    await db.query(
      `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source)
       VALUES ($1, 'reel_ai_drama', $2, 'evening', $3, 'scheduled', $4)`,
      [itemId, nyDate, `${nyDate}T23:10:00Z`, source],
    );
  };
  // A system booking fills a date made ahead too (lead time counts every booking), as does a person's.
  for (const [i, d] of fillDates('2026-11-09', 2).entries()) await book(d, i % 2 ? 'user' : 'auto');
  assert.deepEqual(await runDramaNight({ db, now: MONDAY }), { status: 'skipped', reason: 'quota_filled' }, 'a system booking fills a date made ahead too');

  const spent = await dramaHubDb();
  await setDrama(spent, 'auto', true);
  await pitch(spent, { rank: 0.9 });
  const NOW = new Date();
  const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  // Today's spend (a person's click) is today's; the night's dates each spent their cap already.
  const { jobId: click } = await finishedJob(spent, { title: 'click' });
  await recordCost(spent, { jobId: click, mode: 'production', vendor: 'anthropic', component: 'writer', usd: 25 });
  assert.equal(await dramaSpendOn(spent, day(0)), 25);
  assert.equal(await dramaSpendOn(spent, day(2)), 0, 'a click today is not the target date’s spend');
  const FILLED = fillDates(day(0), 2);
  // The run day itself (when fillDates names it) counts the click's 25 already.
  for (const d of FILLED.filter((x) => x !== day(0))) {
    const { jobId: paid } = await finishedJob(spent, { title: `paid ${d}`, nightDate: d });
    await recordCost(spent, { jobId: paid, mode: 'production', vendor: 'anthropic', component: 'writer', usd: 25 });
  }
  assert.equal(await dramaSpendOn(spent, day(2)), 25, 'the night’s spend counts against the date it was made for');
  assert.deepEqual(await runDramaNight({ db: spent, now: NOW }), { status: 'skipped', reason: 'daily_spend_cap' });

  const capped = await dramaHubDb();
  await setDrama(capped, 'auto', true);
  await setDrama(capped, 'daily_render_cap', 1);
  for (const d of FILLED) await finishedJob(capped, { nightDate: d });
  await pitch(capped, { rank: 0.9 });
  const night = await runDramaNight({ db: capped, now: NOW });
  assert.equal(night.status, 'ok');
  if (night.status === 'ok') assert.deepEqual(night.requested, [], 'the render cap of each date holds the night');
  const { rows } = await capped.query<{ skip_reason: string | null }>(`SELECT skip_reason FROM reel_ai_drama.nights ORDER BY ny_date`);
  assert.deepEqual(rows.map((r) => r.skip_reason), FILLED.map(() => 'daily_cap'));
});

test('photo hold (Bald-Eagle D3): a remake is not blocked by its own pitch’s earlier reel; another pitch’s reel still blocks', async () => {
  const db = await dramaHubDb();
  const { jobId: earlier, pitchId } = await finishedJob(db, { nightDate: '2026-11-11' });
  const { rows: [remake] } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.jobs (pitch_id, status, trigger, mode, spend_cap_usd) VALUES ($1, 'running', 'click', 'production', 8) RETURNING id`,
    [pitchId],
  );
  const { jobId: otherJob } = await finishedJob(db);
  assert.deepEqual(await ownHeldItem(db, remake!.id), { vertical: 'reel_ai_drama', id: earlier });
  assert.equal(await ownHeldItem(db, null), null);

  // The hub's ledger, stubbed: nothing published; two reels waiting to post, each holding one photo.
  const waiting = (id: string, url: string) => ({ vertical: 'reel_ai_drama', id, built_at: new Date().toISOString(), doc: { uses: [{ asset_key: url, character_image: false, data: { url, kind: 'photo' } }] } });
  const ledger = {
    async query(text: string) {
      if (text === PENDING_ITEMS_SQL) return { rows: [waiting(earlier, 'https://img.test/own.jpg'), waiting(otherJob, 'https://img.test/other.jpg')] };
      return { rows: [] };
    },
  };
  const cands = [{ url: 'https://img.test/own.jpg' }, { url: 'https://img.test/other.jpg' }];
  const blocked = await usedCandidates(ledger as never, cands, 20, new Date());
  assert.equal(blocked.size, 2, 'without the exclusion the pitch’s own earlier photo blocks the remake');
  const remade = await usedCandidates(ledger as never, cands, 20, new Date(), { excludeItem: await ownHeldItem(db, remake!.id) });
  assert.deepEqual([...remade.keys()].map((c) => c.url), ['https://img.test/other.jpg']);
});
