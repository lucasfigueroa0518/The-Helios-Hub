/**
 * trivia-score@3 (AT-55, AT-56): Jev's scorecard, tests 1 to 4 of what a good
 * question is. The wording lives only in quality.ts; the writer answers the
 * same questions on the same 0–1 scale in its own output. Both readers see the
 * viewer from TRIVIA_AUDIENCE. Bump the version on any change.
 */
import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

import { TRIVIA_AUDIENCE } from './audience';
import { QUALITY_TESTS, type QualityKey } from './quality';

const STATE = `${TRIVIA_AUDIENCE} The state holds one question of "Are you smarter than AI?", an Instagram Story trivia series, as this viewer sees it: the question, its options, the correct option, and the answer line shown after the reveal.`;

/** The viewer comes first, so "most viewers" reads against the profile above. */
const q = (k: QualityKey) => noul(`${STATE} ${QUALITY_TESTS[k].check}`, { true: QUALITY_TESTS[k].yes, false: QUALITY_TESTS[k].no });

export const TRIVIA_SCORE = defineQuestionSet({
  id: 'trivia-score',
  version: 'trivia-score@3',
  questions: {
    clear: q('clear'),
    real_guess: q('real_guess'),
    point: q('point'),
    worth_knowing: q('worth_knowing'),
  },
});
