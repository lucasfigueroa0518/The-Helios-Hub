/**
 * Photo slide check v2 (Lucas, 2026-10-08): Jev's decision node in the pick
 * (photos/pick.ts), asked once per slide over its shortlist, after the cheap
 * code filters and before the close-up vision check.
 *
 * v1 asked whether each photo illustrates the slide and failed "a generic
 * image that could sit under any slide": on a software-deal story every stock
 * photo is generic, so it scored 0.13–0.41 and the post (StackSocial,
 * 2026-10-08) got no photos at all. v2 gates only what clearly doesn't belong
 * and ranks the rest:
 *
 *   fits_k     does the photo belong under this slide? Fails only a person or
 *              organization the slide isn't about, the request's words in
 *              another sense than the story means, or a scene that
 *              contradicts the slide. An everyday scene from the story's world
 *              passes.
 *   repeats_k  would it read as a repeat of a photo already in the post (the
 *              same face, place, logo or kind of scene)? Code already blocks
 *              the same file and the same person; this catches near-repeats.
 *   best       which candidate suits the slide best (a choice): the pick tries
 *              the passing candidates in this order within each request.
 *
 * Every candidate is asked, verified photos included: verified means the
 * photo is who or what it claims to be, never that it suits the slide.
 * Jev reads text only: the slide's words, the request, and each candidate's
 * source, subject, title and Haiku tags.
 */
import { choice, noul, type Questions } from '@typesafe-ai/sdk';

import type { JevAsk } from '@/lib/social/jev/client';

export const VERSION = 'photo-slide@2';

export const THRESHOLDS = {
  /** Below this, the photo clearly doesn't belong under the slide. Provisional. */
  FIT_MIN: 0.5,
  /** At or above this, the photo reads as a repeat of one already in the post: not used. Provisional. */
  REPEAT_MAX: 0.5,
} as const;

/** Candidates per call. */
export const MAX_CANDIDATES = 8;

export type SlideCandidate = { source: string; subject: string | null; title: string; tags: string[] };

export type SlideState = {
  story: string;
  slide: { position: number; kind: string; headline: string; body: string; request: string };
  photos_already_in_post: Array<{ slide: number; shows: string }>;
  candidates: SlideCandidate[];
};

export const fitId = (k: number) => `fits_${k}`;
export const repeatId = (k: number) => `repeats_${k}`;
export const BEST_ID = 'best';
export const candId = (k: number) => `candidate_${k}`;

const describe = (c: SlideCandidate) => [c.source, c.subject ? `of ${c.subject}` : '', c.title ? `"${c.title.slice(0, 80)}"` : '', c.tags.length ? `[${c.tags.join(', ')}]` : ''].filter(Boolean).join(' ');

export function buildQuestions(candidates: SlideCandidate[], hasUsed: boolean): Questions {
  const questions: Questions = {};
  candidates.forEach((_, k) => {
    questions[fitId(k)] = noul(
      `Does the photo \`candidates[${k}]\` belong under \`slide\`, in the world of the news in \`story\`?`,
      {
        true: 'It belongs: who or what the slide is about, or an everyday scene from the story\'s world (for a story about software, an ordinary laptop, office or screen belongs).',
        false: 'It clearly doesn\'t belong: a person or organization the slide is not about, the request\'s words in another sense than the story means, or a scene that contradicts what the slide says.',
      },
    );
    if (hasUsed) {
      questions[repeatId(k)] = noul(
        `Would the photo \`candidates[${k}]\` read as a repeat of one of \`photos_already_in_post\`: the same person, the same building or logo, or the same kind of scene?`,
        {
          true: 'A reader swiping through would see the same face, the same place or logo, or a near-identical kind of scene again.',
          false: 'It shows something visibly different from every photo already in the post.',
        },
      );
    }
  });
  if (candidates.length > 1) {
    questions[BEST_ID] = choice(
      'Which candidate suits `slide` best: closest to what this slide says, specific over generic, and different from `photos_already_in_post`?',
      Object.fromEntries(candidates.map((c, k) => [candId(k), describe(c)])),
    );
  }
  return questions;
}

export type SlideScore = { fit: number; repeat: number; best: number };

/** One Jev call: each candidate's fit, repeat probability (0 when nothing is in the post yet) and best-choice probability, in order. */
export async function photoSlideScores(jev: JevAsk, state: SlideState, subjectId: string): Promise<SlideScore[]> {
  const hasUsed = state.photos_already_in_post.length > 0;
  const res = await jev({ state, questions: buildQuestions(state.candidates, hasUsed) }, { version: VERSION, subjectId });
  const best = res.answers[BEST_ID]?.probabilities ?? {};
  return state.candidates.map((_, k) => ({
    fit: res.answers[fitId(k)]?.noul ?? 0,
    repeat: hasUsed ? res.answers[repeatId(k)]?.noul ?? 0 : 0,
    best: state.candidates.length > 1 ? best[candId(k)] ?? 0 : 1,
  }));
}
