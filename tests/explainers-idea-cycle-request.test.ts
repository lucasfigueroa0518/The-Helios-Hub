/**
 * "Run the idea cycle now" (planning/AI Mini Docs/HUB-WIRING-CONTRACT.md §7.2): the request row, its
 * 409 rules, and `force`, which bypasses only the auto_render gate. Offline: PGlite, and model stubs
 * that throw if they are ever called.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { IdeaModel } from '@/lib/explainers/ideas/generator';
import { runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import {
  clearIdeaCycleRequest,
  IDEA_CYCLE_REQUEST_KEY,
  ideaCycleStatus,
  pendingIdeaCycleRequest,
  requestIdeaCycle,
} from '@/lib/explainers/ideas/cycle-request';
import { nyDate } from '@/lib/explainers/repository';
import { loadSettings, saveSetting } from '@/lib/explainers/settings';
import type { JevTransport } from '@/lib/reels/jev/runner';

import { scratchExplainersDb } from './explainers-pglite';

const NOW = new Date('2026-11-08T15:00:00Z');
const never = <T,>(name: string) =>
  new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined : () => { throw new Error(`${name}.${String(key)} must not be called`); }) }) as T;
const ideaModel = never<IdeaModel>('ideaModel');
const jevTransport = never<JevTransport>('jevTransport');

test('a request is stored, read back, refused while waiting, and cleared', async () => {
  const { db } = await scratchExplainersDb();
  assert.equal(await pendingIdeaCycleRequest(db), null);
  const first = await requestIdeaCycle(db, 'lucas@example.com', NOW);
  assert.deepEqual(first, { ok: true, request: { at: NOW.toISOString(), by: 'lucas@example.com' } });
  assert.deepEqual(await pendingIdeaCycleRequest(db), { at: NOW.toISOString(), by: 'lucas@example.com' });
  assert.deepEqual(await requestIdeaCycle(db, 'x', NOW), { ok: false, reason: 'already_requested' });
  // the row is not a setting: loadSettings ignores it
  await loadSettings(db);
  const status = await ideaCycleStatus(db, NOW);
  assert.equal(status.requested, true);
  assert.equal(status.ranToday, false);
  await clearIdeaCycleRequest(db);
  assert.equal(await pendingIdeaCycleRequest(db), null);
  assert.equal((await ideaCycleStatus(db, NOW)).requested, false);
});

test('a request left from an earlier New York day is replaced', async () => {
  const { db } = await scratchExplainersDb();
  await requestIdeaCycle(db, 'a', new Date('2026-11-06T15:00:00Z'));
  const again = await requestIdeaCycle(db, 'b', NOW);
  assert.equal(again.ok, true);
  assert.equal((await pendingIdeaCycleRequest(db))?.by, 'b');
});

test('refused once today’s cycle ran; a failed cycle does not count', async () => {
  const { db } = await scratchExplainersDb();
  await db.query(`INSERT INTO explainers.idea_cycles (status, mode, ny_date) VALUES ('failed', 'development', $1::date)`, [nyDate(NOW)]);
  assert.equal((await ideaCycleStatus(db, NOW)).ranToday, false);
  await db.query(`INSERT INTO explainers.idea_cycles (status, mode, ny_date) VALUES ('ok', 'development', $1::date)`, [nyDate(NOW)]);
  assert.equal((await ideaCycleStatus(db, NOW)).ranToday, true);
  assert.deepEqual(await requestIdeaCycle(db, 'x', NOW), { ok: false, reason: 'already_ran' });
  assert.equal(await pendingIdeaCycleRequest(db), null);
});

test('the estimate is the idea pipeline plus daily_render_cap renders at the per-reel cap', async () => {
  const { db } = await scratchExplainersDb();
  const s = await loadSettings(db);
  const fresh = await ideaCycleStatus(db, NOW);
  assert.equal(fresh.maxRenders, s.daily_render_cap);
  assert.equal(fresh.estimateUsd, Math.round((0.25 + s.daily_render_cap * s.per_reel_cap_usd) * 100) / 100);
  await db.query(
    `INSERT INTO explainers.idea_cycles (status, mode, ny_date, generator_cost_usd, scoring_cost_usd, duplicate_check_cost_usd)
     VALUES ('ok', 'development', '2026-11-01', 0.05, 0.03, 0.02)`,
  );
  assert.equal((await ideaCycleStatus(db, NOW)).estimateUsd, Math.round((0.1 + s.daily_render_cap * s.per_reel_cap_usd) * 100) / 100);
});

test('without force, auto_render off still skips (the old behavior)', async () => {
  const { db } = await scratchExplainersDb();
  assert.deepEqual(await runIdeaCycle({ db, ideaModel, jevTransport, now: NOW }), { status: 'skipped', reason: 'auto_render_off' });
});

test('force passes the auto_render gate only: the spend cap still stops it', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'mode', 'production');
  await db.query(`INSERT INTO explainers.cost_events (mode, vendor, component, usd) VALUES ('production', 'anthropic', 'render', 1000)`);
  const result = await runIdeaCycle({ db, ideaModel, jevTransport, force: true });
  assert.deepEqual(result, { status: 'skipped', reason: 'daily_spend_cap' });
});

test('force passes the auto_render gate only: one cycle per day still holds', async () => {
  const { db } = await scratchExplainersDb();
  await db.query(`INSERT INTO explainers.idea_cycles (status, mode, ny_date) VALUES ('ok', 'development', $1::date)`, [nyDate(new Date())]);
  const result = await runIdeaCycle({ db, ideaModel, jevTransport, force: true });
  assert.equal(result.status, 'skipped');
  assert.ok('reason' in result && ['already_ran_today', 'retry_exhausted'].includes(result.reason), JSON.stringify(result));
  assert.equal((await db.query(`SELECT 1 FROM explainers.settings WHERE key = $1`, [IDEA_CYCLE_REQUEST_KEY])).rows.length, 0);
});
