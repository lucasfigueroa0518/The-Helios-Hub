/**
 * "Are you smarter than AI?" (series ai_trivia; PLAN.md Stage 5; AT-2, AT-16, AT-22, AT-41 to AT-58). The daily writer
 * (lib/stories/trivia/daily.ts) fills the pool; this builder posts from it:
 *
 *   lean        the opponent answers the top 3 (each question only ever once, stored on its row); the last 6 sets
 *               decide whether one it missed or one it got right goes first, so it wins about half (AT-75)
 *   pick        the pool's top open question (queue order when the build hands one in), after the lean
 *   order       questions the game already served first, then the unused bank, so the story never eats into what the
 *               game can still play (2026-11-22)
 *   repeats     one fact, one question (lib/stories/trivia/repeats.ts): a question code finds repeats an earlier one is
 *               archived without a fact-check
 *   fact-check  trivia-check@5 (≤3 web searches; also fails a repeat of an earlier fact on the list repeats.ts gives, AT-57, AT-78).
 *               Anything short of a clean pass archives the question (stories.trivia_archive) and
 *               drops its pool row; the next one is tried, up to 5.
 *               None passes → the day is skipped, the record lands on the set
 *               as triviaSkip
 *   critter     trivia-direct@1 dresses the on-screen critter for the question (direction.ts)
 *   frames      question + answer, each carrying the whole question as copy
 *               only (no photo, no music: CONTRACT-2 §3); the renderer adds
 *               the fixed copy, the motion and the one fixed sound
 */
import { openPool, servedTriviaKeys } from '@/lib/stories/pool';
import { material } from '@/lib/stories/prompts';
import type { NewCandidate, NewFrame } from '@/lib/stories/repository';
import { directionFrom, type DirectOut } from '@/lib/stories/trivia/direction';
import { checkRepeat, loadEarlier, REPEAT_CHECK_VERSION, repeatFail } from '@/lib/stories/trivia/repeats';
import { answerTop, LEAN_TOP, leanFrom, leanOrder, opponentFor, recentAiResults, type Lean } from '@/lib/stories/trivia/lean';
import type { Opponent } from '@/lib/stories/trivia/opponent';
import { TRIVIA_CHECK, TRIVIA_CHECK_SEARCHES, TRIVIA_DIRECT, type TriviaCheckMaterial, type TriviaCheckOut, type TriviaDirectMaterial } from '@/lib/stories/trivia/prompts';
import { poolKeyOf, TRIVIA_SERIES, type FactCheck, type TriviaFrameCopy, type TriviaPoolPayload, type TriviaSetPayload } from '@/lib/stories/trivia/types';
import { writeStructured } from '@/lib/stories/writer';

import type { BuildDeps, BuildResult } from './common';

export const MAX_CHECKS = 5;

export type TriviaTry = { key: string; cellId: string; question: string; score: number; verdict: 'pass' | 'fail' | 'error'; problems: string[] };
export type TriviaSkipRecord = { poolOffered: number; tried: TriviaTry[] };

const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : []);

/** A clean pass only: verdict pass with no problems listed. Anything else is a fail. */
export function toFactCheck(out: TriviaCheckOut): FactCheck {
  const problems = lines(out?.problems);
  const sources = lines(out?.sources);
  if (out?.verdict === 'pass' && !problems.length) return { verdict: 'pass', problems: [], sources };
  return { verdict: 'fail', problems: problems.length ? problems : [`verdict ${String(out?.verdict)}`], sources };
}

/** Archive a question that failed its fact-check: out of the pool (its cell's writer still sees it as asked). */
export async function archiveTrivia(deps: Pick<BuildDeps, 'db'>, p: TriviaPoolPayload, fc: FactCheck): Promise<void> {
  const key = poolKeyOf(p.q);
  await deps.db.query(`INSERT INTO stories.trivia_archive (key, cell_id, payload, reason) VALUES ($1, $2, $3::jsonb, $4)`, [key, p.q.cellId, JSON.stringify({ ...p, factCheck: fc }), `fact-check: ${fc.problems.join('; ')}`]);
  await deps.db.query(`DELETE FROM stories.pool WHERE series = $1 AND key = $2 AND used_at IS NULL`, [TRIVIA_SERIES, key]);
}

async function recordTriviaSkip(deps: BuildDeps, rec: TriviaSkipRecord): Promise<void> {
  try {
    console.log(`trivia-skip ${deps.setId} ${JSON.stringify(rec)}`);
  } catch {
    /* logging is best effort */
  }
  try {
    await deps.db.query(`UPDATE stories.sets SET payload = payload || $2::jsonb WHERE id = $1`, [deps.setId, JSON.stringify({ triviaSkip: rec })]);
  } catch {
    /* recording is best effort: a failed write must not turn a skip into a failure */
  }
}

export async function buildAiTrivia(deps: BuildDeps): Promise<BuildResult> {
  const log: string[] = [];
  const open = deps.pool?.trivia ?? (await openPool(deps.db, TRIVIA_SERIES)).trivia ?? [];
  // Served questions first (each group keeps its order): the unused bank is the game's.
  const servedKeys = await servedTriviaKeys(deps.db);
  const scored = [...open.filter((p) => servedKeys.has(poolKeyOf(p.q))), ...open.filter((p) => !servedKeys.has(poolKeyOf(p.q)))];
  const earlier = await loadEarlier(deps.db);
  // 0. The opponent lean (AT-75): the opponent answers the top questions (each only ever once), and the last
  //    sets decide whether a question it missed or one it got right goes first, so it wins about half the time.
  let pool = scored;
  let lean: Lean = null;
  // Questions already put to the opponent in this build (answered or not): never asked twice.
  const putToOpponent = new Set<string>();
  if (deps.opponent) {
    const d = { db: deps.db, setId: deps.setId, opponent: deps.opponent };
    try {
      lean = leanFrom(await recentAiResults(deps.db, deps.setId));
      for (const p of scored.slice(0, LEAN_TOP)) putToOpponent.add(poolKeyOf(p.q));
      pool = leanOrder(await answerTop(d, scored), lean);
    } catch (err) {
      log.push(`opponent lean skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    log.push(`opponent lean: ${lean ?? 'none'}; order ${pool.slice(0, 3).map((p) => `${p.q.cellId}${p.opponent ? (p.opponent.picked === p.q.correct ? ' (AI right)' : ' (AI wrong)') : ''}`).join(', ')}`);
  }
  const tried: TriviaTry[] = [];
  const candidates: NewCandidate[] = [];
  let picked: { p: TriviaPoolPayload; fc: FactCheck } | null = null;

  // 1. Fact-check from the top, up to MAX_CHECKS questions.
  for (const p of pool) {
    if (tried.length >= MAX_CHECKS) break;
    const q = p.q;
    const key = poolKeyOf(q);
    const base = { key, cellId: q.cellId, question: q.question, score: p.score };
    const r = checkRepeat(earlier, p);
    if (r.repeat) {
      const fc = repeatFail(r.repeat);
      candidates.push({ origin: 'model', ref: key, payload: { q, factCheck: fc }, jev: p.jevScore, score: p.score, chosen: false, reason: 'repeat' });
      log.push(`${key}: ${fc.problems[0]}`);
      await archiveTrivia(deps, p, fc);
      continue;
    }
    const mat: TriviaCheckMaterial = { question: q.question, options: q.options, correct: q.correct, answer_line: q.answerLine, sources: q.sources, asked: r.asked };
    let fc: FactCheck;
    try {
      const out = (await writeStructured<TriviaCheckOut>({
        create: deps.write, db: deps.db, setId: deps.setId, component: 'trivia-check', model: deps.settings.models.copy,
        system: TRIVIA_CHECK.system, tool: TRIVIA_CHECK.tool, user: material(mat), webSearch: { maxUses: TRIVIA_CHECK_SEARCHES },
      })).value;
      fc = { ...toFactCheck(out), repeats: REPEAT_CHECK_VERSION };
    } catch (err) {
      // No verdict (an API error): the question stays in the pool for another day.
      const msg = err instanceof Error ? err.message : String(err);
      tried.push({ ...base, verdict: 'error', problems: [msg] });
      candidates.push({ origin: 'model', ref: key, payload: { q, error: msg }, jev: p.jevScore, score: p.score, chosen: false, reason: 'fact-check error' });
      continue;
    }
    tried.push({ ...base, verdict: fc.verdict, problems: fc.problems });
    candidates.push({ origin: 'model', ref: key, payload: { q, factCheck: fc }, jev: p.jevScore, score: p.score, chosen: fc.verdict === 'pass', reason: fc.verdict === 'pass' ? null : 'fact-check fail' });
    if (fc.verdict === 'pass') {
      picked = { p, fc };
      break;
    }
    await archiveTrivia(deps, p, fc);
  }

  if (!picked) {
    const rec: TriviaSkipRecord = { poolOffered: pool.length, tried };
    await recordTriviaSkip(deps, rec);
    const why = tried.map((t) => `${t.cellId}: ${t.verdict}`).join(', ') || 'pool empty';
    return { ok: false, skip: `no AI Trivia question passed its fact-check (${why})`, candidates };
  }

  const { p, fc } = picked;
  const q = p.q;
  // 2. The opponent's one answer (AT-74): stored on its pool row, or asked now. No answer: the set shows no opponent.
  let opponent: Opponent | null = p.opponent ?? null;
  if (!opponent && deps.opponent && !putToOpponent.has(poolKeyOf(q))) {
    try {
      opponent = (await opponentFor({ db: deps.db, setId: deps.setId, opponent: deps.opponent }, p)).opponent ?? null;
    } catch (err) {
      log.push(`opponent skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const shown = opponent ? { opponent: { label: opponent.label, picked: opponent.picked } } : {};

  // 3. The critter's direction. A failed call keeps the default look: the critter is on every set.
  let critter = directionFrom();
  try {
    const mat: TriviaDirectMaterial = { question: q.question, options: q.options, correct: q.correct, answer_line: q.answerLine };
    critter = directionFrom((await writeStructured<DirectOut>({
      create: deps.write, db: deps.db, setId: deps.setId, component: 'trivia-direct', model: deps.settings.models.copy,
      system: TRIVIA_DIRECT.system, tool: TRIVIA_DIRECT.tool, user: material(mat), maxTokens: 4000, effort: 'low',
    })).value);
  } catch (err) {
    log.push(`critter direction fell back to the default: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Two frames, each with the whole question: copy only.
  const copy = (role: TriviaFrameCopy['role']): TriviaFrameCopy => ({ role, question: q.question, options: q.options, correct: q.correct, answerLine: q.answerLine, critter, ...shown });
  const frames: NewFrame[] = [
    { seq: 1, role: 'question', backdrop: 'black', template: 'trivia', copy: copy('question') },
    { seq: 2, role: 'answer', backdrop: 'black', template: 'trivia', copy: copy('answer') },
  ];
  const trivia: TriviaSetPayload = { q, scores: { writer: q.writerScore, jev: p.jevScore, score: p.score }, factCheck: fc, ...(opponent ? { opponent } : {}) };
  return {
    ok: true,
    payload: { trivia, question: q.question, cellId: q.cellId, tried, log },
    frames,
    candidates,
    historyKeys: [poolKeyOf(q)],
  };
}
