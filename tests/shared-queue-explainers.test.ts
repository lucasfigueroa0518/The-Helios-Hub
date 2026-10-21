/**
 * Shared queue, Explainers (the 2 AM idea cycle), offline on PGlite with the
 * real schema files: tonight's promoted topic is rendered first and never cut
 * from the pool, a demoted topic goes last, the promote is used when made, a
 * gone one is skipped with why, and a moves read that fails leaves the night
 * as it was. Stubbed idea model and Jev: no live calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { EXPLAINER_GONE, runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import { trimPool } from '@/lib/explainers/ideas/evaluate';
import type { IdeaModel } from '@/lib/explainers/ideas/generator';
import { saveSetting } from '@/lib/explainers/settings';
import type { IdeaScoreKey } from '@/lib/explainers/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import type { MovesQuery } from '@/lib/social-hub/moves-store';

import { scratchExplainersDb } from './explainers-pglite';

const CYCLE_AT = new Date('2026-10-08T06:00:00Z'); // 2:00 AM New York

/** Below the E-15 gates: generated ideas never enter the pool, so the seeded pool decides the ranking. */
const BROAD: Record<IdeaScoreKey, number> = { audience_fit: 4, teachability_45s: 0, analogy_potential: 4, visual_potential: 4, accuracy_under_simplification: 1, hook_strength: 3, ai_focus: 2 };

function stubJev(): JevTransport {
  return {
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q) {
      const keys = Object.keys(questions);
      const answers: Record<string, unknown> = {};
      for (const key of keys) {
        answers[key] = keys[0] === 'duplicate_of_existing_topic' || key.startsWith('pair_')
          ? { type: 'noul', noul: 0.1 }
          : { type: 'score', score: BROAD[key as IdeaScoreKey], confidence: 1 };
      }
      void state;
      return { model: 'jev-stub', answers, usage: { input_tokens: 10, output_tokens: 0 } } as unknown as SystemOneResult<Q>;
    },
  };
}

function stubIdeas(): IdeaModel {
  return {
    async writeScopes(request: { titles: string[] }) {
      return { scopes: request.titles.map((t) => `Explain ${t}.`), usage: { input_tokens: 1, output_tokens: 1 }, model: 'stub' };
    },
    async propose() {
      return {
        ideas: [1, 2, 3].map((n) => ({ topic_title: `Generated ${n} ${Math.random()}`, topic_scope: 'Scope.' })),
        usage: { input_tokens: 10, output_tokens: 10 },
        model: 'stub',
      };
    },
  } as unknown as IdeaModel;
}

async function explainersOn(): Promise<ExplainersDb> {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', true);
  return db;
}

async function topic(db: ExplainersDb, title: string, score: number, status = 'pool'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO explainers.topics (title, origin, status, weighted_score) VALUES ($1, 'manual', $2, $3) RETURNING id`,
    [title, status, score],
  );
  return rows[0]!.id;
}

const addMove = (db: ExplainersDb, ideaId: string, kind: 'promote' | 'demote', at: string) =>
  db.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_at) VALUES ('explainers', $1, $2::date, $3, $4::timestamptz)`, [ideaId, at.slice(0, 10), kind, at]);

const moveRow = async (db: ExplainersDb, ideaId: string) =>
  (await db.query<{ used: boolean; skip_reason: string | null }>(`SELECT consumed_at IS NOT NULL AS used, skip_reason FROM social_hub.idea_adjustments WHERE idea_id = $1`, [ideaId])).rows[0]!;

const statusOf = async (db: ExplainersDb, id: string) => (await db.query<{ status: string }>(`SELECT status FROM explainers.topics WHERE id = $1`, [id])).rows[0]!.status;

const movesOf = (db: ExplainersDb): MovesQuery => (text, params) => db.query(text, params);

test('Review Focus 5: tonight’s promoted topic is rendered first even below the pool cut; a demoted topic goes last; the promote is used', async () => {
  const db = await explainersOn();
  await saveSetting(db, 'pool_size', 2);
  const a = await topic(db, 'A', 90);
  const b = await topic(db, 'B', 80);
  const p = await topic(db, 'P', 10);
  await addMove(db, `explainers:topic:${p}`, 'promote', '2026-10-07T20:00:00Z');
  await addMove(db, `explainers:topic:${a}`, 'demote', '2026-10-07T20:05:00Z');
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT, moves: movesOf(db) });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.renders, [p, b], 'the promote first, then the best topic not demoted');
  assert.notEqual(await statusOf(db, p), 'displaced', 'the pool trim did not cut it');
  assert.deepEqual(await moveRow(db, `explainers:topic:${p}`), { used: true, skip_reason: null });
  assert.equal((await moveRow(db, `explainers:topic:${a}`)).used, false, 'only the made idea’s moves are used');
});

test('trimPool keeps the exempt topic and cuts the next one instead', async () => {
  const { db } = await scratchExplainersDb();
  const a = await topic(db, 'A', 90);
  const b = await topic(db, 'B', 80);
  const p = await topic(db, 'P', 10);
  assert.equal(await trimPool(db, 1, p), 1);
  assert.deepEqual([await statusOf(db, a), await statusOf(db, b), await statusOf(db, p)], ['pool', 'displaced', 'pool']);
});

test('a promoted topic that is no longer in the pool is skipped with why; the night renders as it would without it', async () => {
  const db = await explainersOn();
  const a = await topic(db, 'A', 90);
  const b = await topic(db, 'B', 80);
  const gone = await topic(db, 'Gone', 95, 'displaced');
  await addMove(db, `explainers:topic:${gone}`, 'promote', '2026-10-07T20:00:00Z');
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT, moves: movesOf(db) });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.renders, [a, b]);
  assert.deepEqual(await moveRow(db, `explainers:topic:${gone}`), { used: false, skip_reason: EXPLAINER_GONE });
});

test('Review Focus 3: a moves read that fails leaves the night exactly as before', async () => {
  const db = await explainersOn();
  const a = await topic(db, 'A', 90);
  const b = await topic(db, 'B', 80);
  const p = await topic(db, 'P', 10);
  await addMove(db, `explainers:topic:${p}`, 'promote', '2026-10-07T20:00:00Z');
  const broken: MovesQuery = async () => {
    throw new Error('relation "social_hub.idea_adjustments" does not exist');
  };
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT, moves: broken });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.renders, [a, b]);
});

test('step aside in the same run: an older promote that is gone is skipped, the newer makeable one is rendered first, used, and spared by the trim', async () => {
  const db = await explainersOn();
  await saveSetting(db, 'pool_size', 2);
  const a = await topic(db, 'A', 90);
  const b = await topic(db, 'B', 80);
  const p = await topic(db, 'P', 10);
  const gone = await topic(db, 'Gone', 95, 'displaced');
  await addMove(db, `explainers:topic:${gone}`, 'promote', '2026-10-07T20:00:00Z');
  await addMove(db, `explainers:topic:${p}`, 'promote', '2026-10-07T20:05:00Z');
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT, moves: movesOf(db) });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.renders, [p, a], 'the newer promote leads, then the best of the rest');
  assert.notEqual(await statusOf(db, p), 'displaced', 'the trim spared it');
  assert.equal(await statusOf(db, b), 'pool', 'the exempt topic is simply not cut; nothing else is');
  assert.deepEqual(await moveRow(db, `explainers:topic:${gone}`), { used: false, skip_reason: EXPLAINER_GONE });
  assert.deepEqual(await moveRow(db, `explainers:topic:${p}`), { used: true, skip_reason: null });
});

test('a promote whose render does not start tonight is transient: no skip is recorded and it stays active for next night', async () => {
  const db = await explainersOn();
  await saveSetting(db, 'mode', 'production');
  await saveSetting(db, 'daily_render_cap', 1);
  const earlier = await topic(db, 'Earlier', 50, 'rendered');
  await db.query(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, requested_at)
     VALUES ($1, 'ok', 'auto', 'production', 5, 'm', 'm', '2026-10-08T05:00:00Z')`,
    [earlier],
  );
  const p = await topic(db, 'P', 10);
  await addMove(db, `explainers:topic:${p}`, 'promote', '2026-10-07T20:00:00Z');
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT, moves: movesOf(db) });
  assert.equal(result.status, 'ok');
  assert.deepEqual(await moveRow(db, `explainers:topic:${p}`), { used: false, skip_reason: null });
});
