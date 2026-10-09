/**
 * Photo pivot v1 (Lucas, 2026-10-09): when a slide's visual and fallback both
 * leave it without a photo, the Writer's `alt_visuals` (other parts of the
 * slide's own copy that could carry a picture) are the next tries. Jev can't
 * write new ideas (it answers yes/no probabilities and choices only), so it
 * judges the Writer's: which of them are worth searching, in what order.
 *
 *   belongs_k    would a photo of option k sit under this slide without
 *                implying the slide is about someone or something it isn't?
 *   different_k  is option k a visibly different kind of photo from every
 *                request that already failed (not the same search reworded)?
 *   best         which option carries what the slide says best (a choice;
 *                asked only with 2+ options)
 *
 * Jev reads text only. Code consumes the answers (photos/pivot.ts): options
 * under either threshold are dropped, the rest go in `best` order, and each
 * kept option is searched and picked like any other request (identity, 7-day,
 * credit and close-up checks all still apply).
 */
import { choice, noul, type Questions } from '@typesafe-ai/sdk';

import type { JevAsk } from '@/lib/social/jev/client';

export const VERSION = 'photo-pivot@1';

export const THRESHOLDS = {
  /** Below this, the option doesn't belong under the slide. Provisional. */
  BELONGS_MIN: 0.5,
  /** Below this, the option is the same kind of picture as one that already failed. Provisional. */
  DIFFERENT_MIN: 0.5,
} as const;

/** Options per call, and pivots kept per slide. */
export const MAX_OPTIONS = 4;
export const KEEP = 2;

export type PivotState = {
  story: string;
  slide: { position: number; kind: string; headline: string; body: string };
  /** Requests already run for this slide, and how each ended. */
  tried: Array<{ request: string; outcome: string }>;
  photos_already_in_post: Array<{ slide: number; shows: string }>;
  options: Array<{ request: string }>;
};

export const belongsId = (k: number) => `belongs_${k}`;
export const differentId = (k: number) => `different_${k}`;
export const BEST_ID = 'best';
export const optionId = (k: number) => `option_${k}`;

export function buildQuestions(count: number): Questions {
  const questions: Questions = {};
  for (let k = 0; k < count; k++) {
    questions[belongsId(k)] = noul(
      `Would a photo of \`options[${k}].request\` sit comfortably under \`slide\`, in the world of the news in \`story\`, without implying the slide is about a person, company or thing it isn't?`,
      {
        true: 'It belongs: it shows who or what the slide is about, or an everyday scene from the story\'s world that fits what the slide says.',
        false: 'It clearly doesn\'t belong: a person or organization the slide is not about, the words in another sense than the story means, or a scene that contradicts the slide.',
      },
    );
    questions[differentId(k)] = noul(
      `Is a photo of \`options[${k}].request\` a visibly different kind of picture from every request in \`tried\` (not the same subject or scene in other words)?`,
      {
        true: 'A different subject, place or kind of scene from everything that was tried.',
        false: 'The same subject or scene as something already tried, only reworded.',
      },
    );
  }
  if (count > 1) {
    questions[BEST_ID] = choice(
      'Which option would carry what `slide` says best: specific over generic, tied to the slide\'s own words, and different from `photos_already_in_post`?',
      Object.fromEntries(Array.from({ length: count }, (_, k) => [optionId(k), `options[${k}]`])),
    );
  }
  return questions;
}

export type PivotScore = { belongs: number; different: number; best: number };

/** One Jev call: each option's belongs and different probabilities and its best-choice probability, in order. */
export async function photoPivotScores(jev: JevAsk, state: PivotState, subjectId: string): Promise<PivotScore[]> {
  const res = await jev({ state, questions: buildQuestions(state.options.length) }, { version: VERSION, subjectId });
  const best = res.answers[BEST_ID]?.probabilities ?? {};
  return state.options.map((_, k) => ({
    belongs: res.answers[belongsId(k)]?.noul ?? 0,
    different: res.answers[differentId(k)]?.noul ?? 0,
    best: state.options.length > 1 ? best[optionId(k)] ?? 0 : 1,
  }));
}

/** The options worth searching, best first, at most KEEP. Pure. */
export function keepPivots<T>(options: T[], scores: PivotScore[]): T[] {
  return options
    .map((option, k) => ({ option, s: scores[k]! }))
    .filter(({ s }) => s.belongs >= THRESHOLDS.BELONGS_MIN && s.different >= THRESHOLDS.DIFFERENT_MIN)
    .sort((a, b) => b.s.best - a.s.best)
    .slice(0, KEEP)
    .map(({ option }) => option);
}
