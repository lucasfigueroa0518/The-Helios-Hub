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
 * picks up the narrower Callout meaning from scoring-shared.ts. v4 (D-255,
 * D-256): value is scored three ways, useful, important to know, and
 * entertaining, and the guardrail names a person: a model or a test is not one.
 *
 * A second request, after code has chosen the framework and the bucket. The
 * state must include `winning_framework` and `winning_bucket`, each with `name`
 * and `meaning` copied from scoring-shared.ts, plus the same `post_idea` as
 * pass 1. Code uses the highest of the three scores.
 */

const SHAPE =
  'The post this would become is shaped by `winning_framework` and `winning_bucket`. Use `winning_bucket.meaning` as the shape. Score the value that shape would communicate, not a different post the source could also support.';

const VIEWER_STAKE =
  "Levels Strong and Unmistakable require that the reason this matters to the viewer can be said in one plain sentence about the viewer's money, safety, health, work, or tools, or about what is on the line for the people in the story, with no technical setup. A model, a benchmark, or a lab test is not a person. If the viewer would first need to learn how a system works to care, the score stays at Workable at most.";

export const SCORING_PASS_2 = defineQuestionSet({
  id: 'scoring-pass2',
  version: 'scoring-pass2-v4',
  questions: {
    useful: score(
      {
        question:
          'How much would this post save or make the viewer in time or money, or hand them something they can use this week?',
        shape: SHAPE,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
        guardrail: VIEWER_STAKE,
        not_this: 'Do not score what the viewer would learn about the world, or how gripping the story is. Those are separate questions.',
      },
      [
        'Absent. Told in this bucket, the source would save the viewer no time or money and give them nothing to use.',
        'Thin. A benefit is possible, but it is speculative, not in the source, or only for people who build with AI.',
        'Workable. A real saving or a usable tool or method is in the source. The viewer would find it handy, but they would not act on it soon.',
        'Strong. The source supports a concrete saving of time or money, or a tool or method the viewer could use this week.',
        'Unmistakable. The saving or the tool is specific, supported, and worth acting on the day they see it. It is the reason to stop.',
      ],
    ),
    knowledge: score(
      {
        question:
          'How much does this post tell the viewer something worth knowing about money, safety, health, work, productivity, or the tools they use?',
        shape: SHAPE,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
        guardrail: VIEWER_STAKE,
        not_this: 'Do not score time or money the viewer would save, or how gripping the story is. Those are separate questions.',
      },
      [
        'Absent. Told in this bucket, the source would change nothing the viewer knows about anything that touches them.',
        'Thin. It is news about the AI industry, a lab, or a benchmark, and nothing in it reaches the viewer.',
        'Workable. Something real reaches the viewer, but they could skip it and lose nothing.',
        'Strong. The viewer would want to know this. It changes what they would do or believe about their money, safety, health, work, productivity, or the tools they use.',
        'Unmistakable. Missing this could cost them. It is specific, supported, and the reason to stop.',
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
        not_this: 'Do not score what the viewer would learn or what they would save or use. Those are separate questions.',
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
