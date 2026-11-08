import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/** A noul at or above this probability counts as "yes, the average viewer already knows the word" (familiar). */
export const FAMILIAR_YES = 0.5;
/**
 * Jev overrides the generator's label only when it is confident: below this distance from FAMILIAR_YES (a
 * p_familiar between 0.35 and 0.65) the label stands. Lucas, 2026-11-03: "Yes" (a 0.49 had flipped prompting).
 */
export const ALTITUDE_MARGIN = 0.15;

/**
 * The altitude check (ideas coverage, 2026-11-03; Lucas: "Yes"). Asked with idea scoring for a topic that carries a
 * lesson frame: would the average viewer of this audience already know what the word means? Yes is `familiar`. When
 * it disagrees with the generator's label (familiar or not), Jev wins and the payload is rewritten once
 * (evaluate.ts, `checkAltitude`). `embedded` stays as labelled unless Jev says familiar.
 *
 * State: { topic_title, term, topic_scope, theme_brief }
 */
export const ALTITUDE_CHECK = defineQuestionSet({
  id: 'explainers-altitude-check',
  version: 'explainers-altitude-check-v1',
  questions: {
    viewer_knows_word: noul({
      question: 'Would the average viewer of this audience already know what this word means?',
      judge:
        "Judge the term against the theme brief's audience as a whole, not its most technical members. Yes when most of that audience could say roughly what the word means before watching, even if they could not explain how it works. No when most would not recognise it, or know it only as a name with no meaning attached.",
    }),
  },
});
