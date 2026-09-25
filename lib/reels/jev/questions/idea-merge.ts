import { choice, noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-07. Do two post ideas cover the same event? (D-071)
 *
 * Sources are placed one at a time against the best single idea, so two ideas
 * can form independently around one event and never meet. On the first live
 * night that happened to the Opus 5.5 release: Jev judged all four items to be
 * the same event, but the two Hacker News posts landed in one idea and
 * TechCrunch plus the release notes in another.
 *
 * Code proposes the pairs; this asks whether to fuse them. Same story rule as
 * P-02 (STY-01 / D-051): one news event or disclosure, not one company.
 */
export const IDEA_MERGE = defineQuestionSet({
  id: 'idea-merge',
  version: 'idea-merge-v1',
  questions: {
    sameEvent: noul(
      'Group A and group B are each a set of sources already judged to cover one story. Are both groups covering the same specific news event or disclosure?',
      {
        true: 'Both groups are about one event: the same launch, release, paper, outage, lawsuit, acquisition, firing, policy change, or incident. Different outlets, a first-party post, and a discussion thread about that one event all belong together.',
        false: 'They are about different events. Sharing a company, a person, a product line, or a model family is not enough. Two separate releases from the same vendor, or a launch and an unrelated lawsuit, are two stories.',
      },
    ),
    action: choice(
      'Should these two groups become one post idea?',
      {
        merge:
          'Yes. They are one story and a single post idea should carry all of these sources.',
        keep_separate:
          'No. They are close enough to look similar but a post about one would not be a post about the other.',
      },
    ),
  },
});
