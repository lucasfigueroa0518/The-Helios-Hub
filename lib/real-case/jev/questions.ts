import { noul, score } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * AI News Explained story scoring (RC-26, RC-27), drafted 2026-10-26, awaiting Lucas's approval before
 * any live call. Levels are indexes 0 to 4. Freshness is code's (from the event date); code applies the
 * weights, the bar, the floors and the tie-breaks (lib/real-case/scoring.ts), never the model. Bump a
 * set's version whenever its wording changes.
 *
 * State every story question sees (`storyState`): the term, the story (title, summary, polarity, the
 * event date and place, the act material, the cast, the timeline and the artifacts), and `facts`, the
 * claim texts that passed the source check.
 */
export const STORY_SCORING = defineQuestionSet({
  id: 'news-story-scoring',
  version: 'news-story-scoring-v1',
  questions: {
    stakes: score(
      {
        question: 'How much was really at stake in this story, and for whom?',
        judge:
          'Judge the setup and the fallout against the facts. Reward stories where money, customers, jobs, safety, the law, or public trust were on the line, for people or organizations a broad business audience cares about, and the facts show it. Penalize stories where little was at stake, where the stakes are only asserted, or where they depend on exaggeration.',
      },
      [
        'None. Nothing real was at stake.',
        'Low. A minor inconvenience or a small, contained cost.',
        'Real. Clear consequences for someone, though modest in size.',
        'High. Serious consequences in money, trust, safety, or the law.',
        'Huge. Major consequences that a broad audience would recognize as a big deal.',
      ],
    ),
    turn: score(
      {
        question: 'Does the story turn: a twist, a reversal, an irony, or a surprise a viewer would not see coming?',
        judge:
          'Judge the moment and the fallout as a viewer meets them in order. Reward stories that go wrong in an unexpected way, go surprisingly right, backfire, or reveal something nobody expected, so the viewer wants to know what happens next. Penalize stories that unfold exactly as anyone would predict.',
      },
      [
        'Flat. It unfolds as expected from start to finish.',
        'Slight. A small surprise that most viewers would shrug at.',
        'Clear. A real turn that holds attention.',
        'Strong. A twist or irony that makes the viewer lean in.',
        'Unforgettable. A turn so striking the viewer would retell it.',
      ],
    ),
    scene: score(
      {
        question: 'Is there one concrete moment a viewer can picture, played out in order?',
        judge:
          'Judge the moment, the artifacts, and the timeline. Reward stories with a specific, visual moment: who did what, where, when, and what appeared on a screen or a page, with the order of events clear. Penalize stories that exist only as a summary, a trend, or a statistic, with no moment to show.',
      },
      [
        'None. There is no moment to show, only a summary.',
        'Vague. A moment is implied but nothing specific can be pictured.',
        'Showable. A moment exists with some concrete detail.',
        'Vivid. A clear, specific moment with the detail that matters.',
        'Cinematic. A moment so concrete and visual it plays like a scene.',
      ],
    ),
    reveal: score(
      {
        question: "Once the viewer understands the term's concept, how fully and accurately does it explain why this story happened?",
        judge:
          "Compare the reveal with the moment, the fallout, and how the concept named in the term actually works. Reward stories where the concept's own mechanism is the reason the story happened, accurately described, so that understanding it gives the viewer an \"oh, that is why\" moment. Penalize stories where the concept is only background, where the outcome comes from something else (a side bug, a coincidence, a human mistake any system could suffer), or where the reveal misdescribes how the concept works.",
      },
      [
        'Unrelated. The concept does not explain the story, or is misdescribed.',
        'Background. The concept is present, but something else explains the story.',
        'Partial. The concept explains part of the story; the rest stays open.',
        'Explains. The concept\'s mechanism, accurately described, explains why it happened.',
        'Click. The concept is exactly the answer; the story becomes obvious once its mechanism is understood.',
      ],
    ),
    artifacts: score(
      {
        question: 'How much real, exact evidence from the event can be shown on screen?',
        judge:
          'Judge the artifacts: real words from the event (posts, replies, statements, headlines, filings) copied exactly. Reward stories with short, striking artifacts that show the moment itself. Penalize stories with no artifacts, or only long or dull ones that show nothing a viewer would remember.',
      },
      [
        'None. Nothing from the event can be shown.',
        'Weak. An artifact exists but shows little.',
        'Useful. At least one artifact shows part of the story.',
        'Strong. An artifact shows the moment itself.',
        'Iconic. A short, striking artifact a viewer would screenshot.',
      ],
    ),
    players: score(
      {
        question: 'Can a viewer follow who is involved and what each of them wanted?',
        judge:
          'Judge the cast and the setup. Reward stories whose players are companies, products, and public figures a broad business audience knows, or can grasp in a few words, each with a clear role or goal. Penalize stories that need many players, obscure organizations explained at length, or players with no clear part.',
      },
      [
        'Lost. The viewer cannot tell who is involved or why.',
        'Obscure. The players need long explanation.',
        'Followable. The players are clear after a sentence of context.',
        'Clear. Known or instantly graspable players with clear goals.',
        'Iconic. Household names with obvious goals and a clear conflict.',
      ],
    ),
  },
});

/** The gates: a yes at or above GATE_YES rejects the story, whatever its scores. Same state as scoring. */
export const STORY_GATE = defineQuestionSet({
  id: 'news-story-gate',
  version: 'news-story-gate-v1',
  questions: {
    private_person: noul({
      question: 'Is a private individual, rather than an organization, product, institution, public body, or public figure, at the center of this story?',
      judge:
        'Answer yes when the story is about what one private person did or suffered, so that telling it would single that person out. Answer no when it is about an organization, a product, an institution, a public body, or a public figure acting in a public role, even when private people appear in it by their role.',
    }),
    acts_beyond_facts: noul({
      question: "Does the story's material state any fact about the event that the facts list does not support?",
      judge:
        'Check the cold open, setup, moment, fallout, reveal, since, cast, and timeline against the facts list. Answer yes when any of them states a number, a date, a name, a cause, an outcome, or another detail of the event that no fact in the list supports. General explanation of how the concept works, and the "for you" advice, are not details of the event and do not count.',
    }),
  },
});

export const GATE_YES = 0.5;
/** A noul at or above this counts as "yes, duplicate". */
export const DUPLICATE_YES = 0.5;

const SAME_EVENT_JUDGE =
  'Judge the event, not the wording or the concept. Two stories about the same incident, outage, case, launch, or decision are the same event even when they teach different concepts or tell it differently. Different events that teach the same concept are not duplicates.';

/**
 * Stage 1: one call against every story in the pool or already made.
 * State: { candidate: <story ref>, history: [<story ref>, ...] }
 */
export const STORY_SAME_EVENT_GATE = defineQuestionSet({
  id: 'real-case-same-event-gate',
  version: 'real-case-same-event-gate-v1',
  questions: {
    same_event_as_existing: noul({
      question: 'Is this story about the same real event as any story in the provided history?',
      judge: SAME_EVENT_JUDGE,
    }),
  },
});

export const PAIR_KEYS = ['pair_0', 'pair_1', 'pair_2', 'pair_3', 'pair_4'] as const;
export type PairKey = (typeof PAIR_KEYS)[number];

function pairQuestion(key: PairKey) {
  return noul({
    question: `Is this story about the same real event as the story at incumbents.${key}?`,
    judge: SAME_EVENT_JUDGE,
  });
}

/**
 * Stage 2, only after stage 1 says yes: up to five incumbents per call, to find which one it is.
 * State: { candidate: <story ref>, incumbents: { pair_0: <story ref>, ... } }
 */
export const STORY_SAME_EVENT_PAIRS = defineQuestionSet({
  id: 'real-case-same-event-pairs',
  version: 'real-case-same-event-pairs-v1',
  questions: {
    pair_0: pairQuestion('pair_0'),
    pair_1: pairQuestion('pair_1'),
    pair_2: pairQuestion('pair_2'),
    pair_3: pairQuestion('pair_3'),
    pair_4: pairQuestion('pair_4'),
  },
});

/**
 * A story that would repeat a reel made inside the lookback (RC-09: a story's own term is checked for
 * duplicates against the reels made). State: { candidate: <story ref>, recent: [<story ref>, ...] }
 */
export const STORY_RECENT_LESSON = defineQuestionSet({
  id: 'real-case-recent-lesson',
  version: 'real-case-recent-lesson-v1',
  questions: {
    same_lesson_as_recent: noul({
      question: 'Would this story leave the viewer with substantially the same concept and takeaway as any reel in the provided recent reels?',
      judge:
        'Judge the concept taught and the rule the viewer keeps, not the event or the wording. A different event that teaches the same concept with the same takeaway is the same lesson. Concepts in the same broad area are different lessons when they teach materially different mechanisms.',
    }),
  },
});
