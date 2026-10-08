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
 * Design v1 slide types. Field-driven — the adapter picks the type from the
 * Writer's labels (see docs/DESIGN-V1-HANDOFF.md §Adapter).
 *
 *   cover       — position 0, unchanged from prior render
 *   text        — HEADLINE + BODY, top-anchored
 *   landing     — HEADLINE only (optional NOTE), centered
 *   stat        — BIG NUMBER + NUMBER NOTE + HEADLINE + optional BODY
 *   split_stat  — two numbers side by side, second orange
 *   quote       — QUOTE + QUOTE BY, orange opening mark
 *   image       — brief-image IMAGE + HEADLINE, cover-style full-bleed
 *   follow      — closing slide, unchanged
 *
 * `story_beat` and `data_block` are kept as legacy aliases so pre-design-v1
 * fixtures and rows still render. The renderer routes them to `text` and
 * `stat` respectively. New adapter output never emits them.
 */
export type LayoutVariant =
  | 'cover'
  | 'text'
  | 'landing'
  | 'stat'
  | 'split_stat'
  | 'quote'
  | 'image'
  | 'follow'
  | 'story_beat'
  | 'data_block';

/**
 * Design v1 keeps only cover composition codes (C1/C2/C3) and F1 as active.
 * The rest are retained in the union so pre-v1 fixtures + the legacy pipeline
 * still type-check; the renderer no longer branches on them.
 */
export type Variant =
  | 'C1' | 'C2' | 'C3' | 'C4'
  | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7'
  | 'D1' | 'D2' | 'D3'
  | 'Q1' | 'Q2'
  | 'P1'
  | 'T1' | 'T2'
  | 'F1';

/**
 * Editorial beat carried over from the story plan. The renderer doesn't
 * switch on `beat` (that's the layoutVariant's job), but the beat is kept
 * on the SlideCopy so downstream tools (analytics, previews, debugging)
 * can trace a rendered slide back to its editorial intent.
 */
export type Beat =
  | 'HOOK'
  | 'GROUND'
  | 'SCALE'
  | 'CONTEXT'
  | 'TURN'
  | 'PROOF'
  | 'SCENARIO'
  | 'MECHANISM'
  | 'ANALOGY'
  | 'QUOTE'
  | 'STAKES'
  | 'TWIST'
  | 'THESIS'
  | 'DEBATE'
  | 'FOLLOW';

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
   * Legacy: story-beat's slide title. Kept so old fixtures + legacy render
   * paths still work. Design v1 slides do not use it.
   */
  title?: SpanRun;

  /**
   * Landing slide's optional muted single-line explainer under the headline.
   */
  note?: string;

  /**
   * Stat / split-stat: what the BIG NUMBER counts. Rendered as small muted
   * text directly under the number.
   */
  numberNote?: string;

  /**
   * Split-stat: the second number (orange).
   */
  secondNumber?: string;

  /**
   * Split-stat: what the second number counts.
   */
  secondNote?: string;

  /**
   * Quote slide: the quotation itself. Set as SpanRun so a single hook can
   * paint one phrase orange within the quote (rare — usually one color).
   */
  quoteText?: SpanRun;

  /**
   * Quote slide: attribution line (name + outlet). Rendered small mono caps
   * under the quote with an em-dash prefix.
   */
  quoteBy?: string;

  /**
   * Quote slide: the speaker's role from SUBJECTS. Shown after the name on a
   * type-led quote slide (no verified speaker photo; photo spec §4).
   */
  quoteRole?: string;

  /**
   * Optional overlay caption baked onto the photo (subject name + role, e.g.
   * "Sam Altman · CEO OpenAI"). Renders bottom-left of the photo in white
   * over a dark scrim so it reads on any image.
   */
  photoCaption?: string;

  /**
   * Hook pass line (Lucas, Tommy 2026-10-06; prototype): one short line in a
   * smaller, distinct style. `above`: a lead-in, drawn above the body;
   * `below`: a tease or why-it-matters line, drawn below it.
   */
  hook?: { text: string; position: 'above' | 'below' };

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

  /**
   * On-slide attribution rendered as small green Roboto Mono, bottom edge of
   * the photo area. Required whenever `photoUrl` is set — CC-licensed and
   * press photos need credit by license terms. Short form: source and
   * license, e.g. `WIKIMEDIA COMMONS · CC BY-SA 4.0`.
   */
  photoCredit?: string;

  /**
   * Story-beat photo treatment. `card` (default) is the 16:10 landscape
   * card slotted between body and body-bottom. `bottom-fade` anchors the
   * photo to the slide's bottom half and dissolves upward via a linear
   * mask, so the copy at the top sits over pure canvas. Useful when the
   * source photo is already used elsewhere in the carousel — the fade
   * yields a visually distinct composition from the same file, keeping
   * the no-duplicates rule intact in spirit.
   */
  photoTreatment?: 'card' | 'bottom-fade';

  /**
   * Text slide: where the photo sits. `below` (default): headline + body on
   * top, photo fading up from the bottom. `top`: photo on top, text below.
   * Set by the layout rotation (layout-rotation.ts, spec §5.3), never by
   * the editorial stages.
   */
  photoPlacement?: 'below' | 'top';

  /**
   * Text slide without a photo: where the copy sits. `top` (default) or
   * `bottom`. Set by the layout rotation so consecutive photo-less slides
   * alternate (Tommy, 2026-10-06), never by the editorial stages.
   */
  textAnchor?: 'top' | 'bottom';

  /**
   * Quote slide: true only when the photo is an identity-verified photo of
   * the quote's speaker. Only then does it fill the round speaker spot;
   * any other photo is a darkened background, so no one is implied to be
   * the speaker.
   */
  photoIsSpeaker?: boolean;

  /**
   * What the photo may show (layout rule 3, Tommy 2026-10-06): `subject` (a
   * person or organization photo, or an article photo that may show people)
   * only goes in its own region; `scene` (stock, starter set) may sit full
   * bleed under text. Unset means scene.
   */
  photoKind?: 'subject' | 'scene' | 'logo';

  /**
   * Logo cover card (spec §5.1 (b)): the plate behind the logo, chosen by
   * code from the logo's luminance. The logo is never recoloured or cropped.
   */
  logoPlate?: 'light' | 'dark';

  /**
   * Logo cover card: a wide logo (wider than 2:1) is sized by width, at about
   * 80% of the card's width, not by a fixed height (Tommy, 2026-10-07).
   */
  logoWide?: boolean;

  /**
   * The icon drawn when the slide has no photo (render/icons.ts; photo spec
   * §5): faint Helios-orange outline off the bottom-right edge; on the cover,
   * raised and slightly brighter. Set on every slide; unused when a photo shows.
   */
  icon?: string;

  /**
   * Icon background placement, set by the layout rotation so a run of icon
   * slides doesn't look identical (photo spec §5a): `right` (default) or `left`.
   */
  iconSide?: 'right' | 'left';

  /**
   * A person photo framed for full bleed (photo spec §4): one face, whole, in
   * the upper half (from-draft.ts canBleedPerson). Only then may a subject
   * photo sit under text; the render check still fails a face under text.
   */
  photoBleed?: boolean;

  /**
   * Render review settings (photo spec §5b): how dark the fade under text is,
   * and whether a full-bleed slide's text sits at the top or the bottom.
   * Unset: the layout's default.
   */
  fade?: 'normal' | 'strong';
  bleedText?: 'bottom' | 'top';

  /**
   * Where to centre the photo's crop, as object-position fractions (0–1),
   * from the face detector (M8b). Unset means centre. `windowW`: the photo
   * window narrowed to this width (px) so the face stays within about 40% of
   * its height; the photo always fills its window, never bands (Tommy,
   * 2026-10-06).
   */
  photoFocus?: { x: number; y: number; windowW?: number; faceShare?: number };

  /**
   * Design-skill variant code from the helios-social-skill layout library.
   * Sits alongside `layoutVariant` (the family) as a CSS modifier so a
   * single family can express multiple compositions. Optional — the family
   * renders in its default composition when absent.
   */
  variant?: Variant;
  /** The bucket variant Jev chose (render/buckets.ts TemplateId; slide buckets spec). The layout rotation never swaps a slide that has one. */
  template?: string;
  /** The photo's own pixel size, when the source gives it: adaptive framing (render/framing.ts) uses it to avoid pixelating. */
  photoSize?: { w: number; h: number };
  /** The cover composition the variant chose (cover-bleed / cover-split …); absent: from the photo kind, as before. */
  coverMode?: 'bleed' | 'split' | 'logo' | 'icon';

  /**
   * The editorial beat this slide carries. Kept for tracing/analytics; the
   * renderer picks visuals from `layoutVariant` + `variant`, not from beat.
   */
  beat?: Beat;

  /**
   * DEBATE-layout body: the two-sides framing. Each entry is a labeled
   * position ("COPING?", "RIGHT?", "SIDE A", "SIDE B"). Rendered as two
   * green-labeled lines under the question in the T2 variant.
   */
  sides?: Array<{ label: string; text: string }>;

  /**
   * F1 Follow layout's story-specific line above the hero — the account
   * promise tied to THIS story, per the editorial FOLLOW beat. When absent,
   * F1 falls back to the generic "Follow for more." hero without a lede.
   */
  storySpecificLine?: string;

  /**
   * P1 Proof clipping: reference to the artifact being shown. The renderer
   * displays the artifact as a clean card + attribution. `kind` picks the
   * card treatment; `sourceLine` renders as a green mono line beneath.
   */
  artifact?: {
    kind: 'headline' | 'tweet' | 'paper_figure' | 'filing_excerpt';
    /** For "headline" and "filing_excerpt": the raw text set in card typography. */
    text?: string;
    /** For "tweet" and "paper_figure": image URL of the actual artifact. */
    imageUrl?: string;
    /** Author / handle attribution for the artifact. */
    attribution?: string;
    /** Green mono source line under the card, e.g. `SOURCE · REDFIN · SEPT 2026`. */
    sourceLine?: string;
  };

  /**
   * D3 chart/diagram data. When present, the renderer uses SVG-in-JSX to
   * render the chart rather than an image. Numbers come straight from the
   * fact sheet so values stay exact.
   */
  chartData?: {
    kind: 'bar_comparison' | 'trend_curve' | 'flywheel' | 'before_after';
    /** Chart title above the visualization. */
    title?: string;
    /** Points: label + value pairs; interpretation depends on `kind`. */
    points: Array<{ label: string; value: number; role?: 'subject' | 'comparison' }>;
    /** Green mono source line under the chart. */
    sourceLine?: string;
  };

  /**
   * B6 panorama half-marker. When present, this slide is one half of a
   * two-slide panorama; the export pipeline knows to render the pair at
   * 2160×1350 and crop into two 1080×1350 PNGs.
   */
  panoramaSide?: 'left' | 'right';
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
  /**
   * Full-form attribution block appended to the Instagram caption body.
   * Lists every photo used in the post with source, author, and license.
   * Rendered by the publish pipeline, not on-slide (the on-slide
   * `photoCredit` is a shorter chrome line).
   */
  attributionBlock?: string;
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
