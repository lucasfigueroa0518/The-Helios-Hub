/**
 * Generate, Run now and the pool controls for AI Events (plan M4): the plan step, its own button,
 * progress on its card, the type page's crumbs, and the two session-gated routes (run, pool).
 * Offline: the routes take their session and actions injected; nothing runs a pipeline.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { aiEventsPoolRoute, parsePoolBody, type PoolAction } from '@/app/api/ai-events/pool/handler';
import { aiEventsRunRoute } from '@/app/api/ai-events/run/handler';
import { queueManualAiEventsRun } from '@/lib/ai-events/manual';
import { clearPoolEvent, excludePoolEvent, pinPoolEvent, queueRebuild } from '@/lib/ai-events/pool';
import type { AllProgress } from '@/lib/content-type/progress';
import { aiEventsDueToday, parseRunBody, planFrom, stepsFor, type RunInputs } from '@/lib/social-hub/run-today';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { crumbsFor, safeFrom } from '@/lib/social-hub/views/nav';
import { canMakeCard, inFlightKey, runForCandidate, runningSummary } from '@/lib/social-hub/views/run-for';

import { addEvent, openAiEventsDb, SUN_NOON, WEEK } from './fixtures/ai-events/seed';

const base: RunInputs = {
  today: '2026-10-25',
  reels: { quota: 0, held: 0, missing: [], slateToday: true },
  carousels: { quota: 0, held: 0, missing: [] },
  explainers: { quota: 0, held: 0, missing: [] },
  series: [],
  inFlight: { reelsRun: false, reelsBuilding: [], carouselRun: false, explainerTopics: [] },
  cost: { reelsNight: 2.5, reelBuild: 1, carouselCap: 2, explainerCap: 5, storySet: 0.45 },
};
const due: RunInputs = { ...base, aiEvents: { due: true, made: false }, cost: { ...base.cost, aiEventsCap: 0.5 } };
const aeStep = (i: RunInputs) => planFrom(i).steps.find((s) => s.vertical === 'ai_events');

test('Run now makes the coming week’s AI Events post on its day, once', () => {
  const s = aeStep(due)!;
  assert.deepEqual([s.action, s.quota, s.held, s.needed, s.estimateUsd, s.targets, s.label], ['ai_events_run', 1, 0, 1, 0.5, [], 'AI Events This Week']);
  assert.match(s.note, /Miami, Boston, NYC and SF/);
  assert.equal(planFrom(due).anything, true);
  const off = aeStep({ ...base, aiEvents: { due: false, made: false } })!;
  assert.equal(off.action, 'none');
  assert.match(off.note, /posts on Sundays/);
  assert.match(aeStep({ ...due, aiEvents: { due: true, made: true } })!.note, /The coming week’s post is made/);
  assert.match(aeStep({ ...due, inFlight: { ...base.inFlight, aiEventsRun: true } })!.note, /already queued or running/);
  assert.equal(aeStep(base), undefined, 'no AI Events read: no step, and every older plan is unchanged');
});

test('its own Generate runs only its step', () => {
  assert.deepEqual(stepsFor(planFrom(due), 'ai_events').map((s) => s.action), ['ai_events_run']);
  assert.deepEqual(parseRunBody({ only: 'ai_events' }), { only: 'ai_events' });
});

test('AI Events due today: legacy by its own days; template by the calendar’s AI Events slot', () => {
  const on = { autoRun: true, days: [0] };
  const off = { autoRun: false, days: [0] };
  const SUN = '2026-10-25';
  const MON = '2026-10-26';
  assert.equal(aiEventsDueToday(on, SUN, false, null), true);
  assert.equal(aiEventsDueToday(on, MON, false, null), false);
  assert.equal(aiEventsDueToday(off, SUN, false, null), false);
  assert.equal(aiEventsDueToday(off, MON, true, null), true, 'its own Generate: any day');
  assert.equal(aiEventsDueToday(on, MON, false, true), true, 'an AI Events slot on a Monday');
  assert.equal(aiEventsDueToday(on, SUN, false, false), false, 'no slot on its own weekday');
  assert.equal(aiEventsDueToday(off, MON, false, true), false, 'paused');
  const live = fs.readFileSync(path.join(process.cwd(), 'lib/content-type/run-today-live.ts'), 'utf8');
  assert.match(live, /aiEventsDueToday\(s, today, anyDay, plan \? isAiEventsDay\(plan, today\) : null\)/);
  assert.match(live, /queueManualAiEventsRun\(liveHubQuery, by\)/);
});

test('a queued AI Events run shows on its card, which can be made on its own', () => {
  const runs: AllProgress = {
    carousels: [], stories: [], explainers: [],
    ai_events: [{ id: 'r1', label: 'AI Events run', state: 'running', stage: null, error: null, topicId: null, requestedAt: '2026-10-25T16:00:00Z', startedAt: '2026-10-25T16:00:05Z', typicalSeconds: null }],
  };
  const card: QuotaCandidate = { vertical: 'ai_events', idea: null, post: null, locked: false, rank: null, moved: null };
  assert.equal(runForCandidate(card, runs)?.id, 'r1');
  assert.equal(canMakeCard(card), true);
  assert.deepEqual(runningSummary(runs), ['AI Events running']);
  assert.equal(inFlightKey(runs), 'ai_events:r1:running:');
});

test('crumbs and from-links know the type page', () => {
  assert.deepEqual(crumbsFor('/social', '/ai-events'), [{ label: 'Content', href: '/social' }, { label: 'AI Events This Week', href: null }]);
  assert.equal(safeFrom('/social', '/ai-events'), '/ai-events');
  assert.equal(safeFrom('/social', '/ai_events'), null, 'the vertical id is not a page');
  // The type page opens a post with its href, so the back link survives safeFrom (vertical.md §7).
  assert.match(fs.readFileSync('components/content-type/TypeHub.tsx', 'utf8'), /fromPath=\{info\.href\}/);
});

test('Generate: no session is a 401 and queues nothing; the route runs only its own type', async () => {
  let ran = false;
  const res = await aiEventsRunRoute({ session: async () => null, run: async () => { ran = true; return { queued: true, note: 'x' }; } });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Unauthorized' });
  assert.equal(ran, false);
  const ok = await aiEventsRunRoute({ session: async () => ({ email: 'tommy@helios.test' }), run: async (email) => ({ queued: true, note: email }) });
  assert.deepEqual([ok.status, await ok.json()], [200, { queued: true, note: 'tommy@helios.test' }]);
  assert.match(fs.readFileSync('app/api/ai-events/run/route.ts', 'utf8'), /runType\(email, 'ai_events'\)/);
});

test('a second Generate while a run is queued answers a friendly note and queues one row at the cap', async () => {
  const { query } = await openAiEventsDb();
  assert.equal((await queueManualAiEventsRun(query, 'tommy@helios.test')).ok, true);
  assert.deepEqual(await queueManualAiEventsRun(query), { ok: false, note: 'An AI Events run is already queued or running.' });
  const rows = (await query<{ trigger: string; kind: string; status: string; cap_usd: number; requested_by: string }>(`SELECT trigger, kind, status, cap_usd, requested_by FROM ai_events.runs`)).rows;
  assert.deepEqual(rows.map((r) => [r.trigger, r.kind, r.status, Number(r.cap_usd), r.requested_by]), [['manual', 'build', 'requested', 0.5, 'tommy@helios.test']]);
});

test('the pool body: pin, exclude and clear name one event; rebuild names none', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(parsePoolBody({ action: 'pin', eventId: id }), { action: 'pin', eventId: id });
  assert.deepEqual(parsePoolBody({ action: 'exclude', eventId: id.toUpperCase() }), { action: 'exclude', eventId: id });
  assert.deepEqual(parsePoolBody({ action: 'rebuild' }), { action: 'rebuild', eventId: null });
  for (const bad of [null, {}, { action: 'pin' }, { action: 'pin', eventId: 'x' }, { action: 'promote', eventId: id }, { action: 'rebuild', eventId: id }]) assert.equal(parsePoolBody(bad), null, JSON.stringify(bad));
});

test('the pool route: 401 without a session, 400 on a bad body, 409 on a refusal, before or instead of any write', async () => {
  const calls: Array<[PoolAction, string, string | null]> = [];
  const act = async (a: PoolAction, email: string, id: string | null) => { calls.push([a, email, id]); return a === 'clear' ? { ok: false, note: 'That event is not in this week’s pool.' } : { ok: true, note: 'done' }; };
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal((await aiEventsPoolRoute({ session: async () => null, act }, { action: 'pin', eventId: id })).status, 401);
  assert.equal((await aiEventsPoolRoute({ session: async () => ({ email: 't@h' }), act }, { action: 'pin' })).status, 400);
  assert.deepEqual(calls, []);
  const ok = await aiEventsPoolRoute({ session: async () => ({ email: 't@h' }), act }, { action: 'pin', eventId: id });
  assert.deepEqual([ok.status, await ok.json()], [200, { ok: true, note: 'done' }]);
  const refused = await aiEventsPoolRoute({ session: async () => ({ email: 't@h' }), act }, { action: 'clear', eventId: id });
  assert.equal(refused.status, 409);
  assert.deepEqual(calls, [['pin', 't@h', id], ['clear', 't@h', id]]);
});

test('the pool actions on PGlite: pin, exclude (the newer click wins), clear, and Rebuild post for the coming week', async () => {
  const { query } = await openAiEventsDb();
  const ev = await addEvent(query, { title: 'Boston AI Night', startAt: '2026-10-27T22:30:00Z' });
  assert.equal((await pinPoolEvent(query, ev, 'a@h', SUN_NOON)).ok, true);
  const row = async () => (await query<{ week_key: string; pinned_by: string | null; excluded_by: string | null }>(`SELECT week_key, pinned_by, excluded_by FROM ai_events.pool WHERE event_id = $1`, [ev])).rows[0]!;
  assert.deepEqual(await row(), { week_key: WEEK, pinned_by: 'a@h', excluded_by: null });
  await excludePoolEvent(query, ev, 'b@h', SUN_NOON);
  assert.deepEqual(await row(), { week_key: WEEK, pinned_by: null, excluded_by: 'b@h' });
  assert.equal((await clearPoolEvent(query, ev, SUN_NOON)).ok, true);
  assert.deepEqual(await row(), { week_key: WEEK, pinned_by: null, excluded_by: null });
  // An id that is no kept event in the four cities is refused, and nothing is written.
  assert.equal((await pinPoolEvent(query, '00000000-0000-4000-8000-000000000000', 'a@h', SUN_NOON)).ok, false);
  assert.equal((await query(`SELECT 1 FROM ai_events.pool`)).rows.length, 1);
  const rebuild = await queueRebuild(query, 'a@h', SUN_NOON);
  assert.equal(rebuild.ok, true);
  assert.deepEqual((await query<{ kind: string; week_key: string }>(`SELECT kind, week_key FROM ai_events.runs`)).rows, [{ kind: 'rebuild', week_key: WEEK }]);
});

test('the pool buttons are a hub control that only calls its own routes', () => {
  const scope = fs.readFileSync('tests/social-hub-scope.test.ts', 'utf8');
  assert.match(scope, /'components\/content-type\/AiEventsPoolButtons\.tsx'/);
  assert.match(scope, /ai-events\\\/pool/);
  const text = fs.readFileSync('components/content-type/AiEventsPoolButtons.tsx', 'utf8');
  assert.deepEqual([...new Set([...text.matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]))].sort(), ['/api/ai-events/pool', '/api/content-type/progress']);
});
