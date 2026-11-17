/**
 * The opponent lean (AT-75): over the recent run of sets the AI opponent should win about half the time.
 *
 * Before the fact-check, the opponent answers the pool's top questions (each question only ever once: its
 * answer is stored on its pool row). Then the last sets decide the day's lean: if the AI has been winning more
 * than half, a question it missed goes first; if less, one it got right. Only the top LEAN_TOP questions by
 * score can move, so quality still comes first; with no lean they stay in score order.
 */
import type { StoriesDb } from '@/lib/stories/db';

import { askOpponent, type OpponentClient } from './opponent';
import { poolKeyOf, TRIVIA_SERIES, type TriviaPoolPayload } from './types';

/** How many recent sets the lean looks at. */
export const LEAN_WINDOW = 6;
/** How many of the pool's top questions the lean may reorder (and the opponent answers ahead of time). */
export const LEAN_TOP = 3;
/** The share of sets the AI should win. */
export const AI_WIN_TARGET = 0.5;

/** `miss`: put a question the AI got wrong first; `hit`: one it got right; null: score order. */
export type Lean = 'miss' | 'hit' | null;

/** The lean from the recent results (true = the AI was right). No history, or exactly on target: no lean. */
export function leanFrom(results: boolean[]): Lean {
  if (!results.length) return null;
  const rate = results.filter(Boolean).length / results.length;
  return rate > AI_WIN_TARGET ? 'miss' : rate < AI_WIN_TARGET ? 'hit' : null;
}

/** Was the stored opponent answer right? Null when the question has none. */
export const aiRight = (p: TriviaPoolPayload): boolean | null => (p.opponent ? p.opponent.picked === p.q.correct : null);

/** The pool with its top LEAN_TOP reordered by the lean: matching questions first, each group in score order. */
export function leanOrder(pool: TriviaPoolPayload[], lean: Lean): TriviaPoolPayload[] {
  if (!lean) return pool;
  const top = pool.slice(0, LEAN_TOP);
  const want = lean === 'hit';
  const match = top.filter((p) => aiRight(p) === want);
  return [...match, ...top.filter((p) => !match.includes(p)), ...pool.slice(LEAN_TOP)];
}

/** The AI's results on the last LEAN_WINDOW built AI Trivia sets that showed an opponent, newest first. */
export async function recentAiResults(db: StoriesDb, exceptSetId: string | null): Promise<boolean[]> {
  const { rows } = await db.query<{ right: boolean }>(
    `SELECT (payload->'trivia'->'opponent'->>'picked') = (payload->'trivia'->'q'->>'correct') AS right
       FROM stories.sets
      WHERE series = $1 AND payload->'trivia'->'opponent' IS NOT NULL
        AND status IN ('ready', 'approved', 'scheduled', 'publishing', 'published')
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      ORDER BY created_at DESC LIMIT $3`,
    [TRIVIA_SERIES, exceptSetId, LEAN_WINDOW],
  );
  return rows.map((r) => r.right);
}

type AnswerDeps = { db: StoriesDb; setId: string | null; opponent: OpponentClient; log?: (line: string) => void };

/** The opponent's answer for one pool question: the stored one, or asked now and stored on its row. */
export async function opponentFor(d: AnswerDeps, p: TriviaPoolPayload): Promise<TriviaPoolPayload> {
  if (p.opponent) return p;
  const o = await askOpponent({ client: d.opponent, db: d.db, setId: d.setId, question: p.q.question, options: p.q.options, log: d.log });
  if (!o) return p;
  await d.db.query(
    `UPDATE stories.pool SET payload = payload || jsonb_build_object('opponent', $3::jsonb) WHERE series = $1 AND key = $2`,
    [TRIVIA_SERIES, poolKeyOf(p.q), JSON.stringify(o)],
  );
  return { ...p, opponent: o };
}

/** The pool with the opponent's answers on its top LEAN_TOP questions (asked only where missing). */
export async function answerTop(d: AnswerDeps, pool: TriviaPoolPayload[]): Promise<TriviaPoolPayload[]> {
  const top: TriviaPoolPayload[] = [];
  for (const p of pool.slice(0, LEAN_TOP)) top.push(await opponentFor(d, p));
  return [...top, ...pool.slice(LEAN_TOP)];
}
