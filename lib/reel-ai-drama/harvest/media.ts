import fs from 'node:fs';

import sharp from 'sharp';

import type { VisualKind } from '@/lib/reel-ai-drama/types';

import type { TextBox, Upscale } from './types';

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

// ── Upscale sanity (iteration 3) ────────────────────────────────────────────
// Rosewood v2's V21 (Altman's anchor) came back as shuffled tiles on black: the Real-ESRGAN wrapper always
// loads the ×4-only model and was asked for `-s 2`, so the binary laid ×4 tiles on a ×2 grid (live.ts now
// always runs the model at ×4 and resizes). Whatever the upscaler, its output must still be the input
// picture: shrunk back to a thumbnail it should match the input's thumbnail almost pixel for pixel.

/** Long edge of the thumbnails the check compares. */
export const UPSCALE_CHECK_PX = 96;
/** Mean per-pixel RGB difference (0–1) above which an upscale is garbled. A good ×4 measures ~0.01; V21 measured ~0.12. */
export const UPSCALE_MAX_MEAN_DIFF = 0.05;
/** Worst 12×12-px block of the thumbnail: one misplaced tile shows here even when the mean is fine. */
export const UPSCALE_MAX_BLOCK_DIFF = 0.2;
const BLOCK = 12;

export type UpscaleDiff = { mean: number; worstBlock: number };

/**
 * How far `output` strays from `input` once both are shrunk to the same thumbnail: the mean RGB difference
 * over the input's visible pixels (alpha ≥ 50%; all pixels when almost none are) and the worst block's mean.
 */
export async function upscaleDiff(input: string, output: string): Promise<UpscaleDiff> {
  const m = await sharp(input).metadata();
  const w0 = m.width ?? 0;
  const h0 = m.height ?? 0;
  if (!w0 || !h0) throw new Error('upscale check: the input has no size');
  const s = UPSCALE_CHECK_PX / Math.max(w0, h0);
  const w = Math.max(1, Math.round(w0 * s));
  const h = Math.max(1, Math.round(h0 * s));
  const thumb = (file: string) => sharp(file).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const [a, b] = await Promise.all([thumb(input), thumb(output)]);
  let visible = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i] >= 128) visible += 1;
  const all = visible < w * h * 0.01;
  const bw = Math.ceil(w / BLOCK);
  const blocks = new Array<{ d: number; n: number }>(bw * Math.ceil(h / BLOCK)).fill(null as never).map(() => ({ d: 0, n: 0 }));
  let d = 0;
  let n = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (!all && a[i + 3] < 128) continue;
      const px = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / (3 * 255);
      d += px;
      n += 1;
      const blk = blocks[Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)];
      blk.d += px;
      blk.n += 1;
    }
  }
  const worstBlock = Math.max(0, ...blocks.filter((k) => k.n >= (BLOCK * BLOCK) / 4).map((k) => k.d / k.n));
  return { mean: n ? d / n : 0, worstBlock };
}

export class GarbledUpscaleError extends Error {
  constructor(readonly diff: UpscaleDiff) {
    super(`garbled upscale (mean diff ${diff.mean.toFixed(3)}, worst block ${diff.worstBlock.toFixed(3)})`);
    this.name = 'GarbledUpscaleError';
  }
}

export const isGarbledUpscale = (error: unknown): error is GarbledUpscaleError => error instanceof GarbledUpscaleError;

/**
 * Upscales `input` into `output`, then checks the result: the size must be the factor asked for and the
 * picture must still be the input (`upscaleDiff`). A garbled or mis-sized result is deleted and thrown as
 * `GarbledUpscaleError`, so the caller keeps the original.
 */
export async function checkedUpscale(upscale: Upscale, input: string, output: string, scale: number): Promise<{ width: number; height: number; diff: UpscaleDiff }> {
  await upscale(input, output, scale);
  const [mi, mo] = await Promise.all([sharp(input).metadata(), sharp(output).metadata()]);
  const width = mo.width ?? 0;
  const height = mo.height ?? 0;
  const wantW = Math.round((mi.width ?? 0) * scale);
  const wantH = Math.round((mi.height ?? 0) * scale);
  const sized = Math.abs(width - wantW) <= Math.max(2, wantW * 0.01) && Math.abs(height - wantH) <= Math.max(2, wantH * 0.01);
  const diff = sized ? await upscaleDiff(input, output) : { mean: 1, worstBlock: 1 };
  if (!sized || diff.mean > UPSCALE_MAX_MEAN_DIFF || diff.worstBlock > UPSCALE_MAX_BLOCK_DIFF) {
    fs.rmSync(output, { force: true });
    throw new GarbledUpscaleError(diff);
  }
  return { width, height, diff };
}
