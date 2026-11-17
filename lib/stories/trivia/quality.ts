/**
 * What a good "Are you smarter than AI?" question is (AT-55 to AT-57). The one owner of this text:
 * the writer (trivia-write@4) writes to it, the shortener (trivia-shorten@1) keeps to it, Jev
 * (trivia-score@3) scores tests 1 to 4 from it, test 3 ranks the pool (AT-61; no score gates, AT-62), and the fact-check (trivia-check@3) enforces the repeat rule. No examples anywhere: principles only.
 */

export type QualityKey = 'clear' | 'real_guess' | 'point' | 'worth_knowing';
type Test = { name: string; rule: string; check: string; yes: string; no: string };

/** Tests 1 to 4, in scoring order. */
export const QUALITY_TESTS: Record<QualityKey, Test> = {
  clear: {
    name: 'Clear at first read',
    rule: 'In one read, the viewer knows what the question is about and what they are choosing between. Every person, place, thing and event in the question or the options is one most Americans are familiar with; nothing unfamiliar is named, even with an explanation. That includes anyone the question credits for a fact. The options can be weighed as written, without context the question leaves out.',
    check: 'On one read, would most viewers be familiar with everything the question and its options name, understand what is being asked, and be able to weigh the options as written?',
    yes: 'Most Americans are familiar with every person, place, thing and event named, and one read is enough to understand it and weigh the options.',
    no: "Something named is unfamiliar to most Americans, it takes more than one read, or the options can't be weighed without context the question leaves out.",
  },
  real_guess: {
    name: 'A real guess',
    rule: "A viewer who doesn't know the answer has to actually guess: nothing in the wording or the options points to the right one, and each option is one a reasonable viewer might pick.",
    check: "Would a viewer who doesn't know the answer have to actually guess, with every option a believable pick?",
    yes: "Each option is a believable pick, and the answer can't be worked out from how the question or its options are put.",
    no: 'The wording or the options give the answer away, or an option is one nobody would pick.',
  },
  point: {
    name: 'The guess is the point',
    rule: 'What the viewer guesses is one concrete thing and the most interesting part of the fact, and the fact says something true about the world rather than resting on one odd case or a moment that has since stopped mattering.',
    check: 'Is what the viewer is asked to guess one concrete thing and the most interesting part of the fact, and does the fact hold in general rather than resting on one odd case or a moment that has since stopped mattering?',
    yes: 'The thing guessed is the heart of the fact, and the answer holds up in general.',
    no: 'It asks about a side detail, or the answer is a one-off or a moment that no longer matters.',
  },
  worth_knowing: {
    name: 'Worth knowing',
    rule: "The answer lands away from what most viewers expect, at its best overturning something they believed, and it connects to the viewer's own life and is something they'd want to repeat.",
    check: 'Once the answer and its answer line are revealed, would most viewers find that the answer lands away from what they expected, that it connects to their own life, and that it is worth repeating?',
    yes: "They'd be surprised, see their own life in it, and want to pass it on.",
    no: "It's what they expected, it has nothing to do with their life, or they'd shrug.",
  },
};

export const QUALITY_KEYS = Object.keys(QUALITY_TESTS) as QualityKey[];
/** The pool ranks on test 3 alone (AT-61); test 4 still guides the writer but does not rank. */
export const RANK_KEYS: readonly QualityKey[] = ['point'];

/** Test 5: required of the writer; Jev reads the answer line inside worth_knowing. */
const PAYOFF = { name: 'It pays off', rule: 'The answer line tells the viewer why the answer matters to them and goes beyond restating the correct option.' };

/** The definition, as the writer and the shortener read it. */
export const QUALITY_TEXT = `What a good question is. A good question is fair to play and worth playing. These are required.
Fair to play:
1. ${QUALITY_TESTS.clear.name}. ${QUALITY_TESTS.clear.rule}
2. ${QUALITY_TESTS.real_guess.name}. ${QUALITY_TESTS.real_guess.rule}
Worth playing:
3. ${QUALITY_TESTS.point.name}. ${QUALITY_TESTS.point.rule}
4. ${QUALITY_TESTS.worth_knowing.name}. ${QUALITY_TESTS.worth_knowing.rule}
5. ${PAYOFF.name}. ${PAYOFF.rule}`;

/** AT-57, AT-78: the definition of a repeat (the same fact, not the same subject). Each prompt says which list it checks. */
export const REPEAT_RULE = 'A question repeats an earlier one when its answer turns on the same fact. A different question about the same subject is fine.';

/** Tests 1 to 4 as scoring questions, for the writer's own scorecard. */
export const SCORECARD_TEXT = QUALITY_KEYS.map((k) => `- ${k} (test ${QUALITY_KEYS.indexOf(k) + 1}): ${QUALITY_TESTS[k].check} Yes: ${QUALITY_TESTS[k].yes} No: ${QUALITY_TESTS[k].no}`).join('\n');
