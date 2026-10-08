/**
 * Adaptive framing (Tommy, 2026-10-07: "take into account how pixelized an
 * image can become if you try to fit it to a frame all the way … when it's
 * nice for an image to go end to end"). Plain code from the photo's own
 * pixel size and the frame it would fill.
 *
 *   fill   object-fit: cover, edge to edge. Only when the photo needs at most
 *          SHARP_UPSCALE enlargement and cropping keeps most of it.
 *   matte  the photo shown whole and sharp (never enlarged past
 *          SHARP_UPSCALE), floating on a blurred, darkened copy of itself
 *          that fills the frame. For small photos and shapes far from the
 *          frame's (a portrait in a landscape panel).
 *
 * Full-bleed slides and spreads have no matte: they're allowed only when the
 * photo fills them within BLEED_MAX_UPSCALE (render/buckets.ts). Darkened
 * backdrops hide more: BACKDROP_MAX_UPSCALE.
 */

/** Enlargement that still looks sharp on a phone screen. */
export const SHARP_UPSCALE = 1.25;
/** Most a full-bleed photo (1080×1350) or spread (2160×1350) may be enlarged. */
export const BLEED_MAX_UPSCALE = 1.5;
/** Most a darkened backdrop (stat, quote) may be enlarged: it's dimmed and softened. */
export const BACKDROP_MAX_UPSCALE = 2.2;
/** Fill a panel only when the cover crop keeps at least this share of the photo. */
export const MIN_KEPT_SHARE = 0.6;

export type Size = { w: number; h: number };
export type Treatment = 'fill' | 'matte';

export const SLIDE: Size = { w: 1080, h: 1350 };
export const SPREAD: Size = { w: 2160, h: 1350 };

/** How much the photo is enlarged to cover the frame (above 1: upscaled). */
export const coverScale = (p: Size, f: Size) => Math.max(f.w / p.w, f.h / p.h);
/** The share of the photo a cover crop keeps (1: none cropped). */
export const keptShare = (p: Size, f: Size) => {
  const s = coverScale(p, f);
  return (f.w * f.h) / (p.w * s * p.h * s);
};

/** Can this photo cover the frame end to end without pixelating past `max`? Unknown size: no. */
export function fillsSharp(p: Size | null | undefined, f: Size, max = BLEED_MAX_UPSCALE): boolean {
  return !!p && p.w > 0 && p.h > 0 && coverScale(p, f) <= max;
}

/** A panel's treatment: fill when sharp and mostly kept, else matte. Unknown size: matte (never risk blowing it up). */
export function panelTreatment(p: Size | null | undefined, f: Size): Treatment {
  if (!p || !p.w || !p.h) return 'matte';
  return coverScale(p, f) <= SHARP_UPSCALE && keptShare(p, f) >= MIN_KEPT_SHARE ? 'fill' : 'matte';
}

/** The matte photo's largest box inside the frame: whole, never past SHARP_UPSCALE (px). Unknown size: the frame. */
export function matteBox(p: Size | null | undefined, f: Size, pad = 40): Size {
  const inner = { w: f.w - 2 * pad, h: f.h - 2 * pad };
  if (!p || !p.w || !p.h) return inner;
  const s = Math.min(inner.w / p.w, inner.h / p.h, SHARP_UPSCALE);
  return { w: Math.round(p.w * s), h: Math.round(p.h * s) };
}
