/**
 * Jev state builder. The reader-visible view of a post: cover + numbered
 * story slides, nothing else. Per docs/JEV-GRADING-PASS.md §2:
 *   > No brief, no sources, no caption, no follow slide.
 *
 * Two inputs supported so the grader can score both live pipeline output
 * and hand-finalized posts:
 *   - `ParsedPost` (from lib/social/editorial/v2/parse) — the pipeline
 *     shape emitted by the Writer/Editor.
 *   - `RenderPost` (from lib/social/render/types) — the shape the
 *     renderer consumes; used by the finalizer.
 */

import type { ParsedPost, ParsedSlide } from '../editorial/v2/parse';

export type JevStateSlide = {
  position: number;
  kind: 'text' | 'landing' | 'stat' | 'split_stat' | 'quote' | 'image';
  text: string;
};

export type JevState = {
  coverText: string;
  storySlides: JevStateSlide[];
  /** The plain string given to systemOne. Includes the reader line at
   *  the top of each question, so this is JUST the reader-visible post. */
  serialized: string;
  /** Positions of story slides that will get a `slide_N_earns_place`
   *  question. Same order as `storySlides`. */
  storySlidePositions: number[];
};

function slideKindFromParsed(s: ParsedSlide): JevStateSlide['kind'] {
  if (s.quote) return 'quote';
  if (s.secondNumber) return 'split_stat';
  if (s.bigNumber) return 'stat';
  if (s.image && /^brief image\s+\d+/i.test(s.image) && s.headline && !s.body) return 'image';
  if (s.headline && !s.body) return 'landing';
  return 'text';
}

function slideTextFromParsed(s: ParsedSlide): string {
  // Serialize a slide as `headline | body` (or the appropriate kind-
  // specific shape). This is what the reader sees on the slide,
  // minus rendering (no orange highlight, no photo credit).
  const kind = slideKindFromParsed(s);
  switch (kind) {
    case 'text':
      return `${s.headline ?? ''} | ${s.body ?? ''}`.trim();
    case 'landing':
      return s.note ? `${s.headline ?? ''} — ${s.note}` : (s.headline ?? '');
    case 'stat': {
      const parts = [s.headline, s.bigNumber, s.numberNote].filter(Boolean);
      return parts.join(' | ');
    }
    case 'split_stat': {
      const parts = [s.headline, s.bigNumber, s.numberNote, s.secondNumber, s.secondNote].filter(Boolean);
      return parts.join(' | ');
    }
    case 'quote':
      return s.quoteBy ? `"${s.quote}" — ${s.quoteBy}` : `"${s.quote ?? ''}"`;
    case 'image':
      return `[image: ${s.image}] ${s.headline ?? ''}`.trim();
  }
}

/** Build a Jev state from a Writer/Editor ParsedPost. */
export function buildJevStateFromParsed(post: ParsedPost): JevState {
  const coverText = post.cover?.text ?? '';
  const storySlides: JevStateSlide[] = [];
  for (const s of post.slides) {
    storySlides.push({
      position: s.position,
      kind: slideKindFromParsed(s),
      text: slideTextFromParsed(s),
    });
  }
  const lines: string[] = [];
  lines.push(`COVER: ${coverText}`);
  for (const s of storySlides) {
    lines.push(`SLIDE ${s.position} (${s.kind}): ${s.text}`);
  }
  return {
    coverText,
    storySlides,
    serialized: lines.join('\n'),
    storySlidePositions: storySlides.map((s) => s.position),
  };
}

/**
 * Build a Jev state from a rendered Post shape (as used by the finalizer,
 * `Claude outputs/final/<slug>/post.json`). This shape uses `cover.text`
 * plus `slides[].headline / body / note / quote / quoteBy / bigNumber /
 * numberNote / secondNumber / secondNote / image` — same field names as
 * ParsedSlide, so the same kind + text logic works with a light adapter.
 */
export function buildJevStateFromRenderPost(post: {
  cover?: { text?: string };
  slides: Array<{
    position: number;
    headline?: string;
    body?: string;
    note?: string;
    quote?: string;
    quoteBy?: string;
    bigNumber?: string;
    numberNote?: string;
    secondNumber?: string;
    secondNote?: string;
    highlight?: string;
    image?: string;
  }>;
}): JevState {
  const adapted: ParsedPost = {
    cover: { kind: 'edited', text: post.cover?.text ?? '' } as unknown as ParsedPost['cover'],
    slides: post.slides.map((s) => ({
      position: s.position,
      headline: s.headline,
      body: s.body,
      note: s.note,
      quote: s.quote,
      quoteBy: s.quoteBy,
      bigNumber: s.bigNumber,
      numberNote: s.numberNote,
      secondNumber: s.secondNumber,
      secondNote: s.secondNote,
      highlight: s.highlight,
      image: s.image,
    })) as unknown as ParsedPost['slides'],
    follow: '',
  } as ParsedPost;
  return buildJevStateFromParsed(adapted);
}
