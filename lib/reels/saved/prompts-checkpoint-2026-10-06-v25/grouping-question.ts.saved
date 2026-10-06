import { choice, noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-02. Merge, link, or leave alone (GRP-02 / D-056).
 *
 * Story identity comes from STY-01 / D-051: the same story is the same news
 * event or disclosure, including same-day explainers and reactions. v2
 * (D-265): a development caused by that event (a response, an apology, an
 * inquiry, a ruling, a fix) is the same story, so a follow-up joins its event. Two items
 * about the same company, person, product, or model family are not the same
 * story unless they are about the same event.
 *
 * Both questions go in one request. Jev answers each independently against the
 * same state, so the Choice is speculative: the caller ignores it unless the
 * same-event Noul clears the bar. One round trip, same logic as asking twice.
 */
export const GROUPING = defineQuestionSet({
  id: 'grouping',
  version: 'grouping-v2',
  questions: {
    sameEvent: noul(
      'Are item A and item B about the same specific news event or disclosure, or one of them a direct development of the other?',
      {
        true: 'Both cover one story: the same launch, release, paper, outage, lawsuit, acquisition, firing, policy change, or incident, or a development that traces directly to that one event, such as a response to it, an apology for it, an inquiry or hearing about it, a ruling on it, or a fix for it. Straight reporting, a same-day explainer, a vendor post, and a discussion thread all count.',
        false: 'They cover different events. Sharing a company, a person, a product line, a model family, or a topic is not enough. A launch and an unrelated lawsuit involving the same company are two stories, and so are two separate releases from the same vendor. A new event that is only about the same subject, rather than caused by the first, is a different story.',
      },
    ),
    relationship: choice(
      'If item A and item B are about the same event, how do they relate?',
      {
        merge:
          'Near-duplicate coverage. Two outlets reporting the same facts about the same event, or the same text republished. Keeping both would add nothing.',
        link:
          'Complementary. Same event, but one adds something the other lacks: the underlying paper or repository, a first-party post behind third-party reporting, history, data, a post-mortem, or a reaction that changes the picture.',
        unrelated:
          'They are not about the same event after all, so they should stay separate.',
      },
    ),
  },
});
