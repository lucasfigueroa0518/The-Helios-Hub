import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-04. The ingest screen (ING-03 / D-033, CLN-01 / D-047).
 *
 * Scope is AI, developer tooling, and AI at work. The audience is developers at
 * every level, founders and executives, and operators (D-020), so "technical
 * enough" is never a reason to drop something.
 *
 * Every question is phrased so that a yes means drop. Low confidence keeps the
 * item, which the caller enforces with a high bar rather than 0.5.
 */
export const INGEST_FILTER = defineQuestionSet({
  id: 'ingest-filter',
  version: 'ingest-filter-v1',
  questions: {
    offTopic: noul(
      'Is this item unrelated to artificial intelligence, software development tooling, and the use of AI in business or operations?',
      {
        true: 'The subject is something else entirely: consumer gadgets, gaming, crypto trading, politics, sports, entertainment, general business news with no AI or developer angle.',
        false: 'It touches AI research or products, developer tools and infrastructure, or how companies and workers actually use AI. Anything a software developer, a founder, or an operations lead would read for work belongs here.',
      },
    ),
    junk: noul(
      'Is this item empty of substance?',
      {
        true: 'Search-engine filler, listicle spam, a pure advertisement, an affiliate roundup, a stub with no content, a paywall or cookie notice captured instead of an article, or boilerplate with no reported facts.',
        false: 'It reports something: an announcement, a release, a finding, an argument, an incident, a set of instructions, or a story.',
      },
    ),
    nonEnglish: noul(
      'Is the main text written in a language other than English?',
      {
        true: 'The body is predominantly not English.',
        false: 'The body is predominantly English. Occasional foreign names, quotes, or code do not count.',
      },
    ),
  },
});
