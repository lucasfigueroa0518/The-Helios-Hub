/**
 * Stories M4: the tab's actions on PGlite, and the route guard (no session →
 * 401). Offline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, approve, generate, listView, monthOverview, publishNow, regenerate, reject, setDetail, updateSeries } from '@/lib/stories/api';
import { claimNextRequested, markReady, recordCost, recordFramePublished, recordInsights, saveBuild } from '@/lib/stories/repository';
import { storiesRoute } from '@/lib/stories/route';
import { loadSettings } from '@/lib/stories/settings';

import { harnessDb } from './stories-harness';

const NOW = new Date('2026-10-08T16:00:00Z');

async function readySet() {
  const { db } = await harnessDb();
  const { set } = await generate(db, 'free_vs_paid', 'lucas@x', NOW);
  await claimNextRequested(db);
  await saveBuild(db, set.id, { payload: {}, frames: [{ seq: 1, role: 'intro', backdrop: 'black', copy: { role: 'intro' } }, { seq: 2, role: 'paid', backdrop: 'black', copy: { role: 'paid', tool: 'P', price: '$1', period: 'a month', tease: 't' } }], candidates: [{ origin: 'generated', ref: 'p|f', score: 0.8, chosen: true }] });
  await markReady(db, set.id, false);
  return { db, id: set.id };
}

test('route guard: no session is a 401; ApiError keeps its status', async () => {
  const none = await storiesRoute(async () => ({ ok: true }), { session: async () => null });
  assert.equal(none.status, 401);
  const ok = await storiesRoute(async ({ email }) => ({ email }), { session: async () => ({ email: 'lucas@x' }), db: (await harnessDb()).db });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { email: 'lucas@x' });
  const bad = await storiesRoute(async () => { throw new ApiError(409, 'moved on'); }, { session: async () => ({ email: 'l' }) });
  assert.equal(bad.status, 409);
});

test('Generate: today (New York), one live set per series per day, unknown or disabled series refused', async () => {
  const { db } = await harnessDb();
  const a = await generate(db, 'morning_download', 'lucas@x', NOW);
  assert.equal(a.created, true);
  assert.equal(a.set.ny_date, '2026-10-08');
  assert.equal(a.set.trigger, 'click');
  assert.equal(a.set.style, 'polished');
  assert.equal((await generate(db, 'morning_download', 'lucas@x', NOW)).created, false);
  await assert.rejects(generate(db, 'reels', 'x'), (e: ApiError) => e.status === 400);
  await updateSeries(db, { series: 'guess_the_number', enabled: false }, 'lucas@x');
  await assert.rejects(generate(db, 'guess_the_number', 'x', NOW), (e: ApiError) => e.status === 409);
});

test('Approve, Reject with tags, Regenerate, Publish now', async () => {
  const { db, id } = await readySet();
  const queue = await listView(db, 'queue');
  assert.equal(queue[0]!.frames.length, 2);
  const detail = await setDetail(db, id);
  assert.equal(detail.candidates.length, 1);

  const s = await publishNow(db, id, NOW);
  assert.equal(s.status, 'scheduled');
  assert.equal(new Date(s.publish_at!).toISOString(), NOW.toISOString());
  await assert.rejects(approve(db, id), (e: ApiError) => e.status === 409);

  const r = await reject(db, id, { tags: ['design', 'bogus'], note: 'too busy' }, 'lucas@x');
  assert.equal(r.status, 'rejected');
  assert.deepEqual((await setDetail(db, id)).feedback.map((f) => (f as { tags: string[] }).tags), [['design']]);

  const { db: db2, id: id2 } = await readySet();
  const again = await regenerate(db2, id2, 'lucas@x');
  assert.equal(again.created, true);
  assert.equal(again.set.status, 'requested');
  assert.notEqual(again.set.id, id2);
});

test('Settings: auto needs confirmation; history shows completion and early exits', async () => {
  const { db, id } = await readySet();
  await assert.rejects(updateSeries(db, { series: 'free_vs_paid', auto: true }, 'l'), /needs confirmation/);
  await updateSeries(db, { series: 'free_vs_paid', auto: true, confirm: true }, 'l');
  assert.equal((await loadSettings(db)).series.free_vs_paid.auto, true);

  await db.query(`UPDATE stories.sets SET status = 'published' WHERE id = $1`, [id]);
  const frames = (await db.query<{ id: string }>(`SELECT id FROM stories.frames WHERE set_id = $1 ORDER BY seq`, [id])).rows;
  await recordFramePublished(db, frames[0]!.id, 'm1', NOW);
  await recordFramePublished(db, frames[1]!.id, 'm2', NOW);
  await recordInsights(db, frames[0]!.id, { reach: 200, exits: 12, replies: 2 }, {}, false, NOW);
  await recordInsights(db, frames[1]!.id, { reach: 150, exits: 3 }, {}, false, NOW);
  const [h] = await listView(db, 'history');
  assert.deepEqual(h!.insights, { completion: 0.75, exitsFirst3: 15, replies: 2, reachFirst: 200 });
  await recordCost(db, { setId: id, vendor: 'anthropic', component: 'md-headlines@1', usd: 0.05 });
  const m = await monthOverview(db, NOW);
  assert.equal(m.month, '2026-10');
  assert.equal(m.total, 0.05);
});
