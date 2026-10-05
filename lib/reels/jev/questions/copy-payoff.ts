import { score } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-19. Payoff, asked only for a Ball Knowledge line, in the same request as
 * the copy pick (D-231). The screen names what the viewer would get, including
 * the shape of that thing, and holds the specific names for the caption
 * (D-232). Code uses this score in plain read's place. Stake, word count,
 * and same story stay. `copy-payoff-v1` is retired.
 *
 * State is the on-screen copy and nothing else.
 */

export const PAYOFF_QUESTION =
  'After one read of the whole text, can this person say what they would get, in money, time, or a job they already do, and the shape of that thing, a repo, a piece of software, or a skill, without being told the specific name?';

const VIEWER =
  'An average person scrolling Instagram Reels with the sound off. They are curious about AI and may use it at work or at home. They do not work in the field, never read tech news, do not know its jargon, and read at about a sixth-grade level. They have never seen this post and have not opened the caption. `on_screen_copy` is the only text they see.';

/** Five levels, indexes 0 through 4. 0.75 is index 3. */
export const PAYOFF_LEGEND = [
  'No payoff is named, and no shape is named. The text is a product name, a feature, or the bare claim that something exists.',
  'The payoff is only for someone who builds with AI: tokens, a command line, a local model, a benchmark.',
  'A viewer could guess a benefit, or could guess the shape. The text does not say both.',
  'The text names the shape, a repo, a piece of software, or a skill, and says the get in plain words: what it replaces, what the viewer pays now, or what it lets them do. They can say both without the specific name.',
  'The shape and the get are the whole line. This person can say the kind of thing and the number or the job without reading it again.',
] as const;

export const COPY_PAYOFF = defineQuestionSet({
  id: 'copy-payoff',
  version: 'copy-payoff-v2',
  questions: {
    payoff: score(
      {
        question: PAYOFF_QUESTION,
        viewer: VIEWER,
        not_this:
          'Do not score whether they can retell a news event. Do not raise the score because a specific product is named. A strong line names the shape and withholds the specific name. Do not score whether something is left unfinished.',
      },
      PAYOFF_LEGEND,
    ),
  },
});
