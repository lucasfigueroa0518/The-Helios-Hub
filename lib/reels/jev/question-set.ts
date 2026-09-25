import type { Questions } from '@typesafe-ai/sdk';

/**
 * Question sets are versioned TypeScript modules in git (JEV-02 / D-027) so the
 * registry in planning/Trial Reels/BUILD_PLAN.md §8.2 can point at the exact
 * wording that produced a decision.
 *
 * Bump `version` whenever the instructions or criteria change. Never edit a
 * shipped version in place: old logs must keep meaning what they said.
 */
export type QuestionSet<Q extends Questions = Questions> = {
  id: string;
  version: string;
  questions: Q;
};

export function defineQuestionSet<const Q extends Questions>(
  set: QuestionSet<Q>,
): QuestionSet<Q> {
  return set;
}
