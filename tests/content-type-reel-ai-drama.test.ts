/**
 * The AI Drama Reels type page plumbing (HUB-WIRING-CONTRACT §6): posting read/write through the drama
 * handle, the run-today `drama_jobs` plan and its narrowing to one card, progress, and "run didn't
 * finish". Offline: the drama handle is a PGlite database put in the explainers connection cache, and the
 * account database is unset, so nothing can reach a remote host.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { readDramaPosting } from '@/lib/reel-ai-drama/hub';
import { writePosting } from '@/lib/content-type/posting';
import { readProgress } from '@/lib/content-type/progress';
import { readRunMisses } from '@/lib/content-type/run-misses';
import { narrowStep, planFrom, stepsFor, type RunInputs } from '@/lib/social-hub/run-today';
import { nyDateOf } from '@/lib/social-hub/time';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const PITCH = '11111111-1111-4111-8111-111111111111';
const PITCH_2 = '22222222-2222-4222-8222-222222222222';

const schemaSql = (file: string) =>
  readFileSync(path.join(process.cwd(), 'db', file), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');

const env = { ...process.env };
let pg: Awaited<ReturnType<typeof openHubTestDb>>['pg'];
let query: Awaited<ReturnType<typeof openHubTestDb>>['query'];

test.before(async () => {
  ({ pg, query } = await openHubTestDb());
  await pg.exec(schemaSql('reel_ai_drama_schema.sql'));
  // The account database is unset (every read of it fails fast); the drama handle is this PGlite.
  process.env.DATABASE_URL = '';
  process.env.DIRECT_DATABASE_URL = '';
  process.env.EXPLAINERS_DATABASE_URL = 'postgres://offline.invalid/test';
  const db = { query: async (text: string, params?: unknown[]) => ({ rows: (await pg.query(text, params)).rows }) };
  (globalThis as { __explainersDb?: Promise<unknown> }).__explainersDb = Promise.resolve(db);
});

test.after(() => {
  for (const k of ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'EXPLAINERS_DATABASE_URL'] as const) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  delete (globalThis as { __explainersDb?: unknown }).__explainersDb;
});

const dramaDb = () => ({ query: async (text: string, params?: unknown[]) => ({ rows: (await pg.query(text, params)).rows as never[] }) });

test('posting: a bad patch is refused before any connection; Generate and Auto-publish write the drama settings', async () => {
  await assert.rejects(() => writePosting('reel_ai_drama', { perDay: 0 }, 't'), /from 1 to 1/);
  await assert.rejects(() => writePosting('reel_ai_drama', { perDay: 2 }, 't'), /from 1 to 1/);
  await assert.rejects(() => writePosting('reel_ai_drama', { live: 'yes' as never }, 't'), /true or false/);
  await assert.rejects(() => writePosting('reel_ai_drama', { cap: 4 }, 't'), /0 to 3/);

  const state = await writePosting('reel_ai_drama', { generate: true, autoPublish: true }, 'lucas');
  assert.equal(state.type, 'reel_ai_drama');
  assert.equal(state.generate, true);
  assert.equal(state.autoPublish, true);
  assert.equal(state.maxPerDay, 1);
  assert.equal(state.series, null);
  const stored = await readDramaPosting(dramaDb());
  assert.equal(stored.generate, true);
  assert.equal(stored.autoPublish, true);
  assert.equal(stored.live, false, 'Live is untouched');
});

const base: RunInputs = {
  today: '2026-11-08',
  reels: { quota: 0, held: 0, missing: [], slateToday: false },
  carousels: { quota: 0, held: 0, missing: [] },
  explainers: { quota: 0, held: 0, missing: [] },
  series: [],
  reelAiDrama: { quota: 1, held: 0, missing: [{ ideaId: `reel_ai_drama:pitch:${PITCH}`, ref: PITCH, title: 'The outage' }] },
  inFlight: { reelsRun: false, reelsBuilding: [], carouselRun: false, explainerTopics: [], dramaPitches: [] },
  cost: { reelsNight: 0, reelBuild: 0, carouselCap: 0, explainerCap: 0, storySet: 0, dramaCap: 8 },
};
const dramaStep = (plan: ReturnType<typeof planFrom>) => plan.steps.find((s) => s.vertical === 'reel_ai_drama');

test('run today: a missing drama card is a drama_jobs step at the job cap; in flight or full is none; absent is no step', () => {
  const step = dramaStep(planFrom(base))!;
  assert.equal(step.action, 'drama_jobs');
  assert.deepEqual(step.targets, [PITCH]);
  assert.equal(step.estimateUsd, 8);
  assert.equal(dramaStep(planFrom({ ...base, inFlight: { ...base.inFlight, dramaPitches: [PITCH] } }))!.action, 'none');
  assert.equal(dramaStep(planFrom({ ...base, reelAiDrama: { quota: 1, held: 1, missing: [] } }))!.action, 'none');
  const { reelAiDrama: _drop, ...without } = base;
  assert.equal(dramaStep(planFrom(without)), undefined);
});

test('run today: Make it narrows the drama step to its card, and never widens', () => {
  const plan = planFrom({ ...base, reelAiDrama: { quota: 2, held: 0, missing: [{ ideaId: 'a', ref: PITCH, title: 'A' }, { ideaId: 'b', ref: PITCH_2, title: 'B' }] } });
  const [one] = stepsFor(plan, 'reel_ai_drama', PITCH_2);
  assert.deepEqual([one!.action, one!.targets, one!.estimateUsd], ['drama_jobs', [PITCH_2], 8]);
  assert.equal(narrowStep(dramaStep(plan)!, 'not-a-card').action, 'none');
});

test('progress and misses read the drama jobs: a running job is progress; today’s failed job is a miss on its pitch card', async () => {
  for (const [id, title] of [[PITCH, 'The outage'], [PITCH_2, 'The merger']] as const) {
    await pg.query(`INSERT INTO reel_ai_drama.pitches (id, title, pitch, event_key) VALUES ($1, $2, '{}'::jsonb, $3)`, [id, title, `event-${id}`]);
  }
  await pg.query(`INSERT INTO reel_ai_drama.jobs (pitch_id, mode, spend_cap_usd, status, stage, started_at) VALUES ($1, 'production', 8, 'running', 'director', now())`, [PITCH]);
  await pg.query(`INSERT INTO reel_ai_drama.jobs (pitch_id, mode, spend_cap_usd, status, error, finished_at) VALUES ($1, 'production', 8, 'failed', 'HeyGen timed out', now())`, [PITCH_2]);

  const progress = await readProgress('reel_ai_drama');
  const running = progress.find((p) => p.topicId === PITCH);
  assert.equal(running?.state, 'running');
  assert.equal(running?.label, 'The outage');
  assert.equal(progress.find((p) => p.topicId === PITCH_2)?.state, 'failed');

  const misses = await readRunMisses(query, new Date());
  assert.deepEqual(misses.reel_ai_drama, [{ key: PITCH_2, title: 'Run didn’t finish', detail: 'HeyGen timed out' }]);
  assert.ok(nyDateOf(new Date()));
});
