/**
 * Static handwriting for `hand` blocks (cover and Follow only, Tommy 2026-11-06): the Hershey Sans pen
 * strokes the explainers' Brain Break close card writes in, drawn as inline SVG. A port of `handwrite()`
 * in explainers/world-kit/draw.js without the write-on animation: an even, round-capped pen line, under
 * the kit's wobble filter frozen at its default seed (feTurbulence seed 4, scale 3), so every render of
 * the same text draws the same strokes. Nothing here imports explainers/ (the social worker may not ship it).
 */
import { HERSHEY_CAP, HERSHEY_SANS, type HersheyGlyph } from './hershey-sans';
import type { Rect } from '../types';

/** The kit's wobble, frozen: `defs({ wobble = 3, wobbleSeed = 4 })` in draw.js. */
export const HAND_WOBBLE = { baseFrequency: 0.022, numOctaves: 2, seed: 4, scale: 3 } as const;
/** Pen width as a share of the cap height (draw.js: `size * 0.08 * weight`); a touch heavier so it holds up over a photo. */
export const HAND_PEN_RATIO = 0.08;
export const HAND_WEIGHT = 1.25;

const glyph = (ch: string): HersheyGlyph => HERSHEY_SANS[ch] ?? HERSHEY_SANS[' ']!;

/** Advance width of `text` in px at cap height `size` (draw.js `handwriteWidth`). */
export function handwriteWidth(text: string, size: number): number {
  const k = size / HERSHEY_CAP;
  return [...text].reduce((w, ch) => w + glyph(ch).a * k, 0);
}

export type HandStrokes = {
  /** Pen strokes in px, relative to the text's ink box top-left (so the ink starts at 0,0). */
  strokes: Array<Array<[number, number]>>;
  /** Tight box of the pen centre-lines (the stroke width is added on top by `penWidth`). */
  ink: { w: number; h: number };
  /** Distance from the ink top to the baseline. */
  baseline: number;
  penWidth: number;
};

/** The strokes of `text` at cap height `size`, shifted so the ink box starts at the origin. */
export function handStrokes(text: string, size: number, weight = HAND_WEIGHT): HandStrokes {
  const k = size / HERSHEY_CAP;
  let cursor = 0;
  const raw: Array<Array<[number, number]>> = [];
  for (const ch of text) {
    const g = glyph(ch);
    for (const s of g.s) raw.push(s.map(([gx, gy]) => [cursor + gx * k, -gy * k] as [number, number]));
    cursor += g.a * k;
  }
  const pts = raw.flat();
  if (pts.length === 0) return { strokes: [], ink: { w: 0, h: 0 }, baseline: 0, penWidth: 0 };
  const x0 = Math.min(...pts.map((p) => p[0]));
  const y0 = Math.min(...pts.map((p) => p[1]));
  const x1 = Math.max(...pts.map((p) => p[0]));
  const y1 = Math.max(...pts.map((p) => p[1]));
  return {
    strokes: raw.map((s) => s.map(([x, y]) => [x - x0, y - y0] as [number, number])),
    ink: { w: x1 - x0, h: y1 - y0 },
    baseline: -y0,
    penWidth: Math.max(2, size * HAND_PEN_RATIO * weight),
  };
}

/** Room the SVG needs around the ink: half the pen plus the wobble's reach. */
export function handPad(h: HandStrokes): number {
  return Math.ceil(h.penWidth / 2 + HAND_WOBBLE.scale + 2);
}

/**
 * The SVG for a hand block whose INK box is `ink` (canvas px): a padded <svg> placed so the pen lines
 * land exactly on `ink`. The wobble filter works in user space, so round caps are never clipped.
 */
export function handSvg(text: string, size: number, ink: Rect, color: string, id: string): string {
  const h = handStrokes(text, size);
  const pad = handPad(h);
  const w = Math.ceil(h.ink.w + 2 * pad);
  const ht = Math.ceil(h.ink.h + 2 * pad);
  const fid = `fn-wobble-${id}`;
  const d = h.strokes.map((s) => `M ${s.map(([x, y]) => `${(x + pad).toFixed(1)} ${(y + pad).toFixed(1)}`).join(' L ')}`).join(' ');
  const safe = text.replace(/[<>&"]/g, '');
  return `<svg class="fn-handsvg" data-hand="${safe}" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}" style="position:absolute;left:${(ink.x - pad).toFixed(1)}px;top:${(ink.y - pad).toFixed(1)}px;overflow:visible">`
    + `<defs><filter id="${fid}" filterUnits="userSpaceOnUse" x="-20" y="-20" width="${w + 40}" height="${ht + 40}">`
    + `<feTurbulence type="fractalNoise" baseFrequency="${HAND_WOBBLE.baseFrequency}" numOctaves="${HAND_WOBBLE.numOctaves}" seed="${HAND_WOBBLE.seed}" result="n"/>`
    + `<feDisplacementMap in="SourceGraphic" in2="n" scale="${HAND_WOBBLE.scale}" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`
    + `<g data-ink="hand" filter="url(#${fid})"><path d="${d}" fill="none" stroke="${color}" stroke-width="${h.penWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}
