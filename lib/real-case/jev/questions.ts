import { noul, score } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * Real Case story scoring (RC-13), drafted 2026-10-26, awaiting Lucas's approval before any live call.
 * Levels are indexes 0 to 4. Code applies the weights, the bar, the floors and the tie-breaks
 * (lib/real-case/scoring.ts), never the model. Bump a set's version whenever its wording changes.
 *
 * State every story question sees (`storyState`): the term, the story (title, summary, polarity and
 * beats), and `facts`, the claim texts that passed the source check.
 */
export const STORY_SCORING = defineQuestionSet({
  id: 'real-case-story-scoring',
  version: 'real-case-story-scoring-v1',
  questions: {
    recognition: score(
      {
        question: 'How quickly would a stranger scrolling past understand the situation this story is about?',
        judge:
          'Judge the incident and the puzzle as a broad business audience meets them, with no context. Reward stories set around a product, service, or moment most of this audience already knows, so the situation is clear within a second. Penalize stories that need an industry, a technology, or an organization explained before the viewer knows what is happening.',
      },
      [
        'Opaque. The viewer cannot tell what the situation is without an explanation.',
        'Niche. Familiar to specialists; most viewers need the setting explained first.',
        'Followable. The setting is understandable after a sentence of context.',
        'Familiar. Most viewers know this kind of product or moment and get it at once.',
        'Instant. Nearly everyone has met this product or moment; the situation is clear within a second.',
      ],
    ),
    tension: score(
      {
        question: 'How much does this story make a viewer need to know what happened and why?',
        judge:
          'Judge the stakes and the strangeness of the outcome in the incident and the puzzle. Reward outcomes that went visibly wrong, or worked when it seemed impossible, with real consequences for money, customers, safety, the law, or public trust, and strange enough that the viewer wants the explanation. Penalize routine events, outcomes nobody would care about, and strangeness that depends on exaggeration.',
      },
      [
        'Flat. Nothing is at stake and nothing is strange.',
        'Mild. A minor problem or a mild curiosity.',
        'Interesting. Real consequences or a real oddity, but the viewer could scroll on.',
        'Gripping. Clear stakes and a strange outcome; the viewer wants the explanation.',
        'Unmissable. High stakes and a startling outcome; the viewer has to know why, and would send it to a friend.',
      ],
    ),
    illumination: score(
      {
        question: 'Once the viewer understands the concept, how fully does the outcome make sense?',
        judge:
          'Compare the click and the steps with the puzzle. Reward stories where the concept is the answer to the puzzle, so that understanding it gives the viewer an "oh, that is why" moment. Penalize stories where the concept is only background, where the explanation leaves the puzzle mostly open, or where the answer depends on details the concept does not cover.',
      },
      [
        'Unrelated. The concept does not explain the outcome.',
        'Background. The concept is present, but something else explains the outcome.',
        'Partial. The concept explains part of the outcome; the rest stays open.',
        'Explains. Understanding the concept makes the outcome make sense.',
        'Click. The concept is exactly the answer; the outcome becomes obvious once its step is understood.',
      ],
    ),
    mechanism_fit: score(
      {
        question: "Does this story teach the concept's own mechanism, or something that merely happened near it?",
        judge:
          "Compare the steps and the click with how the concept named in the term actually works. Reward stories whose outcome comes from the concept's defining step, so that a viewer who learns from the story learns how the concept itself works. Penalize stories whose outcome comes from a side bug, a coincidence, an operator error any system could suffer, or a different concept, and steps or a click that misdescribe how the concept works.",
      },
      [
        'Wrong concept. The story teaches something else, or misdescribes the concept.',
        'Adjacent. The concept is involved, but the outcome comes from something else.',
        "Loose. The concept's step contributed, alongside larger causes.",
        "Direct. The outcome comes from the concept's own step, accurately described.",
        "Textbook. The story is a clean, accurate demonstration of the concept's defining step.",
      ],
    ),
    tellable: score(
      {
        question: 'Can this story and its explanation be told truthfully in about 175 spoken words?',
        judge:
          'Judge the incident, steps, click, other side, and takeaway as one minute of narration for a beginner. Reward events that are simple to tell and explanations that need few new words, with nothing essential left out. Penalize stories that need a long backstory, several actors, many technical terms, or a simplification that would make a fact untrue.',
      },
      [
        'No. It cannot be told in a minute without leaving out or bending what matters.',
        'Strained. It fits only by racing or by cutting essential steps.',
        'Tight. It fits, with some crowding or one simplification that needs care.',
        'Fits. It tells cleanly in a minute with nothing essential cut.',
        'Natural. A short, simple event; the minute has room to breathe.',
      ],
    ),
  },
});

/** The gates: a yes at or above GATE_YES rejects the story, whatever its scores. Same state as scoring. */
export const STORY_GATE = defineQuestionSet({
  id: 'real-case-story-gate',
  version: 'real-case-story-gate-v1',
  questions: {
    private_person: noul({
      question: 'Is a private individual, rather than an organization, product, institution, or public body, at the center of this story?',
      judge:
        'Answer yes when the story is about what one private person did or suffered, so that telling it would single that person out. Answer no when it is about an organization, a product, an institution, or a public body, even when individual people appear in it by their role.',
    }),
    beats_beyond_facts: noul({
      question: "Do the story's beats state any fact about the event that the facts list does not support?",
      judge:
        'Check the incident, puzzle, steps, click, other side, and takeaway against the facts list. Answer yes when any of them states a number, a date, a cause, an outcome, or another detail of the event that no fact in the list supports. General explanation of how the concept works is not a detail of the event and does not count.',
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
