import { noul, score } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * Explainers curiosity gap scoring (EX3-120; Lucas, 2026-10-22: "the curiosity gap writer should now
 * write 3 candidates that jev then picks"). Question, state fields, judge rule, and level text are the
 * register's verbatim (planning/Explainer Reels/DECISIONS.md, "Gap scoring v2");
 * tests/explainers-questions.test.ts fails if they drift. Levels are indexes 0 to 4. Each candidate
 * gets the three questions in one call and the accuracy gate in another; code applies the weights,
 * the floors and the tie-breaks (lib/explainers/ideas/gap.ts), never the model. v2 (3.9, EX3-123):
 * closable is judged against the named analogy and its mapping, not a scene and its process.
 */
export const GAP_SCORING = defineQuestionSet({
  id: 'explainers-gap-scoring',
  version: 'explainers-gap-scoring-v2',
  questions: {
    pull: score(
      {
        question: 'How badly would a stranger scrolling past want the answer to this line?',
        judge:
          "Judge the line as the first words a scrolling viewer hears about this technology, with no title and no context. Reward lines that open a gap the viewer feels: a mystery in something they use, a contradiction, real stakes, a surprising number, or a common belief about to be overturned, so that they would stop, stay to the end, comment, or send the reel to a friend. Penalize lines that are generic, obvious, or textbook, that answer themselves, or that ask something nobody wonders about.",
      },
      [
        'Flat. Nobody wonders about this; the viewer scrolls on.',
        'Mild. A fair question, but generic or obvious; little reason to stay.',
        'Curious. The viewer would like to know, and might stay.',
        'Gripping. The viewer wants the answer and stays for it.',
        'Irresistible. The viewer has to know, and would send it to a friend.',
      ],
    ),
    clarity: score(
      {
        question: 'Could a stranger hear this line once and say back what is being asked?',
        judge:
          'Judge the line as heard once, at speaking pace, by a beginner with no context. Reward lines whose situation and question are instantly clear, in everyday words. Penalize lines that need a second listen, lean on jargon or an unexplained term, pack in too much, or leave unclear what the question is actually asking.',
      },
      [
        'Lost. The viewer cannot say what is being asked.',
        'Muddled. The viewer gets the topic but not the question.',
        'Followable. Clear after a moment, with one phrase that slows them down.',
        'Clear. Understood on one listen; the viewer can say the question back.',
        'Crystal. Instantly clear to anyone, in words they already use.',
      ],
    ),
    closable: score(
      {
        question: "Does the analogy answer this line's question?",
        judge:
          "Compare the line's question with the analogy and its mapping in the analogy field. Reward questions the analogy answers directly, so that watching it play out gives the viewer the answer they were promised. Penalize questions the analogy does not touch, answers only in part, or answers with something other than its mechanism.",
      },
      [
        'Unanswered. The analogy says nothing about this question.',
        'Sideways. The analogy touches the topic but not this question.',
        'Partial. The analogy answers part of the question; the rest is left open.',
        'Answered. Watching the analogy play out answers the question.',
        'Perfect. The analogy is exactly the answer, step by step.',
      ],
    ),
  },
});

/** The state every gap question sees. */
export const GAP_SCORING_FIELDS = ['topic_title', 'topic_scope', 'term', 'analogy', 'candidate'] as const;

/**
 * The accuracy gate: a line that states something false is never picked, however much it pulls
 * (gap writer constraint 3, "never invent a statistic, a story or a quote"). Verbatim in the register.
 */
export const GAP_GATE = defineQuestionSet({
  id: 'explainers-gap-gate',
  version: 'explainers-gap-gate-v1',
  questions: {
    false_claim: noul({
      question: 'Does this line state or imply anything false, exaggerated, or unverifiable about the technology, its numbers, or the people who use it?',
      judge:
        'Check every fact, number, and claim in the candidate line against what is true of the technology in topic_title and topic_scope. Answer yes when any of them is false, exaggerated beyond what is true, or an invented statistic, story, or quote that cannot be checked. Answer no when every claim is true and checkable, or when the line makes no factual claim beyond an everyday situation.',
    }),
  },
});
