/**
 * Types for the slide renderer. A `Post` is what the compose pipeline hands
 * off to the renderer; a `SlideCopy` is one slide within it.
 *
 * The renderer is the source of truth for how these fields map to visual
 * slots — see `SlideTemplate.tsx` and `preview.css`. The compose pipeline
 * (Phase 3b) produces objects of this shape from an approved article.
 */

/**
 * Story-type vocabulary — mirrors the green `▸ CATEGORY` labels on the Cover
 * archetype. Matches Haiku's compose output. `tech` is the fallback when no
 * more specific category fits.
 */
export type StoryType =
  | 'ai_funding'
  | 'model_launch'
  | 'agents'
  | 'safety'
  | 'policy'
  | 'infrastructure'
  | 'benchmark'
  | 'leadership'
  | 'deal'
  | 'research'
  | 'tech';

export type Format = 'carousel' | 'story';

/**
 * Archetypes currently implemented. Every slide is one of these; the
 * SlideTemplate component picks the right renderer per variant.
 *
 *   cover       — position 0, the thumb-stop
 *   story_beat  — positions 1..N−2, one narrative beat each
 *   source      — outlet credit, only in 5+ slide carousels
 *   follow      — always the last slide of every carousel
 *
 * Aspirational archetypes from the spec (data_block, quote) are not
 * implemented and are excluded from the union until they ship. Add them
 * back when the layout and copy are actually designed.
 */
export type LayoutVariant =
  | 'cover'
  | 'story_beat'
  | 'source'
  | 'follow';

/**
 * One phrase inside a headline or body sentence. The three-role color-emphasis
 * system paints one color per span, never per word inside a phrase.
 *   narrative — default (white on dark, near-black on Helios White)
 *   hook      — orange; one per sentence, never absent, never doubled
 *   pivot     — green; dates, names, transitions ("But then,", "The catch:")
 */
export type SpanRole = 'narrative' | 'hook' | 'pivot';

export type Span = {
  text: string;
  role: SpanRole;
};

/**
 * A run of spans that reads as one sentence. Rendered inline with color
 * applied per span. Whitespace between spans is caller-controlled — include
 * leading/trailing spaces inside `text` where sentence flow needs them.
 */
export type SpanRun = Span[];

export type SlideCopy = {
  /** 0-based ordering within the carousel; always 0 for stories. */
  position: number;
  layoutVariant: LayoutVariant;

  /**
   * Primary display line. Cover uses this as the 3–4-line uppercase headline;
   * story_beat's optional landing line; data_block's Pragmatica label; quote's
   * spoken sentence; source's outlet name; follow ignores this.
   */
  headline?: SpanRun;

  /**
   * Supporting narrative sentence. Story-beat's body-top (sits above the
   * photo block); data_block's context sentence; source's article-headline
   * teaser. Not used on cover/quote/follow.
   */
  body?: SpanRun;

  /**
   * Story-beat's optional second body paragraph — sits BELOW the photo block
   * in the photo-forward layout, continuing the narrative on from `body`.
   */
  bodyBottom?: SpanRun;

  /**
   * Story-beat's slide title — big orange Pragmatica type that anchors the
   * top of the slide. Semantically the beat's own topic label; not the same
   * as the Post's overall headline (which lives on the Cover slide).
   */
  title?: SpanRun;

  /**
   * Optional overlay caption baked onto the photo (subject name + role, e.g.
   * "Sam Altman · CEO OpenAI"). Renders bottom-left of the photo in white
   * over a dark scrim so it reads on any image.
   */
  photoCaption?: string;

  /** Required by the validator; drives screen-reader UX + accessibility. */
  altText: string;

  /**
   * Marks this slide as the one Helios White light-canvas break for the
   * carousel. Only valid on data_block / quote / source per spec; 0 or 1
   * per carousel.
   */
  lightCanvas?: boolean;

  /**
   * Bitmap URL for photo-slot layouts (Supabase Storage path). Cover uses
   * right-third; quote uses portrait; source uses hero; data_block uses
   * screenshot. Empty → renders spec's hairline-grid placeholder.
   */
  photoUrl?: string;
};

export type Post = {
  format: Format;
  storyType: StoryType;
  /** Full outlet name for byline, e.g. "The Next Web". */
  source: string;
  sourceUrl: string;
  /** ISO 8601. Rendered in masthead ticker as `MM.DD.YY`. */
  publishedAt: string;
  /**
   * Publication issue number for the masthead ticker (`VOL 042 · ...`).
   * Assigned monotonically at publish time; renderer displays as-is.
   */
  issueNumber: number;
  slides: SlideCopy[];
  caption: string;
};

/**
 * Human-readable label for the green `▸ CATEGORY` chip on the Cover archetype.
 * Kept in one place so the compose pipeline, renderer, and admin UI stay in
 * sync when the vocabulary evolves.
 */
export const CATEGORY_LABELS: Record<StoryType, string> = {
  ai_funding: 'AI FUNDING',
  model_launch: 'MODEL LAUNCH',
  agents: 'AGENTS',
  safety: 'SAFETY',
  policy: 'POLICY',
  infrastructure: 'INFRASTRUCTURE',
  benchmark: 'BENCHMARK',
  leadership: 'LEADERSHIP',
  deal: 'DEAL',
  research: 'RESEARCH',
  tech: 'TECH',
};
