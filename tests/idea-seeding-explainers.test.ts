/**
 * Idea seeding, Explainers (spec 2026-10-21-idea-seeding-design), offline on PGlite with the real schema files and a
 * stubbed idea model and Jev (no live calls): a typed idea (origin `manual`) is scored for ranking and never refused,
 * trimmed or made to displace anything; what it would have been refused for comes back as flags; one below a quality
 * bar is the person's to make (the night skips it unless it is pinned); and only so many wait at once.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { addAndEvaluateTopics } from '@/lib/explainers/ideas/cycle';
import type { IdeaModel } from '@/lib/explainers/ideas/generator';
import { fillCandidates } from '@/lib/explainers/publish/schedule';
import { MAX_OPEN_SEEDS, openSeedCount } from '@/lib/explainers/repository';
import type { ScoreKey } from '@/lib/explainers/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { readMoves } from '@/lib/social-hub/moves-store';
import { pinIdea } from '@/lib/social-hub/queue-store';

import { scratchExplainersDb } from './explainers-pglite';

const STRONG: Record<ScoreKey, number> = { audience_fit: 4, teachability_45s: 4, analogy_potential: 4, visual_potential: 4, accuracy_under_simplification: 4, hook_strength: 4 };
const BELOW: Record<ScoreKey, number> = { ...STRONG, teachability_45s: 0, accuracy_under_simplification: 1 };

/** Scores every topic with `scores`; answers the duplicate questions with `duplicate` (a noul, 0 to 1). */
function jev(scores: Record<ScoreKey, number>, duplicate = 0.1): JevTransport {
  return {
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q) {
      const answers: Record<string, unknown> = {};
      for (const key of Object.keys(questions)) {
        answers[key] = key === 'duplicate_of_existing_topic' || key.startsWith('pair_') ? { type: 'noul', noul: duplicate } : { type: 'score', score: scores[key as ScoreKey] ?? 2, confidence: 1 };
      }
      void state;
      return { model: 'jev-stub', answers, usage: { input_tokens: 10, output_tokens: 0 } } as unknown as SystemOneResult<Q>;
    },
  };
}

const ideas = (): IdeaModel => ({
  async writeScopes(request: { titles: string[] }) {
    return { scopes: request.titles.map((t) => `Explain ${t}.`), terms: request.titles.map(() => 'term'), usage: { input_tokens: 1, output_tokens: 1 }, model: 'stub' };
  },
}) as unknown as IdeaModel;

const seed = (db: ExplainersDb, title: string, transport: JevTransport) =>
  addAndEvaluateTopics({ db, jevTransport: transport, ideaModel: ideas() }, [{ title, origin: 'manual' }]);
const statusOf = async (db: ExplainersDb, id: string) => (await db.query<{ status: string }>(`SELECT status FROM explainers.topics WHERE id = $1`, [id])).rows[0]!.status;

test('a seed that clears every bar enters the pool with no flags', async () => {
  const { db } = await scratchExplainersDb();
  const [r] = await seed(db, 'Why do LLMs hallucinate?', jev(STRONG));
  assert.equal(r!.evaluation.outcome, 'entered_pool');
  assert.deepEqual((r!.evaluation as { flags: string[] }).flags, []);
  assert.equal(await statusOf(db, r!.topicId), 'pool');
});

test('a seed below a quality bar is kept and flagged, where a machine idea is rejected', async () => {
  const { db } = await scratchExplainersDb();
  const [r] = await seed(db, 'A weak question', jev(BELOW));
  assert.deepEqual((r!.evaluation as { flags: string[] }).flags, ['below_gate']);
  assert.equal(await statusOf(db, r!.topicId), 'pool');
  const [machine] = await addAndEvaluateTopics({ db, jevTransport: jev(BELOW), ideaModel: ideas() }, [{ title: 'A weak machine idea', origin: 'seeded' }]);
  assert.equal(machine!.evaluation.outcome, 'rejected_gates');
});

test('a seed close to a recent render is kept and flagged; close to a pool idea, both stay', async () => {
  const { db } = await scratchExplainersDb();
  await db.query(`INSERT INTO explainers.topics (title, origin, status, scope, rendered_at) VALUES ('Why LLMs hallucinate', 'generated', 'rendered', 'S', now() - interval '2 days')`);
  const [recent] = await seed(db, 'Why do LLMs hallucinate?', jev(STRONG, 0.9));
  assert.deepEqual((recent!.evaluation as { flags: string[] }).flags, ['history_duplicate']);
  assert.equal(await statusOf(db, recent!.topicId), 'pool');
  await db.query(`UPDATE explainers.topics SET status = 'archived' WHERE status = 'rendered'`);
  const { rows } = await db.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status, scope, weighted_score) VALUES ('A pool idea', 'generated', 'pool', 'S', 60) RETURNING id`);
  const [near] = await seed(db, 'A near-twin of a pool idea', jev(STRONG, 0.9));
  assert.deepEqual((near!.evaluation as { flags: string[] }).flags, ['near_pool_topic']);
  assert.equal(await statusOf(db, rows[0]!.id), 'pool', 'a seed never displaces another topic');
  assert.equal(await statusOf(db, near!.topicId), 'pool');
});

test('the night skips a below-bar seed unless it is pinned; a good seed competes like any idea', async () => {
  const { db } = await scratchExplainersDb();
  const [weak] = await seed(db, 'A weak question', jev(BELOW));
  const [good] = await seed(db, 'A good question', jev(STRONG));
  assert.deepEqual((await fillCandidates(db, false, [])).map((c) => c.topicId), [good!.topicId]);
  const q = (text: string, params?: unknown[]) => db.query(text, params as never) as never;
  await pinIdea(q, 'explainers', `explainers:topic:${weak!.topicId}`, 'tommy');
  const moves = await readMoves(q, 'explainers');
  assert.deepEqual((await fillCandidates(db, false, moves)).map((c) => c.topicId), [weak!.topicId, good!.topicId], 'a person’s pin overrides the bar');
});

test('only so many seeds wait at once, and making or archiving one frees a place', async () => {
  const { db } = await scratchExplainersDb();
  for (let i = 0; i < MAX_OPEN_SEEDS; i++) await db.query(`INSERT INTO explainers.topics (title, origin, status, scope) VALUES ($1, 'manual', 'pool', 'S')`, [`Seed ${i}`]);
  assert.equal(await openSeedCount(db), MAX_OPEN_SEEDS);
  await db.query(`UPDATE explainers.topics SET status = 'queued' WHERE title = 'Seed 0'`);
  assert.equal(await openSeedCount(db), MAX_OPEN_SEEDS - 1, 'a seed that has been made no longer waits');
  await db.query(`INSERT INTO explainers.topics (title, origin, status, scope) VALUES ('A pasted one', 'seeded', 'pool', 'S')`);
  assert.equal(await openSeedCount(db), MAX_OPEN_SEEDS - 1, 'a pasted list is not a seed');
});
