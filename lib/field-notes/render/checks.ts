/**
 * Fit checks for a Field Notes slide (no AI): text inside the safe margins at or above its minimum size
 * (reported `too_long`, never shrunk), white text readable on the RENDERED (darkened) photo behind each
 * block, no cover text over a face's clear zone, nothing in the logo's clear space.
 * Static checks read only the layout; rendered checks add the browser's measurements and pixels.
 */
import { colorContrast, hexLuminance, lumStats, sampleRegion, WORST_CASE_FLOOR, type RawImage } from './contrast';
import { expandRect, faceZone, insideRect, rectsOverlap } from './geometry';
import { SAMPLE_PAD, type SlideLayout } from './layout';
import { CANVAS_H, CANVAS_W } from './photo';
import type { FitProblem } from './problems';
import type { Rect } from '../types';

/** Rendered pixels pass a hair under the planner's threshold (JPEG and anti-aliasing rounding). */
export const CHECK_TOLERANCE = 0.97;

export type MeasuredBlock = {
  index: number;
  /** Tight box of the rendered text or pen strokes (canvas px). */
  box: Rect;
  /** A word is wider than its block. */
  overflows: boolean;
};

export type Measure = {
  fontsLoaded: boolean;
  blocks: MeasuredBlock[];
};

/** Checks that need only the layout. */
export function staticChecks(layout: SlideLayout): FitProblem[] {
  const out: FitProblem[] = [];
  const safe: Rect = { x: layout.margin, y: layout.margin, w: CANVAS_W - 2 * layout.margin, h: CANVAS_H - 2 * layout.margin };
  const canvas: Rect = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };

  for (const b of layout.blocks) {
    if (!insideRect(b.region, safe, 1)) out.push({ kind: 'out_of_bounds', slide: 0, block: b.index, message: `${b.role} region ${fmt(b.region)} leaves the ${layout.margin}px safe margins` });
    // Only the cover is laid out round faces; every other slide stays centred (Tommy, 2026-11-06).
    if (layout.kind === 'cover') {
      for (const face of layout.faces) {
        if (rectsOverlap(b.region, faceZone(face))) out.push({ kind: 'face_overlap', slide: 0, block: b.index, message: `${b.role} region ${fmt(b.region)} is over or too close to a face at ${fmt(face)}` });
      }
    }
  }
  if (layout.logo) {
    const l = layout.logo;
    if (!insideRect(l.rect, canvas, 1)) out.push({ kind: 'logo_overlap', slide: 0, message: 'the logo is not fully on the canvas' });
    if (l.clear < l.hHeight) out.push({ kind: 'logo_overlap', slide: 0, message: `logo clear space ${l.clear}px is under the wordmark's H height ${Math.round(l.hHeight)}px` });
    for (const b of layout.blocks) {
      if (rectsOverlap(b.region, expandRect(l.rect, l.clear))) out.push({ kind: 'logo_overlap', slide: 0, block: b.index, message: `${b.role} region ${fmt(b.region)} is inside the logo's clear space` });
    }
  }
  return out;
}

/** Checks that need the browser's measurements and the rendered backdrop (the darkened photo, text hidden). */
export function renderedChecks(layout: SlideLayout, measure: Measure, backdrop: RawImage): FitProblem[] {
  const out: FitProblem[] = [];
  const safe: Rect = { x: layout.margin, y: layout.margin, w: CANVAS_W - 2 * layout.margin, h: CANVAS_H - 2 * layout.margin };
  if (!measure.fontsLoaded) out.push({ kind: 'font_missing', slide: 0, message: 'Pragmatica Extended Bold or Roboto did not load; no fit measured here proves anything' });

  for (const m of measure.blocks) {
    const b = layout.blocks[m.index];
    if (!b) continue;
    if (m.overflows) out.push({ kind: 'too_long', slide: 0, block: m.index, message: `${b.role} "${b.text.slice(0, 60)}" does not fit its block at ${b.fontPx}px, the minimum it may use on this slide` });
    // The browser's line box is a little taller than the cap-to-descender ink (font ascent): 8px of slack.
    if (!insideRect(m.box, safe, 8)) out.push({ kind: 'out_of_bounds', slide: 0, block: m.index, message: `${b.role} text ${fmt(m.box)} leaves the ${layout.margin}px safe margins` });
    if (layout.kind === 'cover') {
      for (const face of layout.faces) if (rectsOverlap(m.box, face)) out.push({ kind: 'face_overlap', slide: 0, block: m.index, message: `${b.role} text is over a face at ${fmt(face)}` });
    }
    if (layout.logo && rectsOverlap(m.box, layout.logo.zone)) out.push({ kind: 'logo_overlap', slide: 0, block: m.index, message: `${b.role} text is inside the logo's clear space` });

    const c = colorContrast(lumStats(sampleRegion(backdrop, expandRect(m.box, SAMPLE_PAD))), hexLuminance(b.color), b.large);
    const need = c.required * CHECK_TOLERANCE;
    const floor = Math.min(c.required, WORST_CASE_FLOOR) * CHECK_TOLERANCE;
    if (c.mean < need || c.worst < floor) {
      out.push({ kind: 'low_contrast', slide: 0, block: m.index, message: `${b.role} ${b.color} on the rendered photo: mean contrast ${c.mean.toFixed(2)}, worst ${c.worst.toFixed(2)}, needs ${c.required}` });
    }
  }
  return out;
}

function fmt(r: Rect): string {
  return `[${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}]`;
}
