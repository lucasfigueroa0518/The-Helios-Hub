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
import { SPREAD_MIN_ASPECT, type Photo } from '@/lib/social/photos/find';
import type { FilledDraft, FilledSlide } from '@/lib/social/writer/draft';

import { templateById, type TemplateId } from './buckets';
import { DEFAULT_ICON, isIcon } from './icons';
import { rotateLayouts } from './layout-rotation';
import type { Post, SlideCanvas, SlideCopy, SpanRun } from './types';

const run = (text: string): SpanRun => [{ text, role: 'narrative' }];

export type PostMeta = { source: string; sourceUrl: string; publishedAt: string };

/**
 * Rule 3: photos that may show people (article and official images, headshots,
 * CEO and second photos) → their own region unless framed for full bleed; logos
 * are logo cards; stock photos, Commons search scenes and headquarters (a building) are scenes.
 */
export const photoKindOf = (photo: Photo): 'subject' | 'scene' | 'logo' =>
  photo.source === 'logo' ? 'logo' : photo.source === 'stock' || photo.source === 'hq' || photo.source === 'commons-search' ? 'scene' : 'subject';

/**
 * People full bleed when properly framed (photo spec §4; Tommy, 2026-10-07):
 * exactly one face the detector found, whole, roughly centred across, in the
 * upper half of the photo and neither tiny nor too tight. Otherwise the split
 * layout. The render check still fails any face under text; the design stage
 * then puts the slide back to split.
 */
export function canBleedPerson(photo: Photo): boolean {
  if (photoKindOf(photo) !== 'subject' || photo.faces?.length !== 1) return false;
  const f = photo.faces[0]!;
  const cx = f.x + f.w / 2;
  return cx >= 0.2 && cx <= 0.8 && f.y >= 0.03 && f.y + f.h <= 0.5 && f.h >= 0.06 && f.h <= 0.4;
}

/** Logos wider than this are sized by width on the card (Tommy, 2026-10-07). */
export const LOGO_WIDE_ASPECT = 2;

function photoFields(photo: Photo | null): Pick<SlideCopy, 'photoUrl' | 'photoCredit' | 'photoKind' | 'photoSize' | 'logoPlate' | 'logoWide' | 'photoBleed'> {
  if (!photo) return {};
  const wide = photo.source === 'logo' && !!photo.width && !!photo.height && photo.width / photo.height > LOGO_WIDE_ASPECT;
  return { photoUrl: photo.url, photoCredit: photo.credit, photoKind: photoKindOf(photo), ...(photo.width && photo.height ? { photoSize: { w: photo.width, h: photo.height } } : {}), ...(photo.plate ? { logoPlate: photo.plate } : {}), ...(wide ? { logoWide: true } : {}), ...(canBleedPerson(photo) ? { photoBleed: true } : {}) };
}

const iconOf = (name: string | null | undefined) => (isIcon(name) ? name : DEFAULT_ICON);

function storySlide(s: FilledSlide, position: number, photo: Photo | null, icon: string | null | undefined): SlideCopy {
  const base = { position, headline: run(s.headline.text), altText: s.headline.text, icon: iconOf(icon ?? s.icon), ...photoFields(photo) };
  const body = s.body ? { body: run(s.body.text) } : {};
  switch (s.type) {
    case 'stat': {
      if (s.numbers.length === 2) {
        const [a, b] = s.numbers;
        return { ...base, ...body, layoutVariant: 'split_stat', title: run(a!.value), numberNote: a!.counts, secondNumber: b!.value, secondNote: b!.counts };
      }
      const n = s.numbers[0]!;
      return { ...base, ...body, layoutVariant: 'stat', title: run(n.value), numberNote: n.counts };
    }
    case 'quote':
      return { ...base, ...body, layoutVariant: 'quote', quoteText: run(s.quote!.text), quoteBy: s.quote!.speaker, ...(s.quote!.speaker_role ? { quoteRole: s.quote!.speaker_role } : {}), photoIsSpeaker: !!photo?.qid && !!s.quote!.speaker_subject && photo.subject === s.quote!.speaker_subject, altText: `${s.headline.text}: "${s.quote!.text}" (${s.quote!.speaker})` };
    default:
      // The target look (photo spec §5a): a photo that can sit under text (a scene, or a person framed for it)
      // goes full bleed with the text at the bottom over the dark fade; the layout rotation varies it from there.
      return { ...base, ...body, layoutVariant: photo && (photoKindOf(photo) === 'scene' || canBleedPerson(photo)) ? 'image' : 'text' };
  }
}

/** Every photo credit, once each, for the caption's Photos: line. */
export function attributionBlock(photos: Array<Photo | null>): string | undefined {
  const credits = [...new Set(photos.filter((p): p is Photo => !!p).map((p) => p.credit))];
  return credits.length ? `Photos: ${credits.join('; ')}` : undefined;
}

export { SPREAD_MIN_ASPECT };

/**
 * Spread (spec §5.4): a slide marked spread_with_next shares its scene
 * photo with the next slide, left half and right half. Fallback: a subject
 * photo (rule 3), a photo not wide enough, or no next slide → both render
 * as normal slides.
 */
function applySpreads(slides: SlideCopy[], draft: FilledDraft, photos: Array<Photo | null>, spreadAt: number | null): SlideCopy[] {
  const out = [...slides];
  draft.slides.forEach((s, i) => {
    const p = photos[i];
    const a = out[i + 1];
    const b = out[i + 2];
    if (!(spreadAt === i || s.spread_with_next) || !p || !a || !b || b.layoutVariant === 'follow') return;
    if (photoKindOf(p) !== 'scene' || !p.width || !p.height || p.width / p.height < SPREAD_MIN_ASPECT) return;
    if (a.panoramaSide || b.panoramaSide) return;
    out[i + 1] = { ...a, panoramaSide: 'left' };
    out[i + 2] = { ...b, ...photoFields(p), photoFocus: undefined, panoramaSide: 'right' };
  });
  return out;
}

/** Photos per slide (cover first) and, optionally, the icons the chain settled on (cover first; else the draft's). */
export type DraftPhotos = { cover: Photo | null; slides: Array<Photo | null>; icons?: Array<string | null> };

/** Jev's layout (render/layout.ts): a template and a canvas per slide (cover first) and the spread's first slide. */
export type ChosenLayout = { templates: TemplateId[]; spreadAt: number | null; canvases?: SlideCanvas[] };

/**
 * The slides in draft order. Every slide carries its icon; the renderer draws
 * it when there is no photo. With a layout, each slide takes its template's
 * settings (text never changes); without one (stubs, tests), the default.
 */
export function draftSlides(draft: FilledDraft, photos: DraftPhotos, layout?: ChosenLayout): SlideCopy[] {
  const chosen = draft.cover_options[draft.chosen_cover - 1];
  const slides: SlideCopy[] = [
    { position: 0, layoutVariant: 'cover', headline: run(draft.cover), altText: draft.cover, icon: iconOf(photos.icons?.[0] ?? chosen?.icon), ...photoFields(photos.cover) },
    ...draft.slides.map((s, i) => storySlide(s, i + 1, photos.slides[i] ?? null, photos.icons?.[i + 1])),
    { position: draft.slides.length + 1, layoutVariant: 'follow', storySpecificLine: draft.follow, altText: draft.follow },
  ];
  const spread = applySpreads(slides, draft, photos.slides, layout?.spreadAt ?? null);
  if (!layout) return spread;
  return spread.map((s, i) => {
    const id = layout.templates[i];
    const canvas = layout.canvases?.[i];
    const laid = id ? { ...templateById(id).apply(s), template: id } : s;
    return canvas && canvas !== 'black' ? { ...laid, canvas } : laid;
  });
}

export function toRenderPost(
  draft: FilledDraft,
  photos: DraftPhotos,
  meta: PostMeta,
  layout?: ChosenLayout,
): Post {
  return {
    format: 'carousel',
    storyType: 'tech',
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    publishedAt: meta.publishedAt,
    issueNumber: 0,
    slides: rotateLayouts(draftSlides(draft, photos, layout)).slides,
    caption: draft.caption.text,
    attributionBlock: attributionBlock([photos.cover, ...photos.slides]),
  };
}
