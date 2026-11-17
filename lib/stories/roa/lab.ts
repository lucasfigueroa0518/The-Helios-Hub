/**
 * The Real or AI? swipe lab (CONTRACT §4 Owner B; RA-4, RA-7). Lucas sees a blind sample of what the engine would
 * post (the open `real_or_ai` pool, shuffled, the truth hidden), each image for ROA_LAB_VIEW_MS, then guesses Real or
 * AI. His accuracy grades the engine's selection: ROA_LAB_PASS (62%) or less passes; more means the selection is too
 * easy.
 *
 * RA-4: the lab tests the engine, not the pool. It only reads stories.pool (and stories.roa_archive, to find the truth
 * of a row the cap dropped mid-batch) and only writes stories.roa_lab. Images seen here may still post.
 */
import { randomUUID } from 'node:crypto';

import { ApiError } from '@/lib/stories/api';
import type { Queryable } from '@/lib/stories/db';
import {
  ROA_KEY_PREFIX,
  ROA_LAB_BATCH,
  ROA_LAB_PASS,
  ROA_LAB_VIEW_MS,
  ROA_SERIES,
  roaPoolKey,
  TRUTHS,
  type RoaPoolPayload,
  type Truth,
} from '@/lib/stories/roa/types';

export type LabItem = { imageKey: string; url: string | null };
/** What the page gets to start a batch: never the truth. */
export type LabBatch = { batchId: string; items: LabItem[]; viewMs: number; pass: number };
export type LabVerdict = 'engine passes' | 'selection too easy';
export type LabTally = { total: number; correct: number; accuracy: number | null; passes: boolean; verdict: LabVerdict | null };
export type LabResult = { imageKey: string; truth: Truth; guess: Truth; correct: boolean; ms: number };
export type LabScore = LabTally & { batchId: string; pass: number; results: LabResult[] };

export type LabDeps = {
  /** Signed URLs for storage paths (the stories bucket is private); a path that fails is null. */
  sign: (paths: string[]) => Promise<Array<string | null>>;
  rand?: () => number;
  newId?: () => string;
  limit?: number;
};

const IMAGE_KEY = /^[0-9a-f]{16}$/;
const BATCH_ID = /^[A-Za-z0-9-]{8,64}$/;
/** A guess slower than this is a walk-away, not a look: refused rather than recorded. */
const MAX_MS = 10 * 60_000;

export const verdictOf = (passes: boolean): LabVerdict => (passes ? 'engine passes' : 'selection too easy');

/** The batch's score: accuracy at or below ROA_LAB_PASS passes the engine (RA-7). No guesses, no verdict. */
export function tally(guesses: Array<{ truth: Truth; guess: Truth }>, pass: number = ROA_LAB_PASS): LabTally {
  const total = guesses.length;
  const correct = guesses.filter((g) => g.truth === g.guess).length;
  if (total === 0) return { total, correct, accuracy: null, passes: false, verdict: null };
  // Compared on counts, so 0.62 × 50 = 31 right is a pass and floating point never tips it.
  const passes = correct <= pass * total + 1e-9;
  return { total, correct, accuracy: correct / total, passes, verdict: verdictOf(passes) };
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(xs: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

type PoolRow = { key: string; payload: RoaPoolPayload | null };

/** The open `real_or_ai` pool: what the engine would post next. Read only. */
export async function openPool(db: Queryable): Promise<Array<{ imageKey: string; storagePath: string; truth: Truth }>> {
  const { rows } = await db.query<PoolRow>(
    `SELECT key, payload FROM stories.pool WHERE series = $1 AND used_at IS NULL AND key LIKE $2 ORDER BY key`,
    [ROA_SERIES, `${ROA_KEY_PREFIX}%`],
  );
  return rows.flatMap((r) => {
    const c = r.payload?.c;
    if (!c || !IMAGE_KEY.test(c.imageKey) || !c.storagePath || !TRUTHS.includes(c.truth)) return [];
    return [{ imageKey: c.imageKey, storagePath: c.storagePath, truth: c.truth }];
  });
}

/** A new blind batch: up to ROA_LAB_BATCH open pool images, shuffled, with signed URLs and no truth. */
export async function startBatch(db: Queryable, deps: LabDeps): Promise<LabBatch> {
  const pool = await openPool(db);
  const picked = shuffle(pool, deps.rand).slice(0, Math.max(0, deps.limit ?? ROA_LAB_BATCH));
  const urls = picked.length ? await deps.sign(picked.map((p) => p.storagePath)) : [];
  return {
    batchId: (deps.newId ?? randomUUID)(),
    items: picked.map((p, i) => ({ imageKey: p.imageKey, url: urls[i] ?? null })),
    viewMs: ROA_LAB_VIEW_MS,
    pass: ROA_LAB_PASS,
  };
}

/** The truth of a pool image, from its pool row, else (the cap dropped it mid-batch) from the archive. Read only. */
export async function truthOf(db: Queryable, imageKey: string): Promise<Truth | null> {
  const key = roaPoolKey(imageKey);
  const pool = await db.query<{ truth: string | null }>(`SELECT payload->'c'->>'truth' AS truth FROM stories.pool WHERE series = $1 AND key = $2`, [ROA_SERIES, key]);
  let truth = pool.rows[0]?.truth ?? null;
  if (!truth) {
    const archived = await db.query<{ truth: string | null }>(
      `SELECT payload->'c'->>'truth' AS truth FROM stories.roa_archive WHERE key IN ($1, $2) ORDER BY archived_at DESC LIMIT 1`,
      [key, imageKey],
    );
    truth = archived.rows[0]?.truth ?? null;
  }
  return truth && (TRUTHS as readonly string[]).includes(truth) ? (truth as Truth) : null;
}

export type GuessInput = { batchId: string; imageKey: string; guess: Truth; ms: number };

export function parseGuess(body: unknown): GuessInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const batchId = typeof b.batchId === 'string' ? b.batchId : '';
  const imageKey = typeof b.imageKey === 'string' ? b.imageKey : '';
  const guess = b.guess;
  const ms = typeof b.ms === 'number' && Number.isFinite(b.ms) ? Math.round(b.ms) : NaN;
  if (!BATCH_ID.test(batchId)) throw new ApiError(400, 'batchId is missing or malformed.');
  if (!IMAGE_KEY.test(imageKey)) throw new ApiError(400, 'imageKey is missing or malformed.');
  if (guess !== 'real' && guess !== 'ai') throw new ApiError(400, 'guess must be "real" or "ai".');
  if (!(ms >= 0 && ms <= MAX_MS)) throw new ApiError(400, `ms must be a number of milliseconds between 0 and ${MAX_MS}.`);
  return { batchId, imageKey, guess, ms };
}

/** Records one guess in stories.roa_lab (the only table the lab writes). The truth stays server-side until the score. */
export async function recordGuess(db: Queryable, body: unknown): Promise<{ recorded: true; count: number }> {
  const g = parseGuess(body);
  const truth = await truthOf(db, g.imageKey);
  if (!truth) throw new ApiError(404, 'That image is not in the Real or AI? pool.');
  const seen = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.roa_lab WHERE batch_id = $1 AND image_key = $2`, [g.batchId, g.imageKey]);
  if ((seen.rows[0]?.n ?? 0) > 0) throw new ApiError(409, 'That image already has a guess in this batch.');
  await db.query(`INSERT INTO stories.roa_lab (batch_id, image_key, truth, guess, ms) VALUES ($1, $2, $3, $4, $5)`, [g.batchId, g.imageKey, truth, g.guess, g.ms]);
  const count = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.roa_lab WHERE batch_id = $1`, [g.batchId]);
  return { recorded: true, count: count.rows[0]?.n ?? 1 };
}

/** The batch's score and each guess against the truth (the end screen). */
export async function batchScore(db: Queryable, batchId: string): Promise<LabScore> {
  if (!BATCH_ID.test(batchId)) throw new ApiError(400, 'batchId is missing or malformed.');
  const { rows } = await db.query<{ image_key: string; truth: Truth; guess: Truth; ms: number | null }>(
    `SELECT image_key, truth, guess, ms FROM stories.roa_lab WHERE batch_id = $1 ORDER BY id`,
    [batchId],
  );
  const results: LabResult[] = rows.map((r) => ({ imageKey: r.image_key, truth: r.truth, guess: r.guess, correct: r.truth === r.guess, ms: r.ms ?? 0 }));
  return { batchId, pass: ROA_LAB_PASS, ...tally(results), results };
}

/** GET /api/stories/roa-lab: `?batch=<id>` scores that batch; otherwise a new blind batch. */
export async function labGet(db: Queryable, params: URLSearchParams, deps: LabDeps): Promise<LabBatch | LabScore> {
  const batch = params.get('batch');
  return batch ? batchScore(db, batch) : startBatch(db, deps);
}
