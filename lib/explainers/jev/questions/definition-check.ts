import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * The definition check (Explainers 4.1, principles.md §5 "Keep the mapping straight"; ChatGPT's
 * review of the cache reel: "the copy is called the cache, but the fridge is the cache"). Frame 3's
 * definition and the analogy must name the same part as the term: when the analogy's mapping says
 * the fridge is the cache, a definition that says "a cache is a saved copy" teaches a second,
 * different thing. Asked once after the plan, with the understanding test
 * (lib/explainers/render/understanding.ts checkDefinitionMapping); a "no" (below
 * UNDERSTANDING_MIN) is a blocking finding that goes to the fix session.
 *
 * Question, judge rule and state fields are the register's verbatim (planning/Explainer
 * Reels/DECISIONS.md, "Definition check v1"); tests/explainers-questions.test.ts fails if they drift.
 * Jev answers yes or no; code applies the threshold.
 */
export const DEFINITION_CHECK = defineQuestionSet({
  id: 'explainers-definition-check',
  version: 'explainers-definition-check-v1',
  questions: {
    same_part: noul({
      question: 'Do the reel\'s definition and its analogy call the same thing the term?',
      judge:
        "Read term; definition_line, what the voice says the term is in the reel's definition beat, and definition_card, the dictionary card's definition (either may be empty); mapping, the analogy's rows, each 'analogy part = concept part', most important first; term_row, the row whose concept side is the term; and analogy_lines, what the voice says over the analogy. Answer yes when the definition defines the very thing term_row's analogy part stands for, and analogy_lines call that same part the term, so a viewer who learns the analogy and then the definition pictures one thing. Answer no when the definition describes what another row's part stands for, a byproduct, a property or a step of it, or a broader or narrower thing, or when analogy_lines call a different part the term: if the fridge stands for the cache, a definition that says a cache is a saved copy fails.",
    }),
  },
});

export const DEFINITION_CHECK_FIELDS = ['term', 'definition_line', 'definition_card', 'mapping', 'term_row', 'analogy_lines'] as const;
