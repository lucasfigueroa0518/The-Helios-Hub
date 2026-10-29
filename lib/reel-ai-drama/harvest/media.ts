import fs from 'node:fs';

import sharp from 'sharp';

import type { VisualKind } from '@/lib/reel-ai-drama/types';

import type { TextBox } from './types';

/**
 * Media normalisation at harvest copy (ITERATION-2 W1/W2): every raster saved under `media/` is
 * re-encoded with its long edge at most 2160 px, so frames load before the renderer captures (Rosewood
 * shipped 3840 px originals, 214 MB). Anchors below 1200 px on the short edge are upscaled first
 * (Real-ESRGAN, live.ts), so a character's recurring image never looks soft.
 */

export const MAX_LONG_EDGE = 2160;
/** An anchor recurs, often large: below this short edge it is upscaled (Lucas, 00:25 note). */
export const ANCHOR_MIN_SHORT = 1200;
const JPEG_QUALITY = 88;

/** Kinds whose text or flat colour needs lossless pixels; photos become JPEG unless they carry alpha. */
const LOSSLESS_KINDS: ReadonlySet<VisualKind> = new Set<VisualKind>(['web_page', 'social_post', 'headline', 'document', 'paper', 'map', 'chart', 'logo']);

/** The Real-ESRGAN scale for an anchor (2 when it reaches the floor, else 4), or null when it is big enough. */
export function anchorUpscale(width: number, height: number): 2 | 4 | null {
  const short = Math.min(width, height);
  if (!short || short >= ANCHOR_MIN_SHORT) return null;
  return short * 2 >= ANCHOR_MIN_SHORT ? 2 : 4;
}

export function normalisedFormat(kind: VisualKind, hasAlpha: boolean): 'jpeg' | 'png' {
  return hasAlpha || LOSSLESS_KINDS.has(kind) ? 'png' : 'jpeg';
}

/** The size an image of `width`×`height` is saved at (never enlarged). */
export function normalisedSize(width: number, height: number): { width: number; height: number; scale: number } {
  const long = Math.max(width, height);
  if (!long || long <= MAX_LONG_EDGE) return { width, height, scale: 1 };
  const scale = MAX_LONG_EDGE / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

export type Normalised = { file: string; width: number; height: number; scale: number };

/**
 * Re-encodes `input` into `<destNoExt>.jpg|.png` (EXIF orientation applied, long edge ≤ 2160 px).
 * Vector files are copied unchanged.
 */
export async function normaliseImage(input: string, destNoExt: string, kind: VisualKind): Promise<Normalised> {
  const meta = await sharp(input).metadata();
  const w0 = (meta.autoOrient?.width ?? meta.width) || 0;
  const h0 = (meta.autoOrient?.height ?? meta.height) || 0;
  if (meta.format === 'svg') {
    const file = `${destNoExt}.svg`;
    if (file !== input) fs.copyFileSync(input, file);
    return { file, width: w0, height: h0, scale: 1 };
  }
  const size = normalisedSize(w0, h0);
  const format = normalisedFormat(kind, meta.hasAlpha === true);
  const file = `${destNoExt}.${format === 'jpeg' ? 'jpg' : 'png'}`;
  let img = sharp(input, { animated: false }).rotate();
  if (size.scale < 1) img = img.resize(size.width, size.height, { fit: 'fill' });
  const tmp = `${file}.part`;
  const info = format === 'jpeg' ? await img.flatten({ background: '#ffffff' }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(tmp) : await img.png({ compressionLevel: 9 }).toFile(tmp);
  fs.renameSync(tmp, file);
  return { file, width: info.width, height: info.height, scale: size.scale };
}

/** Measured text boxes follow the image when it is resized. */
export function scaleBoxes(boxes: readonly TextBox[], scale: number): TextBox[] {
  if (scale === 1) return [...boxes];
  return boxes.map((b) => ({ ...b, x: Math.round(b.x * scale), y: Math.round(b.y * scale), w: Math.round(b.w * scale), h: Math.round(b.h * scale) }));
}
