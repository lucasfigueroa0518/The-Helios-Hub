/**
 * Types for the slide renderer. A `Post` is what the compose pipeline hands
 * off to the renderer; a `SlideCopy` is one slide within it.
 *
 * The renderer is the source of truth for how these fields map to visual
 * slots — see `SlideTemplate.tsx` and `preview.css`. The compose pipeline
 * (Phase 3b) produces objects of this shape from an approved article.
 */

export type StoryType =
  | 'deal'
  | 'news'
  | 'data_story'
  | 'photo_led'
  | 'platform_change';

export type Format = 'carousel' | 'story';

/**
 * Layout variants a slide can take. Extend this union as new slide shapes
 * ship; the SlideTemplate component picks the right renderer per variant.
 */
export type LayoutVariant =
  | 'cover_headline'
  | 'quote'
  | 'data_change'
  | 'context'
  | 'source_cta';

export type SlideCopy = {
  /** 0-based ordering within the carousel; always 0 for stories. */
  position: number;
  layoutVariant: LayoutVariant;
  /** Short shouted label above the headline (green or orange). */
  eyebrow?: string;
  headline: string;
  /** Exactly one accent-highlighted span per slide (brand rule). */
  keyPhrase?: string;
  /** Supporting body copy. */
  body?: string;
  /** Attribution byline (for quote slides). */
  attribution?: string;
  /** Required by the validator; drives screen-reader UX + accessibility. */
  altText: string;
  /** Bitmap URL for photo-slot layouts (Supabase Storage path). */
  photoUrl?: string;
};

export type Post = {
  format: Format;
  storyType: StoryType;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  slides: SlideCopy[];
  caption: string;
};
