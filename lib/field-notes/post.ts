/**
 * Plain mappers between the three stages: the Writer's draft becomes the render's slide inputs,
 * and the render's layouts become the stored `Slide` records (types.ts). No model, no network.
 */
import { isSupersededRenderCap } from './caps';
import type { SlideInput, SlideLayout } from './render/layout';
import { fitProblemStrings, type FitProblem } from './render/problems';
import type { Block, Slide } from './types';
import { coverHeadline } from './write/caps';
import type { PostDraft } from './write/types';

export type PostPhoto = { photoId: string; bytes: Buffer };

/**
 * One slide input per slide: the cover (code-written headline over a photo of our faces; the "field notes"
 * hand line is the render's), one `tip` slide per draft slide (the value headline, then the plain body
 * paragraph; the slide never carries `name` or `tryIt`, which go to the caption), then the Follow slide. `photos` must hold exactly 1 cover + N tip + 1 follow photos, in slide
 * order. `coverHeadline` defaults to the contract's `${n} AI tips to try` (write/caps.ts).
 */
export function draftToSlideInputs(o: { draft: PostDraft; photos: readonly PostPhoto[]; coverHeadline?: string }): SlideInput[] {
  const { draft, photos } = o;
  const n = draft.slides.length;
  if (photos.length !== n + 2) throw new Error(`the post needs ${n + 2} photos: 1 cover + ${n} tip + 1 follow (has ${photos.length})`);
  const cover = photos[0]!;
  const inputs: SlideInput[] = [{ kind: 'cover', photoId: cover.photoId, photo: cover.bytes, headline: o.coverHeadline ?? coverHeadline(n), seed: `${cover.photoId}:0` }];
  draft.slides.forEach((s, i) => {
    const photo = photos[i + 1]!;
    inputs.push({ kind: 'tip', photoId: photo.photoId, photo: photo.bytes, headline: s.headline, body: s.body, seed: `${photo.photoId}:${i + 1}` });
  });
  const follow = photos[n + 1]!;
  inputs.push({ kind: 'follow', photoId: follow.photoId, photo: follow.bytes, seed: `${follow.photoId}:${n + 1}` });
  return inputs;
}

/** The stored slides (types.ts `Slide`): each block's role, text, region, fill and the darkening applied under it. */
export function layoutsToSlides(layouts: readonly SlideLayout[]): Slide[] {
  return layouts.map((layout) => ({
    kind: layout.kind,
    photoId: layout.photoId,
    blocks: layout.blocks.map((b): Block => ({ role: b.role, text: b.text, region: b.region, fill: b.fill, darken: b.darken })),
  }));
}

/** Layout problem kinds that mean the render itself is broken or its furniture is wrong, not that text is tight. */
const RENDER_KINDS = new Set<FitProblem['kind']>(['logo_missing', 'logo_overlap']);

/**
 * The render's problems, sorted for the post row: `fit` (text and placement, shown on review),
 * `render` (the logo), `fatal` (fonts did not load: the fit proves nothing, so the run fails
 * before anything is stored). The layout's interim `cap_exceeded` is dropped (lib/field-notes/caps.ts).
 */
export function splitProblems(problems: readonly FitProblem[]): { fit: string[]; render: string[]; fatal: string[] } {
  const kept = problems.filter((p) => !isSupersededRenderCap(p));
  return {
    fatal: fitProblemStrings(kept.filter((p) => p.kind === 'font_missing')),
    render: fitProblemStrings(kept.filter((p) => RENDER_KINDS.has(p.kind))),
    fit: fitProblemStrings(kept.filter((p) => p.kind !== 'font_missing' && !RENDER_KINDS.has(p.kind))),
  };
}
