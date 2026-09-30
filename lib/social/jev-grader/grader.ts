/**
 * Jev grader — one `systemOne` call per draft. Returns per-question
 * calibrated probabilities and the pass rule verdict. See
 * docs/JEV-GRADING-PASS.md for the design.
 */

import { TypeSafeClient, noul } from '@typesafe-ai/sdk';

import { jevCostUsd } from '@/lib/social/editorial/config';

import {
  GRADER_VERSION,
  POST_QUESTIONS,
  buildQuestionSet,
  evaluatePass,
  REWRITE_FEEDBACK,
  slideEarnsPlaceQuestion,
  slideFeedback,
  type PassRuleResult,
  type PostQuestionId,
} from './questions-2026-09-29';
import { type JevState } from './state';

let cachedClient: TypeSafeClient | null = null;
function client(): TypeSafeClient {
  if (!cachedClient) cachedClient = new TypeSafeClient();
  return cachedClient;
}

export type JevGradeResult = {
  version: string;
  probabilities: Record<string, number>;
  verdict: PassRuleResult;
  /** Concatenated rewrite instructions to hand to the Writer as
   *  REVIEWER NOTES on a Jev-triggered rewrite. Empty when passed. */
  rewriteFeedback: string;
  usage: {
    inputTokens: number;
    approxCostUsd: number;
    model: string;
  };
};

export type JevGradeInput = {
  state: JevState;
};

/**
 * Deps injection surface. The default hits the live TypeSafe API; tests
 * pass a stub that returns canned probabilities so unit runs cost $0.
 */
export type JevGraderDeps = {
  systemOne: (args: {
    state: { context: string };
    questions: Record<string, ReturnType<typeof noul>>;
  }) => Promise<{
    answers: Record<string, { noul: number }>;
    usage?: { inputTokens?: number };
    model?: string;
  }>;
};

const defaultDeps: JevGraderDeps = {
  systemOne: (args) => client().systemOne(args) as unknown as ReturnType<JevGraderDeps['systemOne']>,
};

export async function jevGrade(
  input: JevGradeInput,
  depsOverride: Partial<JevGraderDeps> = {},
): Promise<JevGradeResult> {
  const deps: JevGraderDeps = { ...defaultDeps, ...depsOverride };
  const questions = buildQuestionSet(input.state.storySlidePositions);

  // Build the systemOne question map. Every question shares the same
  // `state.context` (the reader-visible post); systemOne answers all
  // questions from that context in one round-trip.
  const noulMap: Record<string, ReturnType<typeof noul>> = {};
  for (const q of questions) {
    noulMap[q.id] = noul(q.instructions, { true: q.true, false: q.false });
  }

  const response = await deps.systemOne({
    state: { context: input.state.serialized },
    questions: noulMap,
  });

  const probabilities: Record<string, number> = {};
  for (const q of questions) {
    const a = response.answers[q.id];
    probabilities[q.id] = a ? a.noul : 0;
  }

  const verdict = evaluatePass(probabilities, input.state.storySlidePositions);
  const rewriteFeedback = buildRewriteFeedback(verdict);

  const inputTokens = response.usage?.inputTokens ?? 0;
  return {
    version: GRADER_VERSION,
    probabilities,
    verdict,
    rewriteFeedback,
    usage: {
      inputTokens,
      approxCostUsd: jevCostUsd({ inputTokens }),
      model: response.model ?? 'jev',
    },
  };
}

function buildRewriteFeedback(verdict: PassRuleResult): string {
  if (verdict.passed) return '';
  const lines: string[] = [];
  for (const id of verdict.postFailures) lines.push(`- ${REWRITE_FEEDBACK[id]}`);
  for (const pos of verdict.slideFailures) lines.push(`- ${slideFeedback(pos)}`);
  return lines.join('\n');
}
