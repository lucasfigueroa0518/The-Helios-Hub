/**
 * Slide variant v1 (slide buckets spec §1, §3–§4; Tommy, 2026-10-07): which
 * of a bucket's remaining variants fits this slide best. Code has already
 * removed the variants the slide can't take (photo kind, copy length) and
 * those used earlier in the post; Jev picks among the rest from the slide's
 * copy, lengths and photo (its kind and its Haiku tags).
 *
 * One `choice` question per slide, asked only when 2 or more variants remain.
 */
import { choice, type Questions } from '@typesafe-ai/sdk';

export const VERSION = 'slide-variant@1';
export const QUESTION_ID = 'variant';

export type VariantState = {
  slide: { content: string; headline: string; body_chars: number; quote_chars: number; photo: string; photo_tags: string[] };
  previous_slide_variant: string | null;
};

export function buildQuestions(options: Array<{ id: string; look: string }>): Questions {
  return {
    [QUESTION_ID]: choice('Which layout best fits `slide`: its copy, how long the copy is, and its photo? Prefer a layout that differs from `previous_slide_variant`.', Object.fromEntries(options.map((o) => [o.id, o.look]))),
  };
}
