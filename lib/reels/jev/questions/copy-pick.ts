import { score } from '@typesafe-ai/sdk';

import { INSIDER_IDEA_DEFINITION, INSIDER_IDEA_TEST, insiderIdeaList } from '@/lib/reels/copy/insider-ideas';
import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-15. Score one on-screen line the way a first-time viewer would (D-195).
 * Five Scores, judged alone. Code gates on plain and stake and ranks the rest.
 * v3 (D-212, D-215): the plain read judges ideas with the writer's insider
 * list, and a stake score asks whether the viewer can say why it matters.
 *
 * State is the on-screen copy and nothing else. No source, no bucket, no
 * caption, no other versions. The viewer is an average person scrolling
 * Instagram Reels with the sound off.
 */

export const PLAIN_QUESTION =
  'After one read of the whole text, with no context beforehand, can this person say what happened and to whom?';

export const STAKE_QUESTION =
  'After one read of the whole text, could this person say why this matters to them, or what is on the line for the people in it?';

const VIEWER =
  'An average person scrolling Instagram Reels with the sound off. They are curious about AI and may use it at work or at home. They do not work in the field, never read tech news, do not know its jargon, and read at about a sixth-grade level. They have never seen this story and have not opened the caption. `on_screen_copy` is the only text they see, and all of it is the hook. It has two jobs, in this order: they understand what happened and why it matters on one read, and then they want the caption. The first words have to stop them, and every later line has to add the stake, a figure, or the missing piece. A restatement adds nothing.';

const INSIDER_IDEAS = `${INSIDER_IDEA_DEFINITION} The kinds that come up most:\n${insiderIdeaList()}\n${INSIDER_IDEA_TEST} If so, this person does not follow it.`;

/** Five levels per Score, indexes 0 through 4. The rewrite call quotes the level each line landed on. */
export const COPY_PICK_LEGENDS = {
  plain: [
    'The text does not say what this is. It opens on a pronoun that points at nothing, a greeting, or "here\'s the thing," or it turns on a name or an idea only an insider knows.',
    'A viewer can tell this is about technology or a company, and not what happened.',
    'The subject is nameable, but one beat still needs knowledge the words do not give.',
    'On one read, this person can say what happened and to whom.',
    'The reading is immediate. The text names the thing in ordinary words from its first words, and no line asks the viewer to supply context.',
  ],
  stake: [
    'No reason to care is given. The text states a fact about an industry, a company, or a system and stops.',
    'A reason exists only for insiders: people who build AI, invest in it, or follow its companies.',
    'A viewer could work out a reason with some effort, but the text does not say it, or it names the stake in terms only an insider feels.',
    'The text says in plain words what this means for the viewer\'s money, time, safety, work, or the AI they use, or what is on the line for the people in the story.',
    'The reason is immediate and it is theirs. In a story, what the people in it stand to lose or win is something anyone feels at once.',
  ],
  loop: [
    'Nothing is unfinished. The text is a summary, a poster line, or an equation a viewer can nod at and keep scrolling.',
    'Something is vaguely unfinished, such as "you won\'t believe this," with no specific missing piece.',
    'A concrete piece is held back, but a viewer could shrug. Or the next line only repeats the first.',
    'The text leaves a specific question, and the words make that question obvious. Each line adds to the pull instead of restating.',
    'The unfinished piece is the point of the text. Stopping feels like leaving a gap the viewer could close. A self-contained fact still counts when the fix, or what happens next, is what stays open.',
  ],
  care: [
    'Shop talk, a line that could sit on anyone\'s post, or an attack that calls the viewer dumb, lazy, or wrong.',
    'A stake is named and it belongs to a narrow trade the viewer is not in.',
    'Somebody would care: a known company, a sum of money, or a public reversal. The viewer is not in it.',
    'The viewer\'s money, time, status, or a practice they might be doing is on the line, or a person or company they already know. The line could not be swapped onto another post.',
    'The viewer is the subject, or ignoring the line feels like missing something that affects them. The pull is recognition or desire. It is not a scolding and not a task.',
  ],
  reward: [
    'Staying promises nothing, or the promise is hype with no object, such as "game-changing" or "you need to see this."',
    'A vague "you should know this," or a task such as "you should stop," with no outcome, time, or money attached.',
    'A viewer can vaguely tell that staying might be interesting or useful. They could not name the get.',
    'The text implies a clear get the viewer would send to one person or save: a story with a turn, time back, or money made or saved. A real figure in the words, not a round vibe, makes it credible.',
    'That get is what the line is for. The viewer can say whether they are being offered entertainment, time, or money, and it is worth the next few seconds. The promise is not bigger than the words can support.',
  ],
} as const satisfies Record<string, readonly [string, string, string, string, string]>;

export type CopyPickScoreId = keyof typeof COPY_PICK_LEGENDS;

export const COPY_PICK = defineQuestionSet({
  id: 'copy-pick',
  version: 'copy-pick-v3',
  questions: {
    plain: score(
      {
        question: PLAIN_QUESTION,
        viewer: VIEWER,
        insider_ideas: INSIDER_IDEAS,
        not_this: 'Do not score whether they care or what they would get. That is a separate question.',
      },
      COPY_PICK_LEGENDS.plain,
    ),
    stake: score(
      {
        question: STAKE_QUESTION,
        viewer: VIEWER,
        not_this: 'Do not score whether the words are plain or whether something is left unfinished. That is a separate question.',
      },
      COPY_PICK_LEGENDS.stake,
    ),
    loop: score(
      {
        question:
          'After this text, how strongly is something specific left unfinished: how it happened, what to do about it, or what happens next?',
        viewer: VIEWER,
        not_this: 'Do not score whether the words are plain or whether the payoff is desirable. That is a separate question.',
      },
      COPY_PICK_LEGENDS.loop,
    ),
    care: score(
      {
        question:
          'How much would this person care, because the text touches their money, time, status, a practice they might be doing, or a person or company they already recognize?',
        viewer: VIEWER,
        not_this: 'Do not score whether the words are plain or whether a reward is implied. That is a separate question.',
      },
      COPY_PICK_LEGENDS.care,
    ),
    reward: score(
      {
        question:
          'How clearly does staying offer a get they would send to one specific person or save: entertainment, time back, or money made or saved?',
        viewer: VIEWER,
        not_this: 'Do not score whether they understand the words or whether a loop is open. That is a separate question.',
      },
      COPY_PICK_LEGENDS.reward,
    ),
  },
});

export function copyPickState(onScreenCopy: string): { on_screen_copy: string } {
  return { on_screen_copy: onScreenCopy.trim() };
}
