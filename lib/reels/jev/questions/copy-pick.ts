import { score } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-15. Score one on-screen line the way a first-time viewer would (D-195).
 * Four Scores, judged alone. Code ranks the lines.
 *
 * State is the on-screen copy and nothing else. No source, no bucket, no
 * caption, no other versions. The viewer is an average person scrolling
 * Instagram Reels with the sound off.
 */

const VIEWER =
  'An average person scrolling Instagram Reels with the sound off, who does not work in this field, has never seen this story, and has not opened the caption. `on_screen_copy` is the only text they see. The first line is what they get in the first second. Later lines count only when they add a stake, a figure, or the missing piece. A restatement does not.';

export const COPY_PICK = defineQuestionSet({
  id: 'copy-pick',
  version: 'copy-pick-v1',
  questions: {
    plain: score(
      {
        question: 'From the first line, with no context beforehand, can this person say what happened and to whom?',
        viewer: VIEWER,
        not_this: 'Do not score whether they care or what they would get. That is a separate question.',
      },
      [
        'The first line does not say what this is. It opens on a pronoun that points at nothing, a greeting, "here\'s the thing," or a name only an insider knows.',
        'A viewer can tell this is about technology or a company, and not what happened.',
        'The subject is nameable, but one beat still needs knowledge the words do not give.',
        'On one read, a person who does not work in this field can say what happened and to whom. The first line does that work.',
        'The reading is immediate. The first line names the thing in ordinary words, and nothing later asks the viewer to supply context.',
      ],
    ),
    loop: score(
      {
        question:
          'After this text, how strongly is something specific left unfinished: a cause, a cost, a result, or what happens next?',
        viewer: VIEWER,
        not_this: 'Do not score whether the words are plain or whether the payoff is desirable. That is a separate question.',
      },
      [
        'Nothing is unfinished. The text is a summary, a poster line, or an equation a viewer can nod at and keep scrolling.',
        'Something is vaguely unfinished, such as "you won\'t believe this," with no specific missing piece.',
        'A concrete piece is held back, but a viewer could shrug. Or the next line only repeats the first.',
        'The first line leaves a specific question, and the words make that question obvious. Later lines add a new stake instead of restating.',
        'The unfinished piece is the point of the text. Stopping feels like leaving a gap the viewer could close. A self-contained stat still counts when the implication or the fix is what stays open.',
      ],
    ),
    care: score(
      {
        question:
          'How much would this person care, because the text touches their money, time, status, a practice they might be doing, or a person or company they already recognize?',
        viewer: VIEWER,
        not_this: 'Do not score whether the words are plain or whether a reward is implied. That is a separate question.',
      },
      [
        'Shop talk, a line that could sit on anyone\'s post, or an attack that calls the viewer dumb, lazy, or wrong.',
        'A stake is named and it belongs to a narrow trade the viewer is not in.',
        'Somebody would care: a known company, a sum of money, or a public reversal. The viewer is not in it.',
        'The viewer\'s money, time, status, or a practice they might be doing is on the line, or a person or company they already know. The line could not be swapped onto another post.',
        'The viewer is the subject, or ignoring the line feels like missing something that affects them. The pull is recognition or desire. It is not a scolding and not a task.',
      ],
    ),
    reward: score(
      {
        question:
          'How clearly does staying offer a get they would send to one specific person or save: entertainment, time back, or money made or saved?',
        viewer: VIEWER,
        not_this: 'Do not score whether they understand the words or whether a loop is open. That is a separate question.',
      },
      [
        'Staying promises nothing, or the promise is hype with no object, such as "game-changing" or "you need to see this."',
        'A vague "you should know this," or a task such as "you should stop," with no outcome, time, or money attached.',
        'A viewer can vaguely tell that staying might be interesting or useful. They could not name the get.',
        'The text implies a clear get the viewer would send to one person or save: a story with a turn, time back, or money made or saved. A real figure in the words, not a round vibe, makes it credible.',
        'That get is what the line is for. The viewer can say whether they are being offered entertainment, time, or money, and it is worth the next few seconds. The promise is not bigger than the words can support.',
      ],
    ),
  },
});

export function copyPickState(onScreenCopy: string): { on_screen_copy: string } {
  return { on_screen_copy: onScreenCopy.trim() };
}
