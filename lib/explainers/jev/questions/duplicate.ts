import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/** The E-15 duplicate gate's judge text, verbatim. Shared by both stages. */
export const DUPLICATE_JUDGE =
  'Judge semantic learning overlap, not wording overlap. Different hooks, examples, analogies, titles, or phrasing do not make two ideas distinct. Topics within the same broad domain are allowed when they teach materially different mechanisms, distinctions, or layers of understanding.';

/** A noul at or above this probability counts as "yes, duplicate". */
export const DUPLICATE_YES = 0.5;

/**
 * Stage 1 (E-15 duplicate gate, A-3). One call per candidate against the whole
 * history: the current pool plus topics rendered in the lookback window.
 * Question and judge are the packet's verbatim.
 *
 * State: { candidate: {topic_title, topic_scope}, history: [{topic_title, topic_scope}] }
 */
export const DUPLICATE_GATE = defineQuestionSet({
  id: 'explainers-duplicate-gate',
  version: 'explainers-duplicate-gate-v1',
  questions: {
    duplicate_of_existing_topic: noul({
      question:
        'Would this proposed topic teach substantially the same core concept and leave the viewer with substantially the same primary takeaway as any existing topic in the provided history?',
      judge: DUPLICATE_JUDGE,
    }),
  },
});

export const PAIR_KEYS = ['pair_0', 'pair_1', 'pair_2', 'pair_3', 'pair_4'] as const;
export type PairKey = (typeof PAIR_KEYS)[number];

function pairQuestion(key: PairKey) {
  return noul({
    question: `Would this proposed topic teach substantially the same core concept and leave the viewer with substantially the same primary takeaway as the pool topic at incumbents.${key}?`,
    judge: DUPLICATE_JUDGE,
  });
}

/**
 * Stage 2 (A-3), only after Stage 1 says yes. The pool is split into batches
 * of 5; each batch is one call with up to 5 independent pairwise questions,
 * the candidate against one incumbent each. A short last batch sends only the
 * keys it needs. Wording adapts the E-15 duplicate question to one named
 * incumbent; approved by Lucas on 2026-10-07 (R6).
 *
 * State: { candidate: {...}, incumbents: { pair_0: {...}, ... } }
 */
export const DUPLICATE_PAIRS = defineQuestionSet({
  id: 'explainers-duplicate-pairs',
  version: 'explainers-duplicate-pairs-v1',
  questions: {
    pair_0: pairQuestion('pair_0'),
    pair_1: pairQuestion('pair_1'),
    pair_2: pairQuestion('pair_2'),
    pair_3: pairQuestion('pair_3'),
    pair_4: pairQuestion('pair_4'),
  },
});
