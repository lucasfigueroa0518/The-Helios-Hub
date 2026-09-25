import { score } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-06. The A4 editor (SRC-A4 / D-066).
 *
 * The awesome-lists barely change, so waiting for new rows would keep this
 * source type out of the pool for weeks at a time. Instead the lists are a
 * standing catalog and Jev plays the editor each night: given tonight's other
 * headlines, which catalog entries are worth putting on the table? Code owns
 * the shortlist and the nightly floor; Jev only ranks.
 */
export const A4_EDITOR = defineQuestionSet({
  id: 'a4-editor',
  version: 'a4-editor-v1',
  questions: {
    worthTonight: score(
      'Tonight we are choosing which tools from a curated list deserve a fresh look. Given what else is in the news tonight, how strong a candidate is this tool?',
      [
        'Weak. Niche, dated, or of interest to almost nobody in an AI or developer audience right now.',
        'Ordinary. A real tool, but nothing about tonight makes it worth raising.',
        'Good. Genuinely useful to developers, founders, or operators working with AI, and it would stand on its own.',
        'Strong. It connects to something in tonight\u2019s news, or it solves a problem people are actively hitting right now.',
      ],
    ),
  },
});
