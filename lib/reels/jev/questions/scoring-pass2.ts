import { score } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';
import {
  AUDIENCE_RULE,
  ELEMENT_RULE,
  SOURCE_RULE,
} from '@/lib/reels/jev/questions/scoring-shared';

/**
 * P-09. Knowledge and entertainment (D-076, D-081).
 * Approved 2026-09-22 (D-086) as `scoring-pass2-v1`; the audience moved to
 * AI-curious viewers plus a builder minority in v2 (D-206). v3 (D-218): both
 * questions carry the same viewer-stake guardrail, since code keeps the
 * higher score and a guardrail on one alone would be routed around. v3 also
 * picks up the narrower Callout meaning from scoring-shared.ts.
 *
 * A second request, after code has chosen the framework and the bucket. The
 * state must include `winning_framework` and `winning_bucket`, each with `name`
 * and `meaning` copied from scoring-shared.ts, plus the same `post_idea` as
 * pass 1. Code uses the higher of the two scores.
 */

const SHAPE =
  'The post this would become is shaped by `winning_framework` and `winning_bucket`. Use `winning_bucket.meaning` as the shape. Score the value that shape would communicate, not a different post the source could also support.';

const VIEWER_STAKE =
  'Levels Strong and Unmistakable require that the reason this matters to the viewer can be said in one plain sentence about their own life, or about what is on the line for the people in the story, with no technical setup. If the viewer would first need to learn how a system works to care, the score stays at Workable at most.';

export const SCORING_PASS_2 = defineQuestionSet({
  id: 'scoring-pass2',
  version: 'scoring-pass2-v3',
  questions: {
    knowledge: score(
      {
        question:
          'How much will the viewer care about what this post would teach them, or the time or money it would save them?',
        shape: SHAPE,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
        guardrail: VIEWER_STAKE,
        not_this: 'Do not score how gripping the story is. That is a separate question.',
      },
      [
        'Absent. Told in this bucket, the source would teach nothing new and would save the viewer no time or money.',
        'Thin. A lesson is available, but it is something the viewer already knows, or the savings are speculative and not in the source.',
        'Workable. The viewer would learn something real, or see a plausible saving of time or money. They would care a little. It is not something they would keep.',
        'Strong. The viewer would care. The source supports a lesson they do not already have, or a concrete saving of time or money in their work or daily life.',
        'Unmistakable. They would care a lot. The lesson or the saving is specific, supported, and useful the week they see it. It is the reason to stop.',
      ],
    ),
    entertainment: score(
      {
        question:
          'How much will the viewer care about the story, person, tension, or reveal this post would deliver?',
        shape: SHAPE,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
        guardrail: VIEWER_STAKE,
        not_this: 'Do not score the lesson or the savings. That is a separate question.',
      },
      [
        'Absent. Told in this bucket, nothing here would hold a viewer for the story, the person, or the tension. There is no reveal to stay for.',
        'Thin. There is a hint of a story, but the viewer would not care how it turns out.',
        'Workable. There is a real scene, person, or turn. The viewer might stay with an ordinary telling. They would not pass it on.',
        'Strong. The viewer would care about the story this bucket would tell. The tension, the person, or the reveal is in the source, and they would want the ending.',
        'Unmistakable. They would care a lot. The story is specific and gripping on the material alone, and staying through it is the reason to stop.',
      ],
    ),
  },
});
