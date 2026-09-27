import type { BeatCopy, EditorialPost } from '@/lib/social/editorial/copy';
import type { FactSheet } from '@/lib/social/editorial/fact-sheet';
import type { StoryPlan } from '@/lib/social/editorial/story-plan';
import type {
  Beat,
  LayoutVariant,
  Post,
  SlideCopy,
  StoryType,
  Variant,
} from '@/lib/social/render/types';

/**
 * Layout picker — bridges editorial (semantic) to design (visual).
 *
 * Reads:
 *   - EditorialPost (from copy.ts) — semantic per-slide copy + spans
 *   - StoryPlan     (from story-plan.ts) — asset_needs per slide
 *   - FactSheet     (from fact-sheet.ts) — available assets, story_type
 *   - article meta  — source, url, published_at, issue number
 *
 * Produces a render Post ready for SlideTemplate.tsx. Picks one layout
 * (family + variant) per slide from the design skill's picking table,
 * then enforces the rhythm rules (no consecutive same layout, visual
 * break every ~3 slides).
 *
 * Photo assignment is a separate concern — the picker leaves photoUrl
 * empty. A downstream photo-picker step fills those in.
 */

const FAMILY_BY_VARIANT: Record<Variant, LayoutVariant> = {
  C1: 'cover', C2: 'cover', C3: 'cover', C4: 'cover',
  B1: 'story_beat', B2: 'story_beat', B3: 'story_beat', B4: 'story_beat',
  B5: 'story_beat', B6: 'story_beat', B7: 'story_beat',
  D1: 'data_block', D2: 'data_block', D3: 'data_block',
  Q1: 'quote', Q2: 'quote',
  P1: 'proof',
  T1: 'thesis',
  T2: 'debate',
  F1: 'follow',
};

/**
 * Picking table per helios-social-skill design library §"Picking layouts".
 * `first` runs the beat's first-choice variant; `alt` is the walk-back
 * list the rhythm-enforcer draws from when the first choice collides
 * with the previous slide's variant.
 */
const PICK_TABLE: Record<Beat, { first: Variant; alt: Variant[] }> = {
  HOOK:      { first: 'C3', alt: ['C1', 'C2', 'C4'] },
  GROUND:    { first: 'B1', alt: ['B2', 'B4', 'B7'] },
  SCALE:     { first: 'D1', alt: ['D3', 'D2', 'B6'] },
  CONTEXT:   { first: 'B4', alt: ['B1', 'B7', 'B2'] },
  TURN:      { first: 'B5', alt: ['B3', 'B1'] },
  PROOF:     { first: 'P1', alt: ['B3'] },
  SCENARIO:  { first: 'B4', alt: ['B2', 'B6'] },
  MECHANISM: { first: 'D3', alt: ['B1'] },
  ANALOGY:   { first: 'B1', alt: ['B5'] },
  QUOTE:     { first: 'Q1', alt: ['Q2', 'B3'] },
  STAKES:    { first: 'B4', alt: ['B1', 'B2'] },
  TWIST:     { first: 'B5', alt: ['B3', 'D3', 'B6'] },
  THESIS:    { first: 'T1', alt: ['B5'] },
  DEBATE:    { first: 'T2', alt: [] },
  FOLLOW:    { first: 'F1', alt: [] },
};

/**
 * Detect whether the story has a licensed portrait of a named human. When
 * true, cover picks C1 and QUOTE picks Q2 by default. Cheap heuristic:
 * look for an "assets" entry whose kind is `photo` and whose subject
 * mentions a person's name from `players`.
 */
function hasPortrait(factSheet: FactSheet): boolean {
  const namedHumans = factSheet.players
    .filter((p) => /[A-Z]\w+\s[A-Z]\w+/.test(p.name))
    .map((p) => p.name.toLowerCase());
  if (namedHumans.length === 0) return false;
  return factSheet.assets.some((a) => {
    if (a.kind !== 'photo') return false;
    const subject = a.subject.toLowerCase();
    return namedHumans.some((name) => subject.includes(name));
  });
}

function hasMetaphorPhoto(factSheet: FactSheet): boolean {
  return factSheet.assets.some((a) => a.kind === 'photo');
}

function pickCoverVariant(factSheet: FactSheet, chosenNumbersMatter: boolean): Variant {
  if (hasPortrait(factSheet)) return 'C1';
  if (hasMetaphorPhoto(factSheet)) return 'C2';
  if (chosenNumbersMatter) return 'C4';
  return 'C3';
}

function pickQuoteVariant(factSheet: FactSheet): Variant {
  return hasPortrait(factSheet) ? 'Q2' : 'Q1';
}

/**
 * Pick a variant for one slide's beat. HOOK and QUOTE beats consult the
 * fact sheet for photo availability; everything else uses the picking
 * table's first choice.
 */
function pickInitialVariant(beat: Beat, factSheet: FactSheet): Variant {
  if (beat === 'HOOK') {
    // A big-number cover (C4) is right when the story's headline number is
    // the entire story — same signal as the "shock_number" hook category.
    // Left as false in MVP; a smarter picker inspects the chosen_hook.
    return pickCoverVariant(factSheet, false);
  }
  if (beat === 'QUOTE') return pickQuoteVariant(factSheet);
  const row = PICK_TABLE[beat];
  return row.first;
}

/**
 * Rhythm rule 1 — never the same variant on two consecutive slides. If
 * the initial pick collides with the previous slide's variant, walk the
 * alt list until we find a differing choice, else keep the first.
 */
function enforceRhythm(beat: Beat, initial: Variant, prev: Variant | null): Variant {
  if (prev === null || initial !== prev) return initial;
  const alts = PICK_TABLE[beat].alt;
  for (const candidate of alts) {
    if (candidate !== prev) return candidate;
  }
  return initial;
}

/**
 * Extract SpanRun's plain-text form for legacy render fields that don't
 * carry span structure (e.g. F1's storySpecificLine).
 */
function spansToText(run: BeatCopy['body']): string {
  if (!run) return '';
  return run.map((s) => s.text).join('').trim();
}

/**
 * Convert one editorial slide into a render SlideCopy, tagged with its
 * chosen family + variant + carried semantic fields.
 */
function convertSlide(
  editorial: BeatCopy,
  variant: Variant,
): SlideCopy {
  const layoutVariant = FAMILY_BY_VARIANT[variant];
  const base: SlideCopy = {
    position: editorial.position,
    layoutVariant,
    variant,
    beat: editorial.beat,
    altText: editorial.altText,
    headline: editorial.headline ?? undefined,
    body: editorial.body ?? undefined,
    bodyBottom: editorial.bodyBottom ?? undefined,
    title: editorial.title ?? undefined,
  };

  // Layout-specific field promotion.
  if (editorial.beat === 'FOLLOW' && variant === 'F1') {
    // The FOLLOW beat's body text IS the story-specific line above the hero.
    base.storySpecificLine = spansToText(editorial.body);
    // Renderer's F1 doesn't use body/headline directly.
    base.body = undefined;
    base.headline = undefined;
  }

  if (editorial.beat === 'DEBATE' && variant === 'T2') {
    // T2 renders headline (the question) + sides (the two labeled positions).
    // Editorial pipeline emits sides array; forward it directly to the
    // render Post so DebateSlide can display both positions cleanly.
    const editorialSides = (editorial as unknown as { sides?: Array<{ label: string; text: string }> }).sides;
    if (editorialSides && editorialSides.length > 0) {
      base.sides = editorialSides;
    }
  }

  if (editorial.beat === 'PROOF' && variant === 'P1') {
    // Try to bind an artifact from fact_sheet.assets via editorial.facts.
    // MVP: leave artifact undefined; the renderer falls back to a
    // photo-card treatment.
  }

  return base;
}

export type LayoutPickerInput = {
  editorialPost: EditorialPost;
  factSheet: FactSheet;
  storyPlan: StoryPlan;
  article: {
    source: string;
    sourceUrl: string;
    publishedAt: string;
    issueNumber: number;
  };
};

export function pickLayouts(input: LayoutPickerInput): Post {
  const { editorialPost, factSheet, article } = input;

  // Pick initial variants.
  const initialPicks = editorialPost.slides.map((slide) =>
    pickInitialVariant(slide.beat, factSheet),
  );

  // Enforce rhythm rule 1.
  const finalPicks: Variant[] = [];
  for (let i = 0; i < initialPicks.length; i += 1) {
    const prev = i > 0 ? finalPicks[i - 1]! : null;
    finalPicks.push(enforceRhythm(editorialPost.slides[i]!.beat, initialPicks[i]!, prev));
  }

  const slides: SlideCopy[] = editorialPost.slides.map((editorial, i) =>
    convertSlide(editorial, finalPicks[i]!),
  );

  return {
    format: 'carousel',
    storyType: factSheet.story_type as StoryType,
    source: article.source,
    sourceUrl: article.sourceUrl,
    publishedAt: article.publishedAt,
    issueNumber: article.issueNumber,
    slides,
    caption: editorialPost.caption,
  };
}
