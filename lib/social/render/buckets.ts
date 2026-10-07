/**
 * Slide buckets and their variants (slide buckets spec §2–§3; Tommy,
 * 2026-10-07): each bucket's variants, what each needs, and how it sets a
 * slide's render settings. Code removes the variants a slide can't take
 * (photo kind, copy length) and those already used in the post; Jev picks
 * among the rest (render/layout.ts).
 *
 * Every variant here is one the renderer already draws; new ones are added
 * after their mock-ups are approved (spec §3, OPEN rows).
 */
import type { SlideCopy } from './types';

export const BUCKETS = ['cover', 'story', 'stat', 'quote', 'spread'] as const;
export type Bucket = (typeof BUCKETS)[number];

/** What the slide's photo is, for the variant needs. `none`: no photo. */
export type PhotoShape = 'scene' | 'person' | 'person-bleed' | 'logo' | 'none';

/** What code knows about a slide when its variant is chosen. */
export type SlideFacts = {
  bucket: Bucket;
  photo: PhotoShape;
  /** The photo is a verified photo of the quote's speaker. */
  speakerPhoto: boolean;
  /** The photo is wide enough for a spread (photo spec §4). */
  wide: boolean;
  headlineChars: number;
  bodyChars: number;
  /** Quote slides: the quote's length. */
  quoteChars: number;
};

export type TemplateId =
  | 'cover-bleed' | 'cover-split' | 'cover-logo' | 'cover-icon'
  | 'story-photo-below' | 'story-photo-top' | 'story-full-bleed' | 'story-landing' | 'story-text-top' | 'story-text-low'
  | 'stat-backdrop' | 'stat-plain'
  | 'quote-speaker' | 'quote-backdrop' | 'quote-type-led'
  | 'spread-text-bottom' | 'spread-text-top';

export type Template = {
  id: TemplateId;
  bucket: Bucket;
  /** What Jev reads: how the variant looks and what it suits. */
  look: string;
  /** Can this slide take it? */
  needs: (f: SlideFacts) => boolean;
  /** The slide's render settings under this variant (text never changes). */
  apply: (s: SlideCopy) => SlideCopy;
};

const anyPhoto = (f: SlideFacts) => f.photo !== 'none';
const bleedable = (f: SlideFacts) => f.photo === 'scene' || f.photo === 'person-bleed';

/** The slide without its photo (the icon background draws instead). */
export function withoutPhoto(s: SlideCopy): SlideCopy {
  const { photoUrl: _u, photoCredit: _c, photoKind: _k, photoFocus: _f, photoBleed: _b, logoPlate: _p, logoWide: _w, photoIsSpeaker: _s, ...rest } = s;
  void _u; void _c; void _k; void _f; void _b; void _p; void _w; void _s;
  return rest;
}

export const TEMPLATES: Template[] = [
  // Cover: the photo decides the composition (SlideTemplate CoverSlide).
  { id: 'cover-bleed', bucket: 'cover', look: 'full-bleed photo, headline at the bottom over a dark fade', needs: bleedable, apply: (s) => s },
  { id: 'cover-split', bucket: 'cover', look: 'person photo in the top half, headline below', needs: (f) => f.photo === 'person', apply: (s) => s },
  { id: 'cover-logo', bucket: 'cover', look: 'the company logo on a Helios card, headline below', needs: (f) => f.photo === 'logo', apply: (s) => s },
  { id: 'cover-icon', bucket: 'cover', look: 'large outline icon, headline only', needs: (f) => f.photo === 'none', apply: (s) => s },
  // Story.
  { id: 'story-photo-below', bucket: 'story', look: 'headline and body at the top, photo in a panel below', needs: anyPhoto, apply: (s) => ({ ...s, layoutVariant: 'text', photoPlacement: 'below' }) },
  { id: 'story-photo-top', bucket: 'story', look: 'photo in a panel at the top, headline and body below', needs: anyPhoto, apply: (s) => ({ ...s, layoutVariant: 'text', photoPlacement: 'top' }) },
  { id: 'story-full-bleed', bucket: 'story', look: 'full-bleed photo, headline and body at the bottom over a dark fade; best for short copy and striking scenes', needs: (f) => bleedable(f) && f.bodyChars <= 200, apply: (s) => ({ ...s, layoutVariant: 'image', photoPlacement: undefined }) },
  { id: 'story-landing', bucket: 'story', look: 'one big centred line with a short line under it, photo panel below; best for a punchline or turn', needs: (f) => f.headlineChars <= 60 && f.bodyChars <= 160, apply: (s) => ({ ...s, layoutVariant: 'landing' }) },
  { id: 'story-text-top', bucket: 'story', look: 'type only, copy at the top over a large icon', needs: (f) => f.photo === 'none', apply: (s) => ({ ...withoutPhoto(s), layoutVariant: 'text', textAnchor: 'top' }) },
  { id: 'story-text-low', bucket: 'story', look: 'type only, copy low on the slide over a large icon', needs: (f) => f.photo === 'none', apply: (s) => ({ ...withoutPhoto(s), layoutVariant: 'text', textAnchor: 'bottom' }) },
  // Stat (single or split: the layout follows the numbers).
  { id: 'stat-backdrop', bucket: 'stat', look: 'big number over a darkened photo', needs: (f) => f.photo === 'scene', apply: (s) => s },
  { id: 'stat-plain', bucket: 'stat', look: 'big number on the dark canvas with an icon', needs: (f) => f.photo !== 'scene', apply: (s) => withoutPhoto(s) },
  // Quote.
  { id: 'quote-speaker', bucket: 'quote', look: "the speaker's photo in a round spot above the quote", needs: (f) => f.speakerPhoto, apply: (s) => ({ ...s, photoIsSpeaker: true }) },
  { id: 'quote-backdrop', bucket: 'quote', look: 'the quote over a darkened scene photo', needs: (f) => !f.speakerPhoto && f.photo === 'scene', apply: (s) => ({ ...s, photoIsSpeaker: false }) },
  { id: 'quote-type-led', bucket: 'quote', look: 'type-led: quote mark, quote, speaker name and role', needs: (f) => !f.speakerPhoto && f.photo !== 'scene', apply: (s) => withoutPhoto(s) },
  // Spread (two slides, one wide photo).
  { id: 'spread-text-bottom', bucket: 'spread', look: 'one wide photo across two slides, copy at the bottom of each', needs: (f) => f.photo === 'scene' && f.wide, apply: (s) => ({ ...s, layoutVariant: 'image', bleedText: 'bottom' }) },
  { id: 'spread-text-top', bucket: 'spread', look: 'one wide photo across two slides, copy at the top of each', needs: (f) => f.photo === 'scene' && f.wide, apply: (s) => ({ ...s, layoutVariant: 'image', bleedText: 'top' }) },
];

export const templateById = (id: TemplateId) => TEMPLATES.find((t) => t.id === id)!;

/** The variants of a bucket this slide can take, minus those already used in the post. */
export function allowedTemplates(f: SlideFacts, used: Set<TemplateId>): Template[] {
  return TEMPLATES.filter((t) => t.bucket === f.bucket && t.needs(f) && !used.has(t.id));
}
