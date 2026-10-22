/**
 * The idea pool standard on Explainers' 2 AM cycle (spec 2026-10-21), offline on PGlite with the real schema
 * files and a stubbed idea model and Jev: pins lead and are used when made, a drag steers tonight then expires,
 * archived topics are not made and not brought back, the pool never passes 30 but never cuts a person's own
 * topics, and a night that did not run leaves hand moves alone.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import { trimPool } from '@/lib/explainers/ideas/evaluate';
import type { IdeaModel } from '@/lib/explainers/ideas/generator';
import { fillCandidates } from '@/lib/explainers/publish/schedule';
import { saveSetting } from '@/lib/explainers/settings';
import type { ScoreKey } from '@/lib/explainers/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { readMoves } from '@/lib/social-hub/moves-store';
import { archiveIdea, pinIdea, placeIdea } from '@/lib/social-hub/queue-store';

import { scratchExplainersDb } from './explainers-pglite';

const CYCLE_AT = new Date('2026-10-08T06:00:00Z'); // 2:00 AM New York
const BROAD: Record<ScoreKey, number> = { audience_fit: 4, teachability_45s: 0, analogy_potential: 4, visual_potential: 4, accuracy_under_simplification: 1, hook_strength: 3 };

function stubJev(): JevTransport {
  return {
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q) {
      const keys = Object.keys(questions);
      const answers: Record<string, unknown> = {};
      for (const key of keys) {
        answers[key] = keys[0] === 'duplicate_of_existing_topic' || key.startsWith('pair_') ? { type: 'noul', noul: 0.1 } : { type: 'score', score: BROAD[key as ScoreKey] ?? 2, confidence: 1 };
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
      return { ideas: [1, 2, 3].map((n) => ({ topic_title: `Generated ${n} ${Math.random()}`, topic_scope: 'Scope.' })), usage: { input_tokens: 10, output_tokens: 10 }, model: 'stub' };
    },
  } as unknown as IdeaModel;
}

async function explainersOn(): Promise<ExplainersDb> {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', true);
  return db;
}

async function topic(db: ExplainersDb, title: string, score: number, origin = 'generated', status = 'pool'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO explainers.topics (title, origin, status, weighted_score, scope) VALUES ($1, $2, $3, $4, 'Scope.') RETURNING id`,
    [title, origin, status, score],
  );
  return rows[0]!.id;
}

const q = (db: ExplainersDb) => (text: string, params?: unknown[]) => db.query(text, params as never) as never;
const idea = (id: string) => `explainers:topic:${id}`;
const statusOf = async (db: ExplainersDb, id: string) => (await db.query<{ status: string }>(`SELECT status FROM explainers.topics WHERE id = $1`, [id])).rows[0]!.status;
const run = (db: ExplainersDb) => runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT });
const okOrWhy = (r: Awaited<ReturnType<typeof run>>) => (r.status === 'failed' ? `failed: ${r.error}` : r.status);

test('pins are made first, in the order pinned, even below the pool cut; a made pin is used up', async () => {
  const db = await explainersOn();
  await saveSetting(db, 'pool_size', 2);
  const a = await topic(db, 'A', 90);
  await topic(db, 'B', 80);
  const p = await topic(db, 'P', 10);
  await pinIdea(q(db), 'explainers', idea(p), 'tommy');
  const result = await run(db);
  assert.equal(okOrWhy(result), 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.renders, [p, a], 'the pin, then the best topic');
  assert.notEqual(await statusOf(db, p), 'displaced', 'the trim did not cut the pin');
  assert.deepEqual(await readMoves(q(db), 'explainers'), [], 'the pin was used when its render was requested');
});

test('a drag steers tonight, then expires: the idea competes by score again', async () => {
  const db = await explainersOn();
  const a = await topic(db, 'A', 90);
  const b = await topic(db, 'B', 80);
  const c = await topic(db, 'C', 70);
  await placeIdea(q(db), 'explainers', idea(c), 95, 'tommy'); // dragged to the top
  const result = await run(db);
  assert.equal(okOrWhy(result), 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.renders, [c, a]);
  assert.equal(await statusOf(db, b), 'pool');
  assert.deepEqual(await readMoves(q(db), 'explainers'), [], 'the placement is used up after the run');
});

test('a night that does not run (auto-render off) leaves hand moves in force', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', false);
  const c = await topic(db, 'C', 70);
  await placeIdea(q(db), 'explainers', idea(c), 95, null);
  await pinIdea(q(db), 'explainers', idea(await topic(db, 'D', 60)), null);
  assert.deepEqual(await run(db), { status: 'skipped', reason: 'auto_render_off' });
  assert.equal((await readMoves(q(db), 'explainers')).length, 2);
});

test('an archived topic is never made, and its title is history the proposer is told about', async () => {
  const db = await explainersOn();
  const a = await topic(db, 'Archived one', 99);
  const b = await topic(db, 'B', 80);
  await archiveIdea(q(db), 'explainers', idea(a), 'tommy');
  assert.deepEqual((await fillCandidates(db, false, await readMoves(q(db), 'explainers'))).map((c) => c.topicId), [b]);
  let history: string[] = [];
  const spy = { ...stubIdeas(), propose: async (req: { rendered: Array<{ topic_title: string }> }) => { history = req.rendered.map((r) => r.topic_title); return (stubIdeas() as never as { propose: () => Promise<unknown> }).propose(); } } as unknown as IdeaModel;
  await runIdeaCycle({ db, ideaModel: spy, jevTransport: stubJev(), now: CYCLE_AT });
  assert.ok(history.includes('Archived one'));
  assert.notEqual((await run(db)).status, 'failed');
});

test('a pinned topic the night cannot make is skipped with why, and the next is made', async () => {
  const db = await explainersOn();
  await saveSetting(db, 'mode', 'production');
  await saveSetting(db, 'daily_render_cap', 0);
  const a = await topic(db, 'A', 90);
  await pinIdea(q(db), 'explainers', idea(a), null);
  const result = await run(db);
  assert.equal(okOrWhy(result), 'ok');
  const rows = await readMoves(q(db), 'explainers');
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.skipReason ?? '', /render cap/);
});

test('the pool never passes 30, never cuts a person’s own or a pinned topic, and a pool_size above 30 is held to 30', async () => {
  const { db } = await scratchExplainersDb();
  for (let i = 0; i < 32; i++) await topic(db, `T${i}`, 100 - i);
  const mine = await topic(db, 'Mine', 1, 'manual');
  const pinned = await topic(db, 'Pinned', 2);
  const cut = await trimPool(db, 99, pinned);
  assert.equal(cut, 4, '34 pool topics + 2 protected = 34 - 30');
  assert.equal(await statusOf(db, mine), 'pool');
  assert.equal(await statusOf(db, pinned), 'pool');
  const left = (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM explainers.topics WHERE status = 'pool'`)).rows[0]!.n;
  assert.equal(Number(left), 30);
});
