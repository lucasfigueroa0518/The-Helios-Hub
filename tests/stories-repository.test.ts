/**
 * Stories M2: schema, repository and settings on PGlite (offline: the real
 * db/stories_schema.sql, no network, no Supabase).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { openLocalStoriesDb, schemaSql } from '@/lib/stories/local-db';
import {
  StaleStatusError,
  approveSet,
  claimNextRequested,
  releaseStaleBuilds,
  dueSets,
  failSet,
  framesDueForInsights,
  getSet,
  listSets,
  markPublished,
  markPublishing,
  markReady,
  monthSpendUsd,
  nyDate,
  recentKeys,
  recordCost,
  recordFrameContainer,
  recordFramePublished,
  recordHistory,
  recordInsights,
  rejectSet,
  requestSet,
  saveBuild,
  saveFrameRender,
  scheduleSet,
} from '@/lib/stories/repository';
import { DEFAULT_SETTINGS, loadSettings, saveSeriesSetting } from '@/lib/stories/settings';
import { FREE_VS_PAID } from '@/lib/stories/render/fixtures/m1';

const FRAMES = FREE_VS_PAID.map((copy, i) => ({ seq: i + 1, role: copy.role, backdrop: 'black' as const, copy, template: 'homemade' }));

async function builtSet() {
  const { db, pg } = await openLocalStoriesDb();
  const { set } = await requestSet(db, { series: 'free_vs_paid', nyDate: '2026-10-10', trigger: 'click', style: 'homemade', requestedBy: 'lucas' });
  const claimed = await claimNextRequested(db);
  assert.equal(claimed?.id, set.id);
  const frames = await saveBuild(db, set.id, { payload: { pair: 'photoshop-gimp' }, frames: FRAMES, candidates: [{ origin: 'catalog', ref: 'gimp', score: 0.9, chosen: true }] });
  return { db, pg, set, frames };
}

test('schema applies, and re-applies cleanly', async () => {
  const { pg } = await openLocalStoriesDb();
  await pg.exec(schemaSql());
  const { rows } = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'stories'`);
  assert.equal(rows[0]!.n, 10);
});

test('nyDate is the New York calendar date', () => {
  assert.equal(nyDate(new Date('2026-10-08T03:30:00Z')), '2026-10-07');
  assert.equal(nyDate(new Date('2026-10-08T05:00:00Z')), '2026-10-08');
});

test('one live set per series per day; a rejected set frees the day', async () => {
  const { db, set } = await builtSet();
  const again = await requestSet(db, { series: 'free_vs_paid', nyDate: '2026-10-10', trigger: 'click', style: 'homemade' });
  assert.equal(again.created, false);
  assert.equal(again.set.id, set.id);
  // Another series the same day is fine.
  assert.equal((await requestSet(db, { series: 'morning_download', nyDate: '2026-10-10', trigger: 'auto', style: 'polished' })).created, true);

  await markReady(db, set.id, false);
  await rejectSet(db, set.id, { tags: ['design'], note: 'too busy', by: 'lucas' });
  const { rows } = await db.query<{ verdict: string; tags: string[] }>(`SELECT verdict, tags FROM stories.feedback WHERE set_id = $1`, [set.id]);
  assert.deepEqual(rows, [{ verdict: 'reject', tags: ['design'] }]);
  assert.equal((await requestSet(db, { series: 'free_vs_paid', nyDate: '2026-10-10', trigger: 'click', style: 'homemade' })).created, true);
});

test('build, review, approve, schedule, publish: each step guards the status it expects', async () => {
  const { db, set, frames } = await builtSet();
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.map((f) => f.role), ['intro', 'paid', 'free']);
  assert.equal(frames[1]!.copy.role, 'paid');

  // A second claim finds nothing: the set is building.
  assert.equal(await claimNextRequested(db), null);
  // Approving before it's ready fails loudly.
  await assert.rejects(approveSet(db, set.id), StaleStatusError);

  await saveFrameRender(db, frames[0]!.id, { storagePath: `sets/${set.id}/01.jpg`, jpegBytes: 300_000, review: { ok: true }, backdrop: 'orange' });
  await markReady(db, set.id, false);
  await approveSet(db, set.id);
  const at = new Date('2026-10-10T23:12:00Z');
  await scheduleSet(db, set.id, at);
  assert.equal((await dueSets(db, new Date('2026-10-10T23:00:00Z'))).length, 0);
  assert.deepEqual((await dueSets(db, new Date('2026-10-10T23:13:00Z'))).map((s) => s.id), [set.id]);

  await markPublishing(db, set.id);
  for (const [i, f] of frames.entries()) {
    await recordFrameContainer(db, f.id, `container-${i}`);
    await recordFramePublished(db, f.id, `media-${i}`, new Date('2026-10-10T23:13:00Z'));
  }
  const done = await markPublished(db, set.id);
  assert.equal(done.status, 'published');

  const got = await getSet(db, set.id);
  assert.equal(got!.frames[0]!.backdrop, 'orange');
  assert.equal(got!.frames[0]!.storage_path, `sets/${set.id}/01.jpg`);
  assert.deepEqual(got!.frames.map((f) => f.ig_media_id), ['media-0', 'media-1', 'media-2']);
  // The review may change settings, never the words.
  assert.deepEqual(got!.frames[0]!.copy, FREE_VS_PAID[0]);
  // A published set can't be failed or re-published.
  await assert.rejects(failSet(db, set.id, 'late'), StaleStatusError);
  assert.equal((await listSets(db, { series: 'free_vs_paid', statuses: ['published'] })).length, 1);
});

test('saveBuild needs a building set and at least one frame', async () => {
  const { db, set } = await builtSet();
  await markReady(db, set.id, true);
  await assert.rejects(saveBuild(db, set.id, { payload: {}, frames: FRAMES, candidates: [] }), StaleStatusError);
  await assert.rejects(saveBuild(db, set.id, { payload: {}, frames: [], candidates: [] }), /at least one frame/);
  assert.equal((await getSet(db, set.id))!.set.flagged, true);
});

test('history: repeat checks look back the right number of days', async () => {
  const { db } = await openLocalStoriesDb();
  await recordHistory(db, 'morning_download', ['newsom-kill-switch', 'newsom-kill-switch', ' '], null);
  await db.query(`UPDATE stories.history SET shown_at = '2026-10-01T12:00:00Z'`);
  await recordHistory(db, 'morning_download', ['crusoe-raise'], null);
  await db.query(`UPDATE stories.history SET shown_at = '2026-10-07T12:00:00Z' WHERE key = 'crusoe-raise'`);
  const now = new Date('2026-10-08T12:00:00Z');
  assert.deepEqual([...(await recentKeys(db, 'morning_download', 3, now))], ['crusoe-raise']);
  assert.deepEqual([...(await recentKeys(db, 'morning_download', 30, now))].sort(), ['crusoe-raise', 'newsom-kill-switch']);
  assert.equal((await recentKeys(db, 'free_vs_paid', 90, now)).size, 0);
});

test('costs add to the set and to the month', async () => {
  const { db, set } = await builtSet();
  await recordCost(db, { setId: set.id, vendor: 'anthropic', component: 'stories-render-review@1', model: 'claude-haiku-5-5', inputTokens: 2000, outputTokens: 300, usd: 0.0091 });
  await recordCost(db, { setId: set.id, vendor: 'jev', component: 'major-news@1', usd: 0.0004 });
  assert.equal((await getSet(db, set.id))!.set.spend_usd, 0.0095);
  assert.ok(Math.abs((await monthSpendUsd(db)) - 0.0095) < 1e-9);
  assert.equal(await monthSpendUsd(db, new Date('2027-01-15T12:00:00Z')), 0);
});

test('insights: poll live frames every 2 hours until a final capture', async () => {
  const { db, frames } = await builtSet();
  const published = new Date('2026-10-10T23:00:00Z');
  await recordFramePublished(db, frames[0]!.id, 'media-a', published);
  await recordFramePublished(db, frames[1]!.id, 'media-b', published);
  const at = (h: number) => new Date(published.getTime() + h * 3600_000);
  assert.equal((await framesDueForInsights(db, { now: at(1) })).length, 2);
  await recordInsights(db, frames[0]!.id, { reach: 120, taps_forward: 80, exits: 6 }, { data: [] }, false, at(1));
  assert.deepEqual((await framesDueForInsights(db, { now: at(2) })).map((f) => f.ig_media_id), ['media-b']);
  assert.equal((await framesDueForInsights(db, { now: at(3.5) })).length, 2);
  await recordInsights(db, frames[0]!.id, { reach: 300 }, {}, true, at(23));
  assert.deepEqual((await framesDueForInsights(db, { now: at(23.2) })).map((f) => f.ig_media_id), ['media-b']);
  // After 24 hours the story is gone; nothing to poll.
  assert.equal((await framesDueForInsights(db, { now: at(25) })).length, 0);
  const { rows } = await db.query<{ reach: number; final: boolean }>(`SELECT reach, final FROM stories.insights WHERE frame_id = $1 ORDER BY captured_at`, [frames[0]!.id]);
  assert.deepEqual(rows, [{ reach: 120, final: false }, { reach: 300, final: true }]);
});

test('a build that died is handed back to requested', async () => {
  const { db, set } = await builtSet();
  await db.query(`UPDATE stories.sets SET claimed_at = now() - interval '2 hours' WHERE id = $1`, [set.id]);
  assert.deepEqual(await releaseStaleBuilds(db), [set.id]);
  assert.equal((await getSet(db, set.id))?.set.status, 'requested');
  assert.deepEqual(await releaseStaleBuilds(db), []);
});

test('settings: defaults, auto off for every series, overrides persist', async () => {
  const { db } = await openLocalStoriesDb();
  const s = await loadSettings(db);
  assert.deepEqual(s, DEFAULT_SETTINGS);
  for (const v of Object.values(s.series)) assert.equal(v.auto, false);
  assert.equal(s.series.guess_the_number.style, 'homemade');
  assert.equal(s.series.morning_download.style, 'polished');
  assert.deepEqual(s.series.free_vs_paid.window.days, [2, 6]);
  assert.equal(s.models.review, 'claude-haiku-5-5');
  const next = await saveSeriesSetting(db, 'guess_the_number', { auto: true }, 'lucas');
  assert.equal(next.series.guess_the_number.auto, true);
  assert.equal(next.series.free_vs_paid.auto, false);
  assert.equal((await loadSettings(db)).series.guess_the_number.window.start, '08:30');
  // Every content type requires approval and ships with publishing off (docs/social-overnight.md).
  assert.equal(s.requireApproval, true);
  assert.equal(s.publishingLive, false);
});
