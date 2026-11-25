/**
 * Busyness of a photo window: edge density from a Sobel gradient plus luminance spread. The tip layout
 * reads it only to decide whether the centre is clearly busier than nearby space (the block may then shift
 * a little, CONTRACT-v4 section 6). There is no region hunting any more: text sits in the middle by default.
 */
import type { Rect } from '../types';
import type { RawImage } from './contrast';

/** Analysis runs at half resolution (a light blur from the area-average resize, then Sobel). */
export const ANALYSIS_SCALE = 2;
/** A pixel is an edge when its Sobel magnitude passes this (about a 28 gray-level step). */
export const EDGE_MAGNITUDE = 110;
const CELL_PX = 90;

export type Analysis = {
  /** Analysis grid size. */
  w: number;
  h: number;
  scale: number;
  /** Integral images (w+1)*(h+1): edge pixels, luminance, luminance squared. */
  edge: Float64Array;
  lum: Float64Array;
  lum2: Float64Array;
};

function integral(w: number, h: number, value: (i: number) => number): Float64Array {
  const W = w + 1;
  const out = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += value(y * w + x);
      out[(y + 1) * W + (x + 1)] = out[y * W + (x + 1)]! + row;
    }
  }
  return out;
}

/** Pure core: a gray image (0-255) to the integral images the window scorer reads. */
export function analyzeGray(gray: Uint8Array | Float32Array, w: number, h: number, scale = ANALYSIS_SCALE): Analysis {
  const mag = new Uint8Array(w * h);
  const at = (x: number, y: number) => gray[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      mag[y * w + x] = Math.hypot(gx, gy) > EDGE_MAGNITUDE ? 1 : 0;
    }
  }
  return {
    w, h, scale,
    edge: integral(w, h, (i) => mag[i]!),
    lum: integral(w, h, (i) => gray[i]!),
    lum2: integral(w, h, (i) => gray[i]! * gray[i]!),
  };
}

export async function analyzeCanvas(raw: RawImage): Promise<Analysis> {
  const sharp = (await import('sharp')).default;
  const w = Math.round(raw.width / ANALYSIS_SCALE);
  const h = Math.round(raw.height / ANALYSIS_SCALE);
  const { data } = await sharp(Buffer.from(raw.data), { raw: { width: raw.width, height: raw.height, channels: raw.channels } })
    .greyscale()
    .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return analyzeGray(new Uint8Array(data), w, h, ANALYSIS_SCALE);
}

function boxSum(I: Float64Array, W: number, x0: number, y0: number, x1: number, y1: number): number {
  return I[y1 * W + x1]! - I[y0 * W + x1]! - I[y1 * W + x0]! + I[y0 * W + x0]!;
}

export type WindowStats = { edgeDensity: number; std: number; maxCellDensity: number; /** Mean luminance (0-255). */ mean: number };

/** Edge density and luminance spread of a canvas-pixel rect. */
export function windowStats(a: Analysis, rect: Rect): WindowStats {
  const W = a.w + 1;
  const x0 = Math.max(0, Math.floor(rect.x / a.scale));
  const y0 = Math.max(0, Math.floor(rect.y / a.scale));
  const x1 = Math.min(a.w, Math.ceil((rect.x + rect.w) / a.scale));
  const y1 = Math.min(a.h, Math.ceil((rect.y + rect.h) / a.scale));
  const n = Math.max(1, (x1 - x0) * (y1 - y0));
  const edges = boxSum(a.edge, W, x0, y0, x1, y1);
  const mean = boxSum(a.lum, W, x0, y0, x1, y1) / n;
  const variance = Math.max(0, boxSum(a.lum2, W, x0, y0, x1, y1) / n - mean * mean);
  const cols = Math.min(12, Math.max(1, Math.round((x1 - x0) * a.scale / CELL_PX)));
  const rows = Math.min(8, Math.max(1, Math.round((y1 - y0) * a.scale / CELL_PX)));
  let maxCell = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx0 = x0 + Math.floor(((x1 - x0) * c) / cols);
      const cx1 = x0 + Math.floor(((x1 - x0) * (c + 1)) / cols);
      const cy0 = y0 + Math.floor(((y1 - y0) * r) / rows);
      const cy1 = y0 + Math.floor(((y1 - y0) * (r + 1)) / rows);
      const cn = Math.max(1, (cx1 - cx0) * (cy1 - cy0));
      maxCell = Math.max(maxCell, boxSum(a.edge, W, cx0, cy0, cx1, cy1) / cn);
    }
  }
  return { edgeDensity: edges / n, std: Math.sqrt(variance), maxCellDensity: maxCell, mean };
}

/** One number for how busy a window is (0 is flat): edges weigh most, luminance spread next. */
export function busyness(s: WindowStats): number {
  return s.edgeDensity * 4 + (s.std / 255) * 1.5;
}
