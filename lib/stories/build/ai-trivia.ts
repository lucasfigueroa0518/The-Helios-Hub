/**
 * "Are you smarter than AI?" (series ai_trivia; PLAN.md Stage 5; AT-2, AT-16, AT-22, AT-41 to AT-58). The daily writer
 * (lib/stories/trivia/daily.ts) fills the pool; this builder posts from it:
 *
 *   pick        the pool's top open question (queue order when the build hands one in)
 *   fact-check  trivia-check@3 (≤3 web searches; also fails a repeat of a posted fact, AT-57). Anything short of a clean
 *               pass archives the question (stories.trivia_archive), drops its
 *               pool row and frees its cell; the next one is tried, up to 5.
 *               None passes → the day is skipped, the record lands on the set
 *               as triviaSkip
 *   frames      question + answer, each carrying the whole question as copy
 *               only (no photo, no music: CONTRACT-2 §3); the renderer adds
 *               the fixed copy, the motion and the one fixed sound
 *
 * The cell stays reserved until the set publishes (closeCell, at publish).
 */
import { openPool } from '@/lib/stories/pool';
import { material } from '@/lib/stories/prompts';
import type { NewCandidate, NewFrame } from '@/lib/stories/repository';
import { askedQuestions } from '@/lib/stories/trivia/asked';
import { cellState, freeCell } from '@/lib/stories/trivia/cells';
import { TRIVIA_CHECK, TRIVIA_CHECK_SEARCHES, type TriviaCheckMaterial, type TriviaCheckOut } from '@/lib/stories/trivia/prompts';
import { TRIVIA_SERIES, triviaPoolKey, type FactCheck, type TriviaFrameCopy, type TriviaPoolPayload, type TriviaSetPayload } from '@/lib/stories/trivia/types';
import { writeStructured } from '@/lib/stories/writer';

import type { BuildDeps, BuildResult } from './common';

export const MAX_CHECKS = 5;

export type TriviaTry = { key: string; cellId: string; question: string; score: number; verdict: 'pass' | 'fail' | 'error' | 'closed'; problems: string[] };
export type TriviaSkipRecord = { poolOffered: number; tried: TriviaTry[] };

const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : []);

/** A clean pass only: verdict pass with no problems listed. Anything else is a fail. */
export function toFactCheck(out: TriviaCheckOut): FactCheck {
  const problems = lines(out?.problems);
  const sources = lines(out?.sources);
  if (out?.verdict === 'pass' && !problems.length) return { verdict: 'pass', problems: [], sources };
  return { verdict: 'fail', problems: problems.length ? problems : [`verdict ${String(out?.verdict)}`], sources };
}

/** Archive a question that failed its fact-check: out of the pool, its cell open again. */
export async function archiveTrivia(deps: Pick<BuildDeps, 'db'>, p: TriviaPoolPayload, fc: FactCheck): Promise<void> {
  const key = triviaPoolKey(p.q.cellId);
  await deps.db.query(`INSERT INTO stories.trivia_archive (key, cell_id, payload, reason) VALUES ($1, $2, $3::jsonb, $4)`, [key, p.q.cellId, JSON.stringify({ ...p, factCheck: fc }), `fact-check: ${fc.problems.join('; ')}`]);
  await deps.db.query(`DELETE FROM stories.pool WHERE series = $1 AND key = $2 AND used_at IS NULL`, [TRIVIA_SERIES, key]);
  await freeCell(deps.db, p.q.cellId);
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
  const pool = deps.pool?.trivia ?? (await openPool(deps.db, TRIVIA_SERIES)).trivia ?? [];
  const tried: TriviaTry[] = [];
  const candidates: NewCandidate[] = [];
  let picked: { p: TriviaPoolPayload; fc: FactCheck } | null = null;

  // 1. Fact-check from the top, up to MAX_CHECKS questions.
  for (const p of pool) {
    if (tried.length >= MAX_CHECKS) break;
    const q = p.q;
    const key = triviaPoolKey(q.cellId);
    const base = { key, cellId: q.cellId, question: q.question, score: p.score };
    if ((await cellState(deps.db, q.cellId)) === 'closed') {
      // Already posted (a stale row): never offered again, and not counted as a try.
      await deps.db.query(`UPDATE stories.pool SET used_at = $3::timestamptz WHERE series = $1 AND key = $2 AND used_at IS NULL`, [TRIVIA_SERIES, key, deps.now.toISOString()]);
      log.push(`${key}: cell closed, marked used`);
      continue;
    }
    const asked = await askedQuestions(deps.db, { postedOnly: true, exceptKey: key });
    const mat: TriviaCheckMaterial = { question: q.question, options: q.options, correct: q.correct, answer_line: q.answerLine, sources: q.sources, asked };
    let fc: FactCheck;
    try {
      const out = (await writeStructured<TriviaCheckOut>({
        create: deps.write, db: deps.db, setId: deps.setId, component: 'trivia-check', model: deps.settings.models.copy,
        system: TRIVIA_CHECK.system, tool: TRIVIA_CHECK.tool, user: material(mat), webSearch: { maxUses: TRIVIA_CHECK_SEARCHES },
      })).value;
      fc = toFactCheck(out);
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

  // 2. Two frames, each with the whole question: copy only.
  const { p, fc } = picked;
  const q = p.q;
  const copy = (role: TriviaFrameCopy['role']): TriviaFrameCopy => ({ role, question: q.question, options: q.options, correct: q.correct, answerLine: q.answerLine });
  const frames: NewFrame[] = [
    { seq: 1, role: 'question', backdrop: 'black', template: 'trivia', copy: copy('question') },
    { seq: 2, role: 'answer', backdrop: 'black', template: 'trivia', copy: copy('answer') },
  ];
  const trivia: TriviaSetPayload = { q, scores: { writer: q.writerScore, jev: p.jevScore, score: p.score }, factCheck: fc };
  return {
    ok: true,
    payload: { trivia, question: q.question, cellId: q.cellId, tried, log },
    frames,
    candidates,
    historyKeys: [triviaPoolKey(q.cellId)],
  };
}
