// tests/lfd-run-today.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { lfdRunRoute } from '@/app/api/last-few-days/run/handler';
import type { AllProgress } from '@/lib/content-type/progress';
import { queueManualLfdRun } from '@/lib/lfd/manual';
import { parseRunBody, planFrom, stepsFor, type RunInputs } from '@/lib/social-hub/run-today';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { crumbsFor, safeFrom } from '@/lib/social-hub/views/nav';
import { canMakeCard, inFlightKey, runForCandidate, runningSummary } from '@/lib/social-hub/views/run-for';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const base: RunInputs = {
  today: '2026-10-13',
  reels: { quota: 0, held: 0, missing: [], slateToday: true },
  carousels: { quota: 0, held: 0, missing: [] },
  explainers: { quota: 0, held: 0, missing: [] },
  series: [],
  inFlight: { reelsRun: false, reelsBuilding: [], carouselRun: false, explainerTopics: [] },
  cost: { reelsNight: 2.5, reelBuild: 1, carouselCap: 2, explainerCap: 5, storySet: 0.45 },
};
const due: RunInputs = { ...base, lastFewDays: { due: true, made: false }, cost: { ...base.cost, lfdCap: 1 } };
const lfdStep = (i: RunInputs) => planFrom(i).steps.find((s) => s.vertical === 'last_few_days');

test('Run now makes today’s Last Few Days post on its days, once', () => {
  const s = lfdStep(due)!;
  assert.deepEqual([s.action, s.quota, s.held, s.needed, s.estimateUsd, s.targets], ['lfd_run', 1, 0, 1, 1, []]);
  assert.equal(planFrom(due).anything, true);
  assert.equal(lfdStep({ ...base, lastFewDays: { due: false, made: false } })!.action, 'none');
  assert.match(lfdStep({ ...base, lastFewDays: { due: false, made: false } })!.note, /on its days/);
  assert.match(lfdStep({ ...due, lastFewDays: { due: true, made: true } })!.note, /Today’s post is made/);
  assert.match(lfdStep({ ...due, inFlight: { ...base.inFlight, lfdRun: true } })!.note, /already queued or running/);
  assert.equal(lfdStep(base), undefined, 'no Last Few Days read: no step, and every older plan is unchanged');
});

test('its own button runs only its step', () => {
  assert.deepEqual(stepsFor(planFrom(due), 'last_few_days').map((s) => s.action), ['lfd_run']);
  assert.deepEqual(parseRunBody({ only: 'last_few_days' }), { only: 'last_few_days' });
});

test('a queued Last Few Days run shows on its card, which can be made on its own', () => {
  const runs: AllProgress = {
    carousels: [], stories: [], explainers: [],
    last_few_days: [{ id: 'r1', label: 'Last Few Days run', state: 'queued', stage: null, error: null, topicId: null, requestedAt: '2026-10-13T07:00:00Z', startedAt: null, typicalSeconds: null }],
  };
  const card: QuotaCandidate = { vertical: 'last_few_days', idea: null, post: null, locked: false, rank: null, moved: null };
  assert.equal(runForCandidate(card, runs)?.id, 'r1');
  assert.equal(canMakeCard(card), true);
  assert.deepEqual(runningSummary(runs), ['Last Few Days queued']);
  assert.equal(inFlightKey(runs), 'last_few_days:r1:queued:');
});

test('crumbs and from-links know the type page', () => {
  assert.deepEqual(crumbsFor('/social', '/last-few-days'), [{ label: 'Content', href: '/social' }, { label: 'Last Few Days', href: null }]);
  assert.equal(safeFrom('/social', '/last-few-days'), '/last-few-days');
  assert.deepEqual(crumbsFor('/social', '/carousels').map((c) => c.label), ['Content', 'Carousels']);
});

test('Make Last Few Days now: no session is a 401 and queues nothing', async () => {
  let ran = false;
  const res = await lfdRunRoute({ session: async () => null, run: async () => { ran = true; return { queued: true, note: 'x' }; } });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Unauthorized' });
  assert.equal(ran, false, 'no run without a session');
  const ok = await lfdRunRoute({ session: async () => ({ email: 'tommy@helios.test' }), run: async (email) => ({ queued: true, note: email }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { queued: true, note: 'tommy@helios.test' });
});

test('a second click while a run is queued answers a friendly note, not an error, and queues one row', async () => {
  const { query } = await openHubTestDb();
  const first = await queueManualLfdRun(query);
  assert.equal(first.ok, true);
  const second = await queueManualLfdRun(query);
  assert.deepEqual(second, { ok: false, note: 'A Last Few Days run is already queued or running.' });
  const res = await lfdRunRoute({ session: async () => ({ email: 'tommy@helios.test' }), run: async () => ({ queued: false, note: second.note }) });
  assert.equal(res.status, 200);
  const rows = (await query<{ trigger: string; status: string; cap_usd: number }>(`SELECT trigger, status, cap_usd FROM lfd.runs`)).rows;
  assert.deepEqual(rows.map((r) => [r.trigger, r.status, Number(r.cap_usd)]), [['manual', 'requested', 1]]);
});

test('a run cap that is not a positive number refuses the run before queueing', async () => {
  const { query } = await openHubTestDb();
  await query(`UPDATE lfd.settings SET value = '0'::jsonb WHERE key = 'run_cap_usd'`);
  const out = await queueManualLfdRun(query);
  assert.equal(out.ok, false);
  assert.match(out.note, /run_cap_usd is not a positive number/);
  assert.equal((await query(`SELECT 1 FROM lfd.runs`)).rows.length, 0);
});
