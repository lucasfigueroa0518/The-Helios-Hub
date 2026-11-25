/**
 * One-box seeding v2, Task 5: a Stories pool row whose payload says `seed: true` is Yours and the caps never cut it,
 * whatever its key (Trivia and Real or AI? seeds use daily-style keys, not `seed:`). Offline on the local Stories db.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { storyIdeas } from '@/lib/social-hub/adapters/stories';
import type { StoryPoolRow } from '@/lib/social-hub/queries/stories';
import { openLocalStoriesDb } from '@/lib/stories/local-db';
import { capRoaPool, capTriviaPool, TRIVIA_POOL_CAP } from '@/lib/stories/pool';
import { ROA_POOL_CAP } from '@/lib/stories/roa/types';

const NOW = new Date('2026-11-24T12:00:00Z');

async function addRow(db: Awaited<ReturnType<typeof openLocalStoriesDb>>['db'], series: string, key: string, score: number, payload: Record<string, unknown>) {
  await db.query(
    `INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, refreshed_at) VALUES ($1, $2, 'model', $2, $2, $3::jsonb, $4, $5::timestamptz)`,
    [series, key, JSON.stringify(payload), score, NOW.toISOString()],
  );
}

test('capTriviaPool with 51 unused rows keeps the seeded one', async () => {
  const { db } = await openLocalStoriesDb();
  for (let i = 0; i < TRIVIA_POOL_CAP; i++) await addRow(db, 'ai_trivia', `trivia:t01a01:${i}`, 0.9 - i * 0.001, {});
  // Lowest score of 51, so it is the one the cap would cut.
  await addRow(db, 'ai_trivia', 'trivia:t01a01:seeded', 0.1, { seed: true });
  assert.deepEqual(await capTriviaPool(db, NOW), [], 'nothing is cut');
  const left = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.pool WHERE series = 'ai_trivia' AND key = 'trivia:t01a01:seeded'`);
  assert.equal(left.rows[0]!.n, 1);
});

test('the Real or AI? cap keeps a seeded roa row at 41 rows', async () => {
  const { db } = await openLocalStoriesDb();
  for (let i = 0; i < ROA_POOL_CAP; i++) await addRow(db, 'real_or_ai', `roa:${i.toString(16).padStart(16, '0')}`, 0.9 - i * 0.001, {});
  await addRow(db, 'real_or_ai', `roa:${'f'.repeat(16)}`, 0.1, { seed: true });
  assert.deepEqual(await capRoaPool(db, NOW), [], 'nothing is cut');
  const left = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.pool WHERE series = 'real_or_ai'`);
  assert.equal(left.rows[0]!.n, ROA_POOL_CAP + 1);
});

test('the stories adapter marks payload.seed rows yours with detail "You typed this in"', () => {
  const base: StoryPoolRow = { pool_id: '1', series: 'ai_trivia', key: 'trivia:t01a01:1', origin: 'model', ref: 'x', title: 'Q', source: null, score: 0.5, refreshed_at: NOW.toISOString() };
  const [seeded, plain] = storyIdeas([{ ...base, seed: true }, { ...base, key: 'trivia:t01a01:2' }]);
  assert.equal(seeded!.yours, true);
  assert.equal(seeded!.detail, 'You typed this in');
  assert.equal(plain!.yours, false);
});

type LocalDb = Awaited<ReturnType<typeof openLocalStoriesDb>>['db'];
/** Records every query error (and rethrows it); `noMoves` makes any query that reads the moves table fail, as on a database without it. */
function watched(db: LocalDb, o: { noMoves?: boolean } = {}) {
  const errors: string[] = [];
  const w = {
    query: async (text: string, params?: unknown[]) => {
      try {
        if (o.noMoves && text.includes('social_hub.idea_adjustments')) throw new Error('relation "social_hub.idea_adjustments" does not exist');
        return await db.query(text, params as never);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
  } as unknown as LocalDb;
  return { db: w, errors };
}

// Final fixes 3: a payload whose seed is not a boolean must not fail the cap query (the fallback would then cut seeded rows).
// Postgres reads 'yes' as a boolean; 'sure' is what made the old ::boolean cast throw. Only the JSON true is a seed.
test('a row with payload seed "yes" (or "sure") does not make the cap queries throw; seeded rows stay', async () => {
  const { db: raw } = await openLocalStoriesDb();
  for (let i = 0; i < TRIVIA_POOL_CAP; i++) await addRow(raw, 'ai_trivia', `trivia:t01a01:${i}`, 0.9 - i * 0.001, {});
  await addRow(raw, 'ai_trivia', 'trivia:t01a01:odd', 0.2, { seed: 'yes' });
  await addRow(raw, 'ai_trivia', 'trivia:t01a01:odder', 0.15, { seed: 'sure' });
  await addRow(raw, 'ai_trivia', 'trivia:t01a01:seeded', 0.1, { seed: true });
  for (let i = 0; i < ROA_POOL_CAP; i++) await addRow(raw, 'real_or_ai', `roa:${i.toString(16).padStart(16, '0')}`, 0.9 - i * 0.001, {});
  await addRow(raw, 'real_or_ai', `roa:${'e'.repeat(16)}`, 0.2, { seed: 'yes' });
  await addRow(raw, 'real_or_ai', `roa:${'d'.repeat(16)}`, 0.15, { seed: 'sure' });
  await addRow(raw, 'real_or_ai', `roa:${'f'.repeat(16)}`, 0.1, { seed: true });
  const { db, errors } = watched(raw);
  const cutTrivia = await capTriviaPool(db, NOW);
  const cutRoa = await capRoaPool(db, NOW);
  assert.deepEqual(errors, [], 'no cap query failed');
  // The two odd rows are not seeds: they are the lowest unseeded scores, so the cap cuts them.
  assert.deepEqual(cutTrivia.sort(), ['trivia:t01a01:odd', 'trivia:t01a01:odder']);
  assert.deepEqual(cutRoa.sort(), [`roa:${'d'.repeat(16)}`, `roa:${'e'.repeat(16)}`]);
  const kept = await raw.query<{ key: string }>(`SELECT key FROM stories.pool WHERE payload->>'seed' = 'true' ORDER BY key`);
  assert.deepEqual(kept.rows.map((r) => r.key), [`roa:${'f'.repeat(16)}`, 'trivia:t01a01:seeded']);
});

test('without the moves table, the fallback caps still keep seeded rows (a seed: key or payload seed true)', async () => {
  const { db: raw } = await openLocalStoriesDb();
  for (let i = 0; i < TRIVIA_POOL_CAP; i++) await addRow(raw, 'ai_trivia', `trivia:t01a01:${i}`, 0.9 - i * 0.001, {});
  await addRow(raw, 'ai_trivia', 'trivia:t01a01:seeded', 0.1, { seed: true });
  await addRow(raw, 'ai_trivia', 'seed:typed-in', 0.05, {});
  for (let i = 0; i < ROA_POOL_CAP; i++) await addRow(raw, 'real_or_ai', `roa:${i.toString(16).padStart(16, '0')}`, 0.9 - i * 0.001, {});
  await addRow(raw, 'real_or_ai', `roa:${'f'.repeat(16)}`, 0.1, { seed: true });
  await addRow(raw, 'real_or_ai', 'seed:typed-in', 0.05, {});
  const { db, errors } = watched(raw, { noMoves: true });
  assert.deepEqual(await capTriviaPool(db, NOW), [], 'nothing is cut: the 50 unseeded rows are within the cap');
  assert.deepEqual(await capRoaPool(db, NOW), []);
  assert.ok(errors.length >= 2, 'the main queries failed, so the fallbacks ran');
  const n = async (series: string) => (await raw.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.pool WHERE series = $1`, [series])).rows[0]!.n;
  assert.equal(await n('ai_trivia'), TRIVIA_POOL_CAP + 2);
  assert.equal(await n('real_or_ai'), ROA_POOL_CAP + 2);
});
