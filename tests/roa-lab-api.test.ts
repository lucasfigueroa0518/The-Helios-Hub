/**
 * Real or AI? swipe lab (planning/Real or AI/CONTRACT.md §5 B; RA-4, RA-7), offline on PGlite: a blind batch hides the
 * truth, guesses are recorded in stories.roa_lab, the score maths is right (≤ 62% passes), and the pool is never
 * written.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import type { Queryable, StoriesDb } from '@/lib/stories/db';
import { openLocalStoriesDb, schemaSql } from '@/lib/stories/local-db';
import { batchScore, labGet, parseGuess, recordGuess, shuffle, startBatch, tally, type LabBatch, type LabScore } from '@/lib/stories/roa/lab';
import { ROA_LAB_BATCH, ROA_LAB_PASS, ROA_LAB_VIEW_MS, roaPoolKey, roaStoragePath, type RoaPoolPayload, type Truth } from '@/lib/stories/roa/types';
import { storiesRoute } from '@/lib/stories/route';

const keyOf = (i: number) => i.toString(16).padStart(16, '0');
const sign = async (paths: string[]) => paths.map((p) => `https://signed.example/${p}`);

function payload(i: number, truth: Truth): RoaPoolPayload {
  const imageKey = keyOf(i);
  return {
    kind: 'roa',
    c: {
      imageKey, truth, subject: 'nature_weather', trap: truth === 'real' ? 'too_perfect' : 'mundane', storagePath: roaStoragePath(imageKey),
      provenance: truth === 'real' ? { kind: 'commons', url: 'https://commons.example/x', licence: 'CC BY 4.0', credit: 'A. Person' } : { kind: 'generated', model: 'gpt-image-2', prompt: 'p', createdAt: '2026-11-15' },
    },
    screen: { pass: true, reasons: [], difficulty: 0.5 },
    reveal: 'line',
    writtenOn: '2026-11-15',
  };
}

async function labDb(rows: number): Promise<{ db: StoriesDb; truths: Map<string, Truth> }> {
  const { db, pg } = await openLocalStoriesDb();
  await pg.exec(schemaSql(path.join(process.cwd(), 'db', 'stories_real_or_ai.sql')));
  const truths = new Map<string, Truth>();
  for (let i = 1; i <= rows; i++) {
    const truth: Truth = i % 2 ? 'real' : 'ai';
    truths.set(keyOf(i), truth);
    await db.query(`INSERT INTO stories.pool (series, key, origin, ref, title, payload, score) VALUES ('real_or_ai', $1, 'model', $2, $3, $4, 0.5)`, [roaPoolKey(keyOf(i)), keyOf(i), `roa ${i}`, JSON.stringify(payload(i, truth))]);
  }
  // A used row is not what the engine would post next: never sampled.
  await db.query(`INSERT INTO stories.pool (series, key, origin, ref, title, payload, used_at) VALUES ('real_or_ai', $1, 'model', 'u', 'used', $2, now())`, [roaPoolKey(keyOf(999)), JSON.stringify(payload(999, 'real'))]);
  return { db, truths };
}

/** A view of the db that records every statement, to prove the lab never writes the pool. */
function spy(db: Queryable): { db: Queryable; sql: string[] } {
  const sql: string[] = [];
  return { sql, db: { query: (text, params) => (sql.push(text), db.query(text, params)) } as Queryable };
}

const poolSnapshot = async (db: Queryable) => JSON.stringify((await db.query(`SELECT * FROM stories.pool ORDER BY key`)).rows);

test('tally: accuracy at or below 62% passes the engine; above it the selection is too easy', () => {
  const g = (right: number, total: number) => Array.from({ length: total }, (_, i) => ({ truth: 'real' as Truth, guess: (i < right ? 'real' : 'ai') as Truth }));
  assert.equal(ROA_LAB_PASS, 0.62);
  assert.deepEqual(tally(g(12, 20)), { total: 20, correct: 12, accuracy: 0.6, passes: true, verdict: 'engine passes' });
  assert.deepEqual(tally(g(13, 20)), { total: 20, correct: 13, accuracy: 0.65, passes: false, verdict: 'selection too easy' });
  assert.equal(tally(g(31, 50)).passes, true, 'exactly 62% passes');
  assert.equal(tally(g(32, 50)).passes, false);
  assert.equal(tally(g(0, 20)).verdict, 'engine passes');
  assert.deepEqual(tally([]), { total: 0, correct: 0, accuracy: null, passes: false, verdict: null });
});

test('shuffle: a permutation, deterministic under a seeded rand', () => {
  const xs = Array.from({ length: 30 }, (_, i) => i);
  let s = 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = shuffle(xs, rand);
  assert.deepEqual([...out].sort((a, b) => a - b), xs);
  assert.notDeepEqual(out, xs);
  assert.deepEqual(xs, Array.from({ length: 30 }, (_, i) => i), 'input untouched');
});

test('a batch is a blind, shuffled sample of the open pool, capped at ROA_LAB_BATCH', async () => {
  const { db } = await labDb(25);
  const batch = await startBatch(db, { sign, newId: () => 'batch-0001' });
  assert.equal(batch.batchId, 'batch-0001');
  assert.equal(batch.items.length, ROA_LAB_BATCH);
  assert.equal(batch.viewMs, ROA_LAB_VIEW_MS);
  assert.equal(new Set(batch.items.map((x) => x.imageKey)).size, ROA_LAB_BATCH);
  assert.ok(!batch.items.some((x) => x.imageKey === keyOf(999)), 'a used row is never sampled');
  assert.equal(batch.items[0]!.url, `https://signed.example/roa/candidates/${batch.items[0]!.imageKey}.jpg`);
  assert.doesNotMatch(JSON.stringify(batch), /truth|"real"|"ai"/, 'the truth never reaches the page');
  const small = await labDb(3);
  assert.equal((await startBatch(small.db, { sign })).items.length, 3);
});

test('guesses are recorded in stories.roa_lab, scored right, and the pool is never written (RA-4)', async () => {
  const { db, truths } = await labDb(10);
  const before = await poolSnapshot(db);
  const s = spy(db);
  const batch = (await labGet(s.db, new URLSearchParams(), { sign, newId: () => 'batch-0002' })) as LabBatch;
  assert.equal(batch.items.length, 10);
  // Six right, four wrong: 60% → the engine passes.
  for (const [i, it] of batch.items.entries()) {
    const truth = truths.get(it.imageKey)!;
    const guess: Truth = i < 6 ? truth : truth === 'real' ? 'ai' : 'real';
    const r = await recordGuess(s.db, { batchId: batch.batchId, imageKey: it.imageKey, guess, ms: 1800 + i });
    assert.deepEqual(r, { recorded: true, count: i + 1 });
  }
  const rows = (await db.query<{ truth: string; guess: string; ms: number }>(`SELECT truth, guess, ms FROM stories.roa_lab WHERE batch_id = 'batch-0002'`)).rows;
  assert.equal(rows.length, 10);
  assert.equal(rows.filter((r) => r.truth === r.guess).length, 6);

  const score = (await labGet(s.db, new URLSearchParams({ batch: 'batch-0002' }), { sign })) as LabScore;
  assert.equal(score.total, 10);
  assert.equal(score.correct, 6);
  assert.equal(score.accuracy, 0.6);
  assert.equal(score.passes, true);
  assert.equal(score.verdict, 'engine passes');
  assert.equal(score.results.length, 10);
  assert.equal(score.results[0]!.ms, 1800);

  // A duplicate or an unknown image is refused, and nothing changes.
  await assert.rejects(recordGuess(s.db, { batchId: batch.batchId, imageKey: batch.items[0]!.imageKey, guess: 'ai', ms: 10 }), (e: { status?: number }) => e.status === 409);
  await assert.rejects(recordGuess(s.db, { batchId: batch.batchId, imageKey: keyOf(4321), guess: 'ai', ms: 10 }), (e: { status?: number }) => e.status === 404);

  for (const q of s.sql) {
    if (/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i.test(q)) assert.match(q, /^INSERT INTO stories\.roa_lab /, `the lab wrote: ${q}`);
  }
  assert.equal(await poolSnapshot(db), before, 'the pool is untouched');
});

test('the truth of a row the cap dropped mid-batch comes from the archive; 13/20 is too easy', async () => {
  const { db, truths } = await labDb(20);
  const batch = await startBatch(db, { sign, newId: () => 'batch-0003' });
  const gone = batch.items[0]!.imageKey;
  // The engine (not the lab) archives a row while the batch runs.
  await db.query(`INSERT INTO stories.roa_archive (key, payload, reason) SELECT key, payload, 'cap' FROM stories.pool WHERE key = $1`, [roaPoolKey(gone)]);
  await db.query(`DELETE FROM stories.pool WHERE key = $1`, [roaPoolKey(gone)]);
  for (const [i, it] of batch.items.entries()) {
    const truth = truths.get(it.imageKey)!;
    await recordGuess(db, { batchId: 'batch-0003', imageKey: it.imageKey, guess: i < 13 ? truth : truth === 'real' ? 'ai' : 'real', ms: 2000 });
  }
  const score = await batchScore(db, 'batch-0003');
  assert.equal(score.total, 20);
  assert.equal(score.correct, 13);
  assert.equal(score.passes, false);
  assert.equal(score.verdict, 'selection too easy');
});

test('parseGuess refuses malformed input', () => {
  const ok = { batchId: 'batch-0004', imageKey: keyOf(1), guess: 'real', ms: 1234.4 };
  assert.deepEqual(parseGuess(ok), { batchId: 'batch-0004', imageKey: keyOf(1), guess: 'real', ms: 1234 });
  for (const bad of [{ ...ok, batchId: 'x' }, { ...ok, imageKey: 'ZZ' }, { ...ok, guess: 'maybe' }, { ...ok, ms: -1 }, { ...ok, ms: 'fast' }, null]) {
    assert.throws(() => parseGuess(bad), (e: { status?: number }) => e.status === 400);
  }
});

test('the API is signed-in only (the stories route wrapper)', async () => {
  const { db } = await labDb(2);
  const out = await storiesRoute(({ db: d }) => labGet(d, new URLSearchParams(), { sign }), { session: async () => null, db });
  assert.equal(out.status, 401);
  const inside = await storiesRoute(({ db: d }) => labGet(d, new URLSearchParams(), { sign }), { session: async () => ({ email: 'lucas@x' }), db });
  assert.equal(inside.status, 200);
  assert.equal(((await inside.json()) as LabBatch).items.length, 2);
  const bad = await storiesRoute(({ db: d }) => recordGuess(d, { batchId: 'nope' }), { session: async () => ({ email: 'lucas@x' }), db });
  assert.equal(bad.status, 400);
});
