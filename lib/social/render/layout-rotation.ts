/**
 * Layout rotation (spec §5.3): no 3 consecutive slides share a layout.
 * Renderer-only: it changes how a slide is laid out, never what it says.
 *
 * Text slides without a photo alternate between copy at the top and copy low.
 * Slides that carry headline + body + photo can change layout:
 *   photo below (text slide default) · photo on top (text slide) ·
 *   full-bleed photo with text at the bottom (image slide), scene photos only.
 * Stat, quote and landing slides keep theirs; a run of 3 the rotation
 * can't break is reported, not forced.
 */
import type { SlideCopy } from './types';

export type Layout = 'photo-below' | 'photo-top' | 'full-bleed' | 'spread' | 'text-only' | 'text-only-low' | 'stat' | 'quote' | 'landing' | 'cover' | 'follow';

const SWAPPABLE: Layout[] = ['photo-below', 'photo-top', 'full-bleed'];

export function layoutOf(s: SlideCopy): Layout {
  if (s.panoramaSide) return 'spread';
  switch (s.layoutVariant) {
    case 'cover':
    case 'follow':
    case 'quote':
    case 'landing':
      return s.layoutVariant;
    case 'stat':
    case 'split_stat':
    case 'data_block':
      return 'stat';
    case 'image':
      return s.photoUrl ? 'full-bleed' : 'text-only';
    default:
      return !s.photoUrl ? (s.textAnchor === 'bottom' ? 'text-only-low' : 'text-only') : s.photoPlacement === 'top' ? 'photo-top' : 'photo-below';
  }
}

const canSwap = (s: SlideCopy) => (s.layoutVariant === 'text' || s.layoutVariant === 'image') && !s.panoramaSide;
/** Photo-less text slides alternate between copy at the top and copy low (Tommy, 2026-10-06). */
const TEXT_ONLY: Layout[] = ['text-only', 'text-only-low'];
/** Full bleed under text is for scene photos only (layout rule 3). */
const canBleed = (s: SlideCopy) => s.photoKind !== 'subject';

function withLayout(s: SlideCopy, layout: Layout): SlideCopy {
  if (layout === 'text-only' || layout === 'text-only-low') return { ...s, layoutVariant: 'text', textAnchor: layout === 'text-only-low' ? 'bottom' : 'top' };
  if (layout === 'full-bleed') return { ...s, layoutVariant: 'image', photoPlacement: undefined };
  return { ...s, layoutVariant: 'text', photoPlacement: layout === 'photo-top' ? 'top' : 'below' };
}

export type RotationResult = {
  slides: SlideCopy[];
  /** "slide 4: photo-below → photo-top" (1-based, cover = slide 1). */
  changes: string[];
  /** Runs of 3 the rotation couldn't break (no swappable slide in them). */
  unresolved: string[];
};

export function rotateLayouts(input: SlideCopy[]): RotationResult {
  const slides = [...input];
  const changes: string[] = [];
  const unresolved: string[] = [];
  const same = (i: number) => i >= 2 && layoutOf(slides[i]!) === layoutOf(slides[i - 1]!) && layoutOf(slides[i - 1]!) === layoutOf(slides[i - 2]!);

  for (let i = 2; i < slides.length; i++) {
    if (!same(i)) continue;
    // Change the latest swappable slide in the run: this one, else the one before.
    const target = [i, i - 1].find((k) => canSwap(slides[k]!));
    if (target === undefined) {
      unresolved.push(`slides ${i - 1}–${i + 1}: three ${layoutOf(slides[i]!)} in a row, none can change layout`);
      continue;
    }
    const from = layoutOf(slides[target]!);
    const neighbours = new Set([slides[target - 1], slides[target + 1]].filter(Boolean).map((s) => layoutOf(s!)));
    const options = !slides[target]!.photoUrl ? TEXT_ONLY : SWAPPABLE.filter((l) => l !== 'full-bleed' || canBleed(slides[target]!));
    const to = options.find((l) => l !== from && !neighbours.has(l)) ?? options.find((l) => l !== from)!;
    slides[target] = withLayout(slides[target]!, to);
    changes.push(`slide ${target + 1}: ${from} → ${to}`);
  }
  return { slides, changes, unresolved };
}
