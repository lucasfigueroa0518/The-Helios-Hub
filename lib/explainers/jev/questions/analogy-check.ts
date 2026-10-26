import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * Explainers analogy checks (3.9, EX3-124; replaces analogy scoring v6 and the own-material gate).
 * Questions, judge rules and state fields are the register's verbatim (planning/Explainer
 * Reels/DECISIONS.md, "Analogy checks v1"); tests/explainers-questions.test.ts fails if they drift.
 * Jev answers yes or no; code applies the thresholds and the pick (lib/explainers/ideas/analogy.ts),
 * never the model.
 *
 * Jev owns the golden set's leave-one-out (Lucas, 2026-10-25: "make sure Jev is responsible for the
 * leave-one-out strategy"): the golden match decides, by meaning, which golden examples teach the
 * topic's own concept, and those are left out of the writer's prompt. The gates and the comparison
 * never see the golden set.
 */

/** One call per golden example: does it teach the topic's concept? Hidden at GOLDEN_HIDE_AT or more. */
export const GOLDEN_MATCH = defineQuestionSet({
  id: 'explainers-golden-match',
  version: 'explainers-golden-match-v1',
  questions: {
    same_concept: noul({
      question: 'Does this example analogy teach the same concept as the topic?',
      judge:
        "Compare the concept the example was written for with the topic's title and learning objective. Answer yes when a viewer would learn essentially the same idea from both, even if the names differ; answer no when they are different concepts, even related ones.",
    }),
  },
});

export const GOLDEN_MATCH_FIELDS = ['topic_title', 'topic_scope', 'example_concept', 'example'] as const;

/** One call per candidate, three questions. A candidate fails a gate at ANALOGY_GATE_MAX or more. */
export const ANALOGY_GATES = defineQuestionSet({
  id: 'explainers-analogy-gates',
  version: 'explainers-analogy-gates-v1',
  questions: {
    false_mapping: noul({
      question: "Does any row of this analogy's mapping teach something false or misleading about how the concept works?",
      judge:
        "Check each row of the analogy's mapping, and its explanation, against how the concept in topic_title and topic_scope really works. Answer yes when any row would leave a viewer believing something false about the concept, or when a part of the analogy behaves differently from the part of the concept it stands for. Answer no when every row is true of the concept.",
    }),
    is_the_system: noul({
      question: 'Is this analogy the real system itself at work, rather than a comparison to something else?',
      judge:
        'Answer yes only when the scene is the actual technology doing its actual job: the real software, model, data or messages, shown working. Everyday things that resemble the concept\'s material (paper, a letter, a note, a conversation) are a comparison, so the answer is no.',
    }),
    real_names: noul({
      question: 'Does this analogy name a real brand, company, product, real person, or a character from a film, show or book?',
      judge:
        "Read the analogy's name, explanation and mapping. Answer yes when any of them names a real company, store, brand or product, a real person, or a character from a film, show or book. Answer no when everything it names is generic: kinds of things, places and jobs, open standards, and brand names that have become the everyday word for a kind of thing everyone knows.",
    }),
  },
});

export const ANALOGY_GATE_FIELDS = ['topic_title', 'topic_scope', 'term', 'analogy'] as const;

/** Asked twice per pair, with a and b swapped, so neither gains from going first. */
export const ANALOGY_COMPARE = defineQuestionSet({
  id: 'explainers-analogy-compare',
  version: 'explainers-analogy-compare-v1',
  questions: {
    a_over_b: noul({
      question: 'Would a viewer be more likely to remember this analogy and repeat it to a friend than the other one?',
      judge:
        "Analogy a and analogy b were both written to teach the concept in topic. Picture a viewer who meets one of them in a one-minute reel. Answer yes when that viewer would be more likely to get a at once, remember it a week later and repeat it to a friend than b; answer no when b is the one they would remember and repeat.",
    }),
  },
});

export const ANALOGY_COMPARE_FIELDS = ['topic', 'a', 'b'] as const;
