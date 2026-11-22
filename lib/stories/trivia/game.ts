/**
 * "Are you Smarter Than AI?" web game days (AT-76 to AT-79; planning/AI Trivia/Game/HUB-PLAN.md): the pure choices the
 * game day builder makes. No database and no model calls here; the builder (after the per-type engine split) feeds
 * these the pool questions that passed the fact-check, each with the opponent's stored answer.
 *
 *   choose   5 questions so the AI (GPT-5 nano) scores AI_RIGHT_TARGET (4) when the candidates allow: the best AI-right
 *            questions and the best AI-wrong ones by pool score. Never trades a question for a lower-scored one of
 *            the same kind. A question the opponent could not answer is not eligible (the site shows its pick).
 *            The target is an aim, not a gate (RT-3): when the check budget runs out first, the day keeps 3 or 5.
 *   more     whether checking one more candidate could still improve the day (MAX_GAME_CHECKS fact-checks a day)
 *   order    easiest first: the higher fair-shot score first (tests 1 and 2, writer and Jev); on a tie, AI-right first
 */
import { aiRight } from './lean';
import type { TriviaPoolPayload } from './types';

export const GAME_SIZE = 5;
/** The AI should usually score 4 of 5 (RT-3, 2026-11-19; was 3 under AT-79). */
export const AI_RIGHT_TARGET = 4;
/** Fact-checks the builder may spend on one game day (15 since 2026-11-22: about a third fail, and a day must not run short). */
export const MAX_GAME_CHECKS = 15;

export type GameChoice = {
  /** In pool score order within each kind; not yet in play order (orderEasiestFirst). */
  chosen: TriviaPoolPayload[];
  aiRight: number;
  /** GAME_SIZE questions with AI_RIGHT_TARGET of them AI-right. */
  balanced: boolean;
};

const byScore = (a: TriviaPoolPayload, b: TriviaPoolPayload) => b.score - a.score;

/** Pick the day's questions from candidates that passed the fact-check. */
export function chooseGameDay(passed: readonly TriviaPoolPayload[]): GameChoice {
  const right = passed.filter((p) => aiRight(p) === true).sort(byScore);
  const wrong = passed.filter((p) => aiRight(p) === false).sort(byScore);
  let r = Math.min(AI_RIGHT_TARGET, right.length);
  const w = Math.min(GAME_SIZE - r, wrong.length);
  // Too few AI-wrong questions: fill the rest with AI-right ones rather than run short.
  r = Math.min(right.length, GAME_SIZE - w);
  const chosen = [...right.slice(0, r), ...wrong.slice(0, w)];
  return { chosen, aiRight: r, balanced: chosen.length === GAME_SIZE && r === AI_RIGHT_TARGET };
}

/** Whether to fact-check one more candidate: the day is short or unbalanced, and the check budget has room. */
export function wantsMore(choice: GameChoice, checksSpent: number): boolean {
  return checksSpent < MAX_GAME_CHECKS && !choice.balanced;
}

/** Fair-shot score: the mean of the writer's and Jev's scores on tests 1 and 2 (clear, a real guess). */
export function fairShot(p: TriviaPoolPayload): number {
  const v = [p.q.writerScore.clear, p.q.writerScore.real_guess, p.jevScore.clear, p.jevScore.real_guess];
  return v.reduce((s, x) => s + x, 0) / v.length;
}

/** Play order: easiest first (higher fair-shot first); on a tie, the AI-right question first. */
export function orderEasiestFirst(qs: readonly TriviaPoolPayload[]): TriviaPoolPayload[] {
  return [...qs].sort((a, b) => fairShot(b) - fairShot(a) || Number(aiRight(b) === true) - Number(aiRight(a) === true));
}
