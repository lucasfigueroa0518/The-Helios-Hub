import { score } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';
import {
  AUDIENCE_RULE,
  ELEMENT_RULE,
  SOURCE_RULE,
} from '@/lib/reels/jev/questions/scoring-shared';

/**
 * P-09. Knowledge and entertainment (D-076, D-081).
 * Approved 2026-09-22 (D-086) as `scoring-pass2-v1`.
 *
 * A second request, after code has chosen the framework and the bucket. The
 * state must include `winning_framework` and `winning_bucket`, each with `name`
 * and `meaning` copied from scoring-shared.ts, plus the same `post_idea` as
 * pass 1. Code uses the higher of the two scores.
 */

const SHAPE =
  'The post this would become is shaped by `winning_framework` and `winning_bucket`. Use `winning_bucket.meaning` as the shape. Score the value that shape would communicate, not a different post the source could also support.';

export const SCORING_PASS_2 = defineQuestionSet({
  id: 'scoring-pass2',
  version: 'scoring-pass2-v1',
  questions: {
    knowledge: score(
      {
        question:
          'How much will the hardest-hit audience care about what this post would teach them, or the time or money it would save them?',
        shape: SHAPE,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
        not_this: 'Do not score how gripping the story is. That is a separate question.',
      },
      [
        'Absent. Told in this bucket, the source would teach nothing new and would save none of the audiences time or money.',
        'Thin. A lesson is available, but it is something that audience already knows, or the savings are speculative and not in the source.',
        'Workable. One of the audiences would learn something real, or see a plausible saving of time or money. They would care a little. It is not something they would keep.',
        'Strong. The hardest-hit audience would care. The source supports a lesson they do not already have, or a concrete saving of time or money in their work.',
        'Unmistakable. They would care a lot. The lesson or the saving is specific, supported, and useful the week they see it. It is the reason to stop.',
      ],
    ),
    entertainment: score(
      {
        question:
          'How much will the hardest-hit audience care about the story, person, tension, or reveal this post would deliver?',
        shape: SHAPE,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
        not_this: 'Do not score the lesson or the savings. That is a separate question.',
      },
      [
        'Absent. Told in this bucket, nothing here would hold a viewer for the story, the person, or the tension. There is no reveal to stay for.',
        'Thin. There is a hint of a story, but a viewer in one of the audiences would not care how it turns out.',
        'Workable. There is a real scene, person, or turn. One of the audiences might stay with an ordinary telling. They would not pass it on.',
        'Strong. The hardest-hit audience would care about the story this bucket would tell. The tension, the person, or the reveal is in the source, and they would want the ending.',
        'Unmistakable. They would care a lot. The story is specific and gripping on the material alone, and staying through it is the reason to stop.',
      ],
    ),
  },
});
