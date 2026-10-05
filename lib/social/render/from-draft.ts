/**
 * Finished draft + photos → the renderer's Post (plan M6). Plain mapping,
 * no decisions about wording: every word on a slide comes from the filled
 * draft (quotes and numbers are the brief's exact text).
 *
 * Not here yet, by design:
 *   - highlight colours: the draft has no highlight field, so every span is
 *     `narrative` until M7's highlight snapping;
 *   - layout rotation, spreads, stat-photo darkening: M8;
 *   - story category chip: `tech` until there's a classifier for it.
 */
import type { Photo } from '@/lib/social/photos/find';
import type { FilledDraft, FilledSlide } from '@/lib/social/writer/draft';

import type { Post, SlideCopy, SpanRun } from './types';

const run = (text: string): SpanRun => [{ text, role: 'narrative' }];

export type PostMeta = { source: string; sourceUrl: string; publishedAt: string };

function photoFields(photo: Photo | null): Pick<SlideCopy, 'photoUrl' | 'photoCredit'> {
  return photo ? { photoUrl: photo.url, photoCredit: photo.credit } : {};
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
      return { ...base, layoutVariant: 'quote', quoteText: run(s.quote!.text), quoteBy: s.quote!.speaker, altText: `${s.headline.text}: "${s.quote!.text}" (${s.quote!.speaker})` };
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

export function toRenderPost(
  draft: FilledDraft,
  photos: { cover: Photo | null; slides: Array<Photo | null> },
  meta: PostMeta,
): Post {
  const slides: SlideCopy[] = [
    { position: 0, layoutVariant: 'cover', headline: run(draft.cover), altText: draft.cover, ...photoFields(photos.cover) },
    ...draft.slides.map((s, i) => storySlide(s, i + 1, photos.slides[i] ?? null)),
    { position: draft.slides.length + 1, layoutVariant: 'follow', storySpecificLine: draft.follow, altText: draft.follow },
  ];
  return {
    format: 'carousel',
    storyType: 'tech',
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    publishedAt: meta.publishedAt,
    issueNumber: 0,
    slides,
    caption: draft.caption.text,
    attributionBlock: attributionBlock([photos.cover, ...photos.slides]),
  };
}
