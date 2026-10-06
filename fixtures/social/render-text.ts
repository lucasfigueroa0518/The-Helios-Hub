/**
 * Test stand-in for the render-fit check's slide text: every text field of
 * the render Post, as a renderer that shows all of them would. The real
 * check reads the rendered DOM (lib/social/render/fit-check.ts).
 */
import type { FitResult } from '@/lib/social/render/fit-check';
import type { Post, SpanRun } from '@/lib/social/render/types';

const t = (r?: SpanRun) => (r ?? []).map((s) => s.text).join('');

export function allSlideText(post: Post): string[] {
  return post.slides.map((s) =>
    [t(s.headline), t(s.body), t(s.title), s.numberNote, s.secondNumber, s.secondNote, t(s.quoteText), s.quoteBy, s.storySpecificLine].filter(Boolean).join(' '),
  );
}

export const fitOkFor = (post: Post): FitResult => ({ ok: true, violations: [], problems: [], slideText: allSlideText(post) });
