/**
 * Slide bucket v1 (slide buckets spec §2; Tommy, 2026-10-07): the one bucket
 * choice content leaves open. A text slide is a story slide unless it and its
 * neighbour become the post's one spread; code finds the neighbouring text
 * pairs with a wide scene photo, and Jev picks the pair whose copy best reads
 * as one continued beat across one photo. Asked only when 2 or more pairs
 * qualify (one pair: it is the spread; none: no spread, and the report says why).
 */
import { choice, type Questions } from '@typesafe-ai/sdk';

export const VERSION = 'slide-bucket@1';
export const QUESTION_ID = 'spread_pair';

export type PairOption = { id: string; first: string; second: string; photo_tags: string[] };

export function buildQuestions(pairs: PairOption[]): Questions {
  return {
    [QUESTION_ID]: choice(
      'Which pair of neighbouring slides should share one wide photo across both? Pick the pair whose two slides continue one beat, so one photo reads naturally behind both.',
      Object.fromEntries(pairs.map((p) => [p.id, `"${p.first}" then "${p.second}" (photo: ${p.photo_tags.join(', ') || 'a wide scene'})`])),
    ),
  };
}
