/**
 * trivia-score@1 (AT-8, AT-10): the pool's "will viewers care" scorecard.
 * DRAFT until Lucas approves the wording; bump the version on any change.
 *
 * One wording, two readers: Jev answers these questions for each new
 * question, and the writer (trivia-write@1) answers the same text on the same
 * 0–1 scale in its own output. The writer prompt renders SCORECARD, so the
 * wording lives only here.
 */
import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

import type { Scorecard } from './types';

type Item = { instructions: string; yes: string; no: string };

/** The three questions, in Scorecard key order. */
export const SCORECARD: Record<keyof Scorecard, Item> = {
  surprise: {
    instructions: 'Would most viewers who follow AI on Instagram expect a different answer from the true one, so that the reveal surprises them?',
    yes: 'Most viewers would pick a wrong option or expect something else, and the true answer lands as a surprise.',
    no: 'Most viewers would pick the right option, or the answer is what they would expect.',
  },
  about_you: {
    instructions: "Does the fact touch the viewer's own life: something they use, do, pay for, believe, or are?",
    yes: 'A viewer would recognize their own habits, tools, beliefs or situation in it.',
    no: "It is about something far from the viewer's own life.",
  },
  social_currency: {
    instructions: 'Would a viewer want to repeat this fact to someone else, because knowing it makes them look sharp or in the know?',
    yes: 'It is the kind of fact people pass on, and saying it makes the teller look informed.',
    no: 'Few viewers would bother mentioning it to anyone.',
  },
};

const STATE = 'The state holds one AI Trivia question as the viewer sees it: the question, its options, the correct option, and the answer line shown after the reveal.';

const q = (i: Item) => noul(`${i.instructions} ${STATE}`, { true: i.yes, false: i.no });

export const TRIVIA_SCORE = defineQuestionSet({
  id: 'trivia-score',
  version: 'trivia-score@1',
  questions: {
    surprise: q(SCORECARD.surprise),
    about_you: q(SCORECARD.about_you),
    social_currency: q(SCORECARD.social_currency),
  },
});
