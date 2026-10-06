/**
 * Finished draft + photos → the renderer's Post (plan M6). Plain mapping,
 * no decisions about wording: every word on a slide comes from the filled
 * draft (quotes and numbers are the brief's exact text).
 *
 * Not here yet, by design:
 *   - highlight colours: the draft has no highlight field, so every span is
 *     `narrative` until M7's highlight snapping;
 *   - layout rotation (spec §5.3) and spreads (§5.4) are applied here;
 *   - story category chip: `tech` until there's a classifier for it.
 */
import type { Photo } from '@/lib/social/photos/find';
import type { FilledDraft, FilledSlide } from '@/lib/social/writer/draft';

import { rotateLayouts } from './layout-rotation';
import type { Post, SlideCopy, SpanRun } from './types';

const run = (text: string): SpanRun => [{ text, role: 'narrative' }];

export type PostMeta = { source: string; sourceUrl: string; publishedAt: string };

/** Article and Commons photos may show people (rule 3); stock and starter-set photos are scenes. */
export const photoKindOf = (photo: Photo): 'subject' | 'scene' => (photo.source === 'article' || photo.source === 'commons' ? 'subject' : 'scene');

function photoFields(photo: Photo | null): Pick<SlideCopy, 'photoUrl' | 'photoCredit' | 'photoKind'> {
  return photo ? { photoUrl: photo.url, photoCredit: photo.credit, photoKind: photoKindOf(photo) } : {};
}

function storySlide(s: FilledSlide, position: number, photo: Photo | null): SlideCopy {
  const base = { position, headline: run(s.headline.text), altText: s.headline.text, ...photoFields(photo) };
  const body = s.body ? { body: run(s.body.text) } : {};
  switch (s.type) {
    case 'stat': {
      const n = s.numbers[0]!;
      return { ...base, ...body, layoutVariant: 'stat', title: run(n.value), numberNote: n.counts };
    }
    case 'split_stat': {
      const [a, b] = s.numbers;
      return { ...base, ...body, layoutVariant: 'split_stat', title: run(a!.value), numberNote: a!.counts, secondNumber: b!.value, secondNote: b!.counts };
    }
    case 'quote':
      return { ...base, ...body, layoutVariant: 'quote', quoteText: run(s.quote!.text), quoteBy: s.quote!.speaker, photoIsSpeaker: !!photo?.qid && photo.subject === s.quote!.speaker, altText: `${s.headline.text}: "${s.quote!.text}" (${s.quote!.speaker})` };
    case 'landing':
      return { ...base, ...body, layoutVariant: 'landing' };
    case 'image':
      return { ...base, ...body, layoutVariant: 'image' };
    default:
      return { ...base, ...body, layoutVariant: 'text' };
  }
}

/** Every photo credit, once each, for the caption's Photos: line. */
export function attributionBlock(photos: Array<Photo | null>): string | undefined {
  const credits = [...new Set(photos.filter((p): p is Photo => !!p).map((p) => p.credit))];
  return credits.length ? `Photos: ${credits.join('; ')}` : undefined;
}

/** A spread photo must fill two slides side by side (2160×1350): at least 1.6 times as wide as tall. */
export const SPREAD_MIN_ASPECT = 2160 / 1350;

/**
 * Spread (spec §5.4): a slide marked spread_with_next shares its scene
 * photo with the next slide, left half and right half. Fallback: a subject
 * photo (rule 3), a photo not wide enough, or no next slide → both render
 * as normal slides.
 */
function applySpreads(slides: SlideCopy[], draft: FilledDraft, photos: Array<Photo | null>): SlideCopy[] {
  const out = [...slides];
  draft.slides.forEach((s, i) => {
    const p = photos[i];
    const a = out[i + 1];
    const b = out[i + 2];
    if (!s.spread_with_next || !p || !a || !b || b.layoutVariant === 'follow') return;
    if (photoKindOf(p) !== 'scene' || !p.width || !p.height || p.width / p.height < SPREAD_MIN_ASPECT) return;
    if (a.panoramaSide || b.panoramaSide) return;
    out[i + 1] = { ...a, panoramaSide: 'left' };
    out[i + 2] = { ...b, ...photoFields(p), photoFocus: undefined, panoramaSide: 'right' };
  });
  return out;
}

/** The slides in draft order, before layout rotation. */
export function draftSlides(draft: FilledDraft, photos: { cover: Photo | null; slides: Array<Photo | null> }): SlideCopy[] {
  return applySpreads(
    [
      { position: 0, layoutVariant: 'cover', headline: run(draft.cover), altText: draft.cover, ...photoFields(photos.cover) },
      ...draft.slides.map((s, i) => storySlide(s, i + 1, photos.slides[i] ?? null)),
      { position: draft.slides.length + 1, layoutVariant: 'follow', storySpecificLine: draft.follow, altText: draft.follow },
    ],
    draft,
    photos.slides,
  );
}

export function toRenderPost(
  draft: FilledDraft,
  photos: { cover: Photo | null; slides: Array<Photo | null> },
  meta: PostMeta,
): Post {
  return {
    format: 'carousel',
    storyType: 'tech',
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    publishedAt: meta.publishedAt,
    issueNumber: 0,
    slides: rotateLayouts(draftSlides(draft, photos)).slides,
    caption: draft.caption.text,
    attributionBlock: attributionBlock([photos.cover, ...photos.slides]),
  };
}
