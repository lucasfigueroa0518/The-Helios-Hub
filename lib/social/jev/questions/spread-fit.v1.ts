/**
 * Spread fit v1 (Lucas, 2026-10-08): Jev's decision node for the spread
 * (render/layout.ts). A spread draws one wide photo across two neighbouring
 * slides, so the second slide loses its own photo. It is offered only when
 * the photo suits BOTH slides' words (2026-10-08: a drone photo spread onto a
 * slide about government exceptions and dates).
 *
 * One noul question per qualifying pair. Jev reads text only: both slides'
 * headlines and bodies, and the photo's title and Haiku tags.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

export const VERSION = 'spread-fit@1';

export const THRESHOLDS = {
  /** At or above this, the photo suits both slides. Provisional. */
  FIT_MIN: 0.5,
} as const;

export type SpreadPair = { id: string; first: { headline: string; body: string }; second: { headline: string; body: string }; photo: { title: string; tags: string[] } };

export function buildState(story: string, pairs: SpreadPair[]) {
  return { story, pairs };
}

export const fitId = (k: number) => `fits_both_${k}`;

export function buildQuestions(count: number): Questions {
  const questions: Questions = {};
  for (let k = 0; k < count; k++) {
    questions[fitId(k)] = noul(
      `Does the photo in \`pairs[${k}].photo\` suit BOTH \`pairs[${k}].first\` and \`pairs[${k}].second\`, so it can run across the two slides as one wide image?`,
      {
        true: 'The photo belongs to what both slides say: one continuous scene for one continuous beat of the story.',
        false: 'The photo suits only one of the slides, or neither: the other slide is about something the photo does not show.',
      },
    );
  }
  return questions;
}
