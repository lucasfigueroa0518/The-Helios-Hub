import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import type { Asset, PictureFace, PictureRegions, VisualsInventory } from '@/lib/reel-ai-drama/types';

import { reanchor } from './anchors';
import { sidecarPath } from './boxes';
import { mainFace, STRONG_FACE_SCORE, trustFaces } from './faces';
import { hamming, phash } from './filters';
import { cleanCutRaw, gradeCut, type CutBox } from './transparent';
import type { FaceBox } from './types';

/**
 * Measured pictures (iteration 9): what code needs to place a picture without seeing it, from its real pixels. Free,
 * local, once per asset, stored on the inventory record's `regions`:
 *   visible  the tight box of its opaque pixels, 0–1 of the image
 *   shape    a coarse alpha grid, so overlap is computed on the silhouette and not on a rectangle
 *   tone     a coarse luminance grid, so ink can be measured on the picture
 * A logo's plain background is keyed to transparent here; one that can't be keyed carries `chip`, and the stage
 * prints it on a deliberate paper chip (never a bare white box). Grids are strings, row by row: shape '0' | '1',
 * tone one hex digit of luminance per cell, '.' where the picture is transparent.
 *
 * Honest pictures (iteration 10), so nothing downstream trusts a bad measurement:
 *   faces          each with `score` and `trusted`; only a trusted face may be a head, and `Asset.face` is only ever one
 *   cut            cutouts are cleaned here (transparent.ts) and graded; a rejected cut carries `garbled:cut_rejected`, so
 *                  everything that picks a cutout or an anchor passes it by
 *   open_edges     the sides where the picture stops at the image's border, for layout to hide
 *   sharp_width_px the widest it stays sharp: its real detail (not its pixel count) with a little room
 *   phash, dup_of  near-identical pictures count as one
 *   brightness     mean luminance; expression: from the look step, no new call
 */

export const SHAPE_CELLS = 32;
export const TONE_CELLS = 16;
/** Alpha above this counts as picture. */
const OPAQUE = 40;
/** A plain background: this share of the border within COLOUR_TOLERANCE of its median colour. */
export const PLAIN_BORDER = 0.92;
const COLOUR_TOLERANCE = 34;
/** Keyed logos above this size are worked on at this size: a logo is never shown larger. */
const LOGO_MAX_SIDE = 1400;

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** The three measurements of one raw RGBA buffer. Pure. */
export function measureRaw(data: Uint8Array | Buffer, width: number, height: number): Pick<PictureRegions, 'visible' | 'shape' | 'tone'> {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  const alpha = new Float64Array(SHAPE_CELLS * SHAPE_CELLS);
  const count = new Float64Array(SHAPE_CELLS * SHAPE_CELLS);
  const toneSum = new Float64Array(TONE_CELLS * TONE_CELLS);
  const toneWeight = new Float64Array(TONE_CELLS * TONE_CELLS);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(SHAPE_CELLS - 1, Math.floor((y / height) * SHAPE_CELLS));
    const ty = Math.min(TONE_CELLS - 1, Math.floor((y / height) * TONE_CELLS));
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3]!;
      if (a >= OPAQUE) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      const sx = Math.min(SHAPE_CELLS - 1, Math.floor((x / width) * SHAPE_CELLS));
      alpha[sy * SHAPE_CELLS + sx]! += a >= OPAQUE ? 1 : 0;
      count[sy * SHAPE_CELLS + sx]! += 1;
      const tx = Math.min(TONE_CELLS - 1, Math.floor((x / width) * TONE_CELLS));
      const w = a / 255;
      toneSum[ty * TONE_CELLS + tx]! += w * (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);
      toneWeight[ty * TONE_CELLS + tx]! += w;
    }
  }
  const visible = x1 >= x0
    ? { x: round4(x0 / width), y: round4(y0 / height), w: round4((x1 - x0 + 1) / width), h: round4((y1 - y0 + 1) / height) }
    : { x: 0, y: 0, w: 1, h: 1 };
  let shape = '';
  for (let i = 0; i < alpha.length; i++) shape += count[i]! > 0 && alpha[i]! / count[i]! >= 0.25 ? '1' : '0';
  let tone = '';
  for (let i = 0; i < toneSum.length; i++) {
    tone += toneWeight[i]! > 0.5 ? Math.round(clamp(toneSum[i]! / toneWeight[i]! / 255) * 15).toString(16) : '.';
  }
  return { visible, shape: { w: SHAPE_CELLS, h: SHAPE_CELLS, cells: shape }, tone: { w: TONE_CELLS, h: TONE_CELLS, cells: tone } };
}

/** Measure a picture file. Worked at up to 512px: the grids are coarse. */
export async function measurePicture(file: string): Promise<Pick<PictureRegions, 'visible' | 'shape' | 'tone'>> {
  const { data, info } = await sharp(file).ensureAlpha().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  return measureRaw(data, info.width, info.height);
}

/** The median colour of a raw RGBA buffer's border, and the share of the border close to it. Pure. */
export function borderColour(data: Uint8Array | Buffer, width: number, height: number): { colour: [number, number, number]; plain: number; clear: number } {
  const ring = Math.max(1, Math.round(Math.min(width, height) * 0.015));
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  let clear = 0, total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= ring && x < width - ring && y >= ring && y < height - ring) continue;
      const i = (y * width + x) * 4;
      total += 1;
      if (data[i + 3]! < OPAQUE) { clear += 1; continue; }
      rs.push(data[i]!); gs.push(data[i + 1]!); bs.push(data[i + 2]!);
    }
  }
  const med = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 255;
  const colour: [number, number, number] = [med(rs), med(gs), med(bs)];
  let near = 0;
  for (let k = 0; k < rs.length; k++) if (Math.hypot(rs[k]! - colour[0], gs[k]! - colour[1], bs[k]! - colour[2]) <= COLOUR_TOLERANCE) near += 1;
  return { colour, plain: rs.length ? near / rs.length : 1, clear: total ? clear / total : 0 };
}

/**
 * Key a plain background to transparent from the border inwards (a white letter inside a blue disc stays), its edge
 * feathered by colour distance. Returns the keyed buffer, or null when the background isn't plain. Pure.
 */
export function keyBackground(data: Uint8Array | Buffer, width: number, height: number): Uint8Array | null {
  const { colour, plain, clear } = borderColour(data, width, height);
  if (clear >= 0.5 || plain < PLAIN_BORDER) return null;
  const out = Uint8Array.from(data);
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const dist = (p: number) => Math.hypot(data[p * 4]! - colour[0], data[p * 4 + 1]! - colour[1], data[p * 4 + 2]! - colour[2]);
  const push = (p: number) => { if (!seen[p] && (data[p * 4 + 3]! < OPAQUE || dist(p) <= COLOUR_TOLERANCE)) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    out[p * 4 + 3] = 0;
    const x = p % width, y = (p - x) / width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }
  // The pixels on the keyed edge fade with their distance from the background's colour.
  for (let p = 0; p < width * height; p++) {
    if (seen[p]) continue;
    const x = p % width, y = (p - x) / width;
    const edge = (x > 0 && seen[p - 1]) || (x < width - 1 && seen[p + 1]) || (y > 0 && seen[p - width]) || (y < height - 1 && seen[p + width]);
    if (edge) out[p * 4 + 3] = Math.round(out[p * 4 + 3]! * clamp((dist(p) - COLOUR_TOLERANCE) / 60, 0.25, 1));
  }
  return out;
}

export const isLogoAsset = (a: Pick<Asset, 'kind' | 'flags'>): boolean => a.kind === 'logo' || a.flags.includes('logo');

/** The logo with its plain background keyed, written beside it as `<stem>.keyed.png`; null when it can't be keyed (the stage prints it on a chip). */
export async function keyLogoFile(abs: string): Promise<string | null> {
  const { data, info } = await sharp(abs).ensureAlpha().resize({ width: LOGO_MAX_SIDE, height: LOGO_MAX_SIDE, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const { clear } = borderColour(data, info.width, info.height);
  if (clear >= 0.5) return abs; // already transparent around its ink
  const keyed = keyBackground(data, info.width, info.height);
  if (!keyed) return null;
  const m = measureRaw(keyed, info.width, info.height);
  const left = (m.shape.cells.match(/1/g)?.length ?? 0) / m.shape.cells.length;
  // Nothing left, or the background wasn't really around it: not a keyed logo.
  if (left < 0.005 || left > 0.97) return null;
  const out = path.join(path.dirname(abs), `${path.basename(abs, path.extname(abs))}.keyed.png`);
  await sharp(Buffer.from(keyed), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(out);
  return out;
}

/** A picture on the frame may be drawn this much past its real detail before it reads soft. */
export const ENLARGE_LIMIT = 1.25;
/** The frame's width, which `cut.sharpness` is a share of. */
const FRAME_W = 1080;
/** Shrink factors tried: a picture has no real detail finer than the largest one that loses almost nothing. */
const SHRINK_STEPS = [1.5, 2, 3, 4, 6, 8];
/** "Almost nothing": this share of the edge energy survives shrinking and enlarging back. */
const ENERGY_KEPT = 0.85;
/** Two random pictures differ in about 32 of the hash's 64 bits, spread ±4: this few is the same picture, not chance. */
export const DUP_BITS = 14;
/** An open side: an unbroken run of picture along the border this long, as a share of the side (a stray hair isn't a side). */
const OPEN_RUN = 0.03;

/** Sum of squared steps between neighbouring pixels, over `mask` when given. */
function edgeEnergy(grey: Uint8Array, w: number, h: number, mask: Uint8Array | null): number {
  let sum = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      if (mask && !mask[i]) continue;
      const dx = grey[i + 1]! - grey[i]!;
      const dy = grey[i + w]! - grey[i]!;
      sum += dx * dx + dy * dy;
    }
  }
  return sum;
}

async function shrunkAndBack(grey: Uint8Array, w: number, h: number, factor: number): Promise<Uint8Array> {
  const raw = { width: w, height: h, channels: 1 as const };
  const small = await sharp(Buffer.from(grey), { raw }).resize(Math.max(2, Math.round(w / factor)), Math.max(2, Math.round(h / factor)), { fit: 'fill', kernel: 'lanczos3' }).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const back = await sharp(small.data, { raw: { width: small.info.width, height: small.info.height, channels: 1 } }).resize(w, h, { fit: 'fill', kernel: 'cubic' }).extractChannel(0).raw().toBuffer();
  return new Uint8Array(back);
}

/**
 * How many pixels wide a picture's real detail is: its width over the largest shrink it survives. An enlarged or blurred
 * picture loses little when shrunk, a sharp one loses a lot. A cutout is read inside its silhouette, away from the edge the
 * cut drew. Flat pictures have no detail to lose: their own width.
 */
export async function detailWidth(file: string): Promise<number> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const grey = new Uint8Array(w * h);
  const solid = new Uint8Array(w * h);
  let clear = 0;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3]!;
    solid[i] = a >= 200 ? 1 : 0;
    if (!solid[i]) clear += 1;
    grey[i] = 0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!;
  }
  let mask: Uint8Array | null = null;
  if (clear) {
    // Away from the cut's edge by the widest ringing of the largest shrink, one row and column at a time.
    const m = Math.ceil(SHRINK_STEPS[SHRINK_STEPS.length - 1]! * 2);
    const inner = new Uint8Array(w * h);
    const count = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 1 : solid[y * w + x]!);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        inner[y * w + x] = count(x - m, y) && count(x + m, y) && count(x, y - m) && count(x, y + m) && solid[y * w + x] ? 1 : 0;
      }
    }
    const left = inner.reduce((n, v) => n + v, 0);
    if (left >= w * h * 0.02) mask = inner;
    else if (w * h - clear >= w * h * 0.02) mask = solid;
    // Grey behind the picture would read as a hard edge: paint it with the picture's mean.
    let sum = 0, n = 0;
    for (let i = 0; i < w * h; i++) if (solid[i]) { sum += grey[i]!; n += 1; }
    const mean = n ? Math.round(sum / n) : 128;
    for (let i = 0; i < w * h; i++) if (!solid[i]) grey[i] = mean;
  }
  const whole = edgeEnergy(grey, w, h, mask);
  if (!whole) return w;
  let survived = 1;
  for (const f of SHRINK_STEPS) {
    if (w / f < 16 || h / f < 16) break;
    if (edgeEnergy(await shrunkAndBack(grey, w, h, f), w, h, mask) / whole < ENERGY_KEPT) break;
    survived = f;
  }
  return Math.round(w / survived);
}

export const sharpWidth = (detail: number) => Math.round(detail * ENLARGE_LIMIT);

/** A picture that was upscaled has only its first pixels' worth of detail, whatever a measure of the larger one says. Pure. */
export function sharpOf(detail: number, a: Pick<Asset, 'flags' | 'width'>): number {
  const at = a.flags?.map((f) => /^upscaled:([\d.]+)x$/.exec(f)?.[1]).find(Boolean);
  const native = at && Number(at) > 1 && a.width ? a.width / Number(at) : Infinity;
  return Math.min(sharpWidth(detail), sharpWidth(native));
}

const FOCUS_PX = 96;
/** Blurs for what stands out: its own size against what's around it. */
const FOCUS_NEAR = 1;
const FOCUS_FAR = 16;
/** How far over the mean a cell has to stand out, in spreads. */
const FOCUS_SPREAD = 1.3;
const FOCUS_LEAST = 0.002;
const FOCUS_NEIGHBOUR = 0.07;
const FOCUS_ALONG = 0.3;
const FOCUS_MOST = 0.5;
const boxBlur = (src: Float32Array, w: number, h: number, r: number): Float32Array => {
  let cur = src;
  for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
    const out = new Float32Array(cur.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let n = 0, sum = 0;
        for (let k = -r; k <= r; k++) {
          const X = x + k * dx, Y = y + k * dy;
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          sum += cur[Y * w + X]!;
          n += 1;
        }
        out[y * w + x] = sum / n;
      }
    }
    cur = out;
  }
  return cur;
};
/**
 * Where a picture's subject is, from its pixels: the strongest blob that stands out from what's around it and doesn't run
 * off the picture (what touches the edge is background: sky, a horizon, a floor). Null when nothing stands out. Pure.
 */
export function pictureFocus(rgb: Uint8Array | Buffer, w: number, h: number, channels = 3): { x: number; y: number; w: number; h: number } | null {
  const chans = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) chans[c]![i] = rgb[i * channels + c]!;
  const near = chans.map((c) => boxBlur(c, w, h, FOCUS_NEAR));
  const far = chans.map((c) => boxBlur(c, w, h, FOCUS_FAR));
  const score = new Float32Array(w * h);
  let mean = 0;
  for (let i = 0; i < w * h; i++) {
    score[i] = Math.hypot(near[0]![i]! - far[0]![i]!, near[1]![i]! - far[1]![i]!, near[2]![i]! - far[2]![i]!);
    mean += score[i]!;
  }
  mean /= w * h;
  let spread = 0;
  for (const v of score) spread += (v - mean) ** 2;
  spread = Math.sqrt(spread / (w * h));
  const line = mean + FOCUS_SPREAD * spread;
  const seen = new Uint8Array(w * h);
  const blobs: { x0: number; x1: number; y0: number; y1: number; sum: number; n: number }[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || score[s]! < line) continue;
    const stack = [s];
    seen[s] = 1;
    const b = { x0: w, x1: 0, y0: h, y1: 0, sum: 0, n: 0 };
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
      b.sum += score[i]!;
      b.n += 1;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && score[j]! >= line) { seen[j] = 1; stack.push(j); }
      }
    }
    if (b.x0 === 0 || b.y0 === 0 || b.x1 === w - 1 || b.y1 === h - 1) continue;
    if (b.n / (w * h) < FOCUS_LEAST) continue;
    blobs.push(b);
  }
  if (!blobs.length) return null;
  // A subject seldom stands out all at once: what stands out right beside the strongest part is the same thing.
  blobs.sort((a, b) => b.sum - a.sum);
  const best = { ...blobs[0]! };
  const reach = FOCUS_NEIGHBOUR * Math.max(w, h);
  for (let again = true; again; ) {
    again = false;
    for (const b of blobs) {
      if (b.x0 >= best.x0 && b.x1 <= best.x1 && b.y0 >= best.y0 && b.y1 <= best.y1) continue;
      const gap = Math.max(b.x0 - best.x1, best.x0 - b.x1, b.y0 - best.y1, best.y0 - b.y1);
      // Parts along one line are one thing further apart: a long building, a ring seen from the side.
      const level = b.y0 <= best.y1 && best.y0 <= b.y1;
      if (gap > (level ? FOCUS_ALONG * w : reach)) continue;
      best.x0 = Math.min(best.x0, b.x0); best.x1 = Math.max(best.x1, b.x1); best.y0 = Math.min(best.y0, b.y0); best.y1 = Math.max(best.y1, b.y1);
      again = true;
    }
  }
  const box = { x: best.x0 / w, y: best.y0 / h, w: (best.x1 - best.x0 + 1) / w, h: (best.y1 - best.y0 + 1) / h };
  if (box.w * box.h > FOCUS_MOST) return null;
  return { x: round4(box.x), y: round4(box.y), w: round4(box.w), h: round4(box.h) };
}

/** How much of the edge row, over the words' width, has to differ from its usual tone for letters to be running off. */
const EDGE_INK_SHARE = 0.03;
const EDGE_INK_DIFF = 40;
/**
 * Where to crop a picture to lose a block of words its own edge cuts: letters run off the top (or bottom) right over a line that
 * sits within a line and a half of it. `grey` is one channel, w×h. Null when nothing's cut. Pure.
 */
export function edgeCutOf(grey: Uint8Array | Buffer, w: number, h: number, words: readonly { box: { x: number; y: number; w: number; h: number } }[]): { top?: number; bottom?: number } | null {
  if (!words.length) return null;
  const inkOn = (row: number, x0: number, x1: number) => {
    const cells: number[] = [];
    for (let x = Math.max(0, Math.floor(x0 * w)); x < Math.min(w, Math.ceil(x1 * w)); x++) cells.push(grey[row * w + x]!);
    if (!cells.length) return false;
    const mid = [...cells].sort((a, b) => a - b)[cells.length >> 1]!;
    return cells.filter((v) => Math.abs(v - mid) > EDGE_INK_DIFF).length / cells.length >= EDGE_INK_SHARE;
  };
  const out: { top?: number; bottom?: number } = {};
  const top = words.reduce((a, b) => (b.box.y < a.box.y ? b : a));
  const line = words.filter((x) => Math.abs(x.box.y - top.box.y) < top.box.h);
  const x0 = Math.min(...line.map((x) => x.box.x)), x1 = Math.max(...line.map((x) => x.box.x + x.box.w));
  if (top.box.y <= 1.5 * top.box.h && [0, 1].some((r) => inkOn(r, x0, x1))) out.top = round4(top.box.y + top.box.h + 0.01);
  const low = words.reduce((a, b) => (b.box.y + b.box.h > a.box.y + a.box.h ? b : a));
  const lowLine = words.filter((x) => Math.abs(x.box.y - low.box.y) < low.box.h);
  const lx0 = Math.min(...lowLine.map((x) => x.box.x)), lx1 = Math.max(...lowLine.map((x) => x.box.x + x.box.w));
  if (1 - low.box.y - low.box.h <= 1.5 * low.box.h && [h - 1, h - 2].some((r) => inkOn(r, lx0, lx1))) out.bottom = round4(low.box.y - 0.01);
  return out.top !== undefined || out.bottom !== undefined ? out : null;
}

/** How far from grey the solid pixels of a logo are, 0–1. Pure. */
export function inkChroma(rgba: Uint8Array | Buffer, w: number, h: number): number {
  let sum = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3]! < 128) continue;
    const r = rgba[i * 4]!, g = rgba[i * 4 + 1]!, b = rgba[i * 4 + 2]!;
    sum += Math.max(r, g, b) - Math.min(r, g, b);
    n += 1;
  }
  return n ? round4(sum / n / 255) : 0;
}

/** Mean luminance over the picture's opaque pixels, and which sides it stops at. Pure. */
export function brightnessAndEdges(data: Uint8Array | Buffer, w: number, h: number): Required<Pick<PictureRegions, 'brightness' | 'open_edges'>> {
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3]! / 255;
    sum += a * (0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!);
    weight += a;
  }
  const side = (len: number, at: (k: number) => number) => {
    let run = 0;
    let best = 0;
    for (let k = 0; k < len; k++) {
      run = data[at(k) * 4 + 3]! >= 128 ? run + 1 : 0;
      if (run > best) best = run;
    }
    return best >= Math.max(2, len * OPEN_RUN);
  };
  return {
    brightness: round4(weight ? sum / weight / 255 : 0),
    open_edges: {
      left: side(h, (k) => k * w),
      right: side(h, (k) => k * w + w - 1),
      top: side(w, (k) => k),
      bottom: side(w, (k) => (h - 1) * w + k),
    },
  };
}

/** A head's skin, in the wide YCbCr range that holds every skin tone; share needed in the middle of the box. */
const SKIN_SHARE = 0.25;
/** Below this chroma a picture is black and white, and has no colour to read. */
const GREY_CHROMA = 6;
/** Picture above a head's box: hair and crown are at most about one box height; more is a body, and the box isn't its head. */
const HEIGHTS_ABOVE = 1.25;

/**
 * Do these pixels look like a head: on the picture, and on a cutout with no body above it. `skin` (a weak box only: a sure
 * one needs no second opinion, and may be lit any colour) also wants skin in the middle of the box. Pure.
 */
export function looksLikeHead(data: Uint8Array | Buffer, w: number, h: number, box: CutBox, isCut: boolean, skinToo = true): boolean {
  const x0 = Math.floor(box.x * w), y0 = Math.floor(box.y * h);
  const x1 = Math.min(w, Math.ceil((box.x + box.w) * w)), y1 = Math.min(h, Math.ceil((box.y + box.h) * h));
  if (x1 <= x0 || y1 <= y0) return false;
  const mx = Math.round((x1 - x0) * 0.2), my = Math.round((y1 - y0) * 0.2);
  let skin = 0, chroma = 0, solid = 0, seen = 0;
  for (let y = y0 + my; y < y1 - my; y++) {
    for (let x = x0 + mx; x < x1 - mx; x++) {
      const i = (y * w + x) * 4;
      seen += 1;
      if (data[i + 3]! < 128) continue;
      solid += 1;
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      chroma += Math.abs(cb - 128) + Math.abs(cr - 128);
      if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) skin += 1;
    }
  }
  if (!seen || solid / seen < 0.5) return false;
  if (skinToo && chroma / solid >= GREY_CHROMA && skin / solid < SKIN_SHARE) return false;
  if (isCut) {
    let above = 0, columns = 0;
    for (let x = x0 + mx; x < x1 - mx; x++) {
      columns += 1;
      for (let y = 0; y < y0; y++) if (data[(y * w + x) * 4 + 3]! >= 128) above += 1;
    }
    if (columns && above / columns > (y1 - y0) * HEIGHTS_ABOVE) return false;
  }
  return true;
}

/** A transparent cut of a real picture: a drawing's alpha is its ink, not a cut. */
export const isCutAsset = (a: Pick<Asset, 'flags' | 'made'>): boolean => !a.made && (a.flags.includes('cutout') || a.flags.includes('transparent'));
const isPersonCut = (a: Pick<Asset, 'kind' | 'people' | 'flags'>) => a.kind === 'person_photo' && a.people.length > 0 && !a.flags.includes('cutout_thing');
/** The flag every pick of a cutout or an anchor already passes by (anchors.ts `isGarbledAsset`). */
export const CUT_REJECTED_FLAG = 'garbled:cut_rejected';
/** The source photo's colours are read at this size. */
const SOURCE_SAMPLE_PX = 256;
/** The remover's own answer, kept beside the cleaned file so a clean-up always starts from it. */
export const rawCutPath = (abs: string) => path.join(path.dirname(abs), `${path.basename(abs, path.extname(abs))}.raw.png`);

/** Cleans a cut file from the remover's own answer, and returns its measures. Nothing is kept of a cut that can't be cleaned but the remover's answer. */
export async function cleanCutFile(abs: string, opts: { person: boolean; head?: CutBox | null; sourceFile?: string | null }) {
  const raw = rawCutPath(abs);
  const { data, info } = await sharp(fs.existsSync(raw) ? raw : abs).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // The photo it was cut from says what the old background looked like, near enough at a small size.
  const shrunk = opts.sourceFile && fs.existsSync(opts.sourceFile) ? await sharp(opts.sourceFile).removeAlpha().resize({ width: SOURCE_SAMPLE_PX, height: SOURCE_SAMPLE_PX, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true }).catch(() => null) : null;
  const { clean, ...measures } = cleanCutRaw(data, info.width, info.height, { person: opts.person, head: opts.head ?? null, source: shrunk ? { data: shrunk.data, channels: shrunk.info.channels } : null });
  if (clean) {
    if (!fs.existsSync(raw)) fs.copyFileSync(abs, raw);
    await sharp(Buffer.from(clean), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(`${abs}.tmp.png`);
    fs.renameSync(`${abs}.tmp.png`, abs);
  } else if (fs.existsSync(raw)) fs.copyFileSync(raw, abs);
  return measures;
}

const readJson = (file: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** The photo a cut came from, by its flag. */
const sourceOf = (a: Asset, inventory: VisualsInventory): Asset | null => {
  const id = a.flags.find((f) => f.startsWith('cutout_of:'))?.slice('cutout_of:'.length);
  return id ? inventory.assets.find((x) => x.id === id) ?? null : null;
};

/** The faces measured on the photo a cut came from, when the cut keeps that photo's canvas. */
async function sameCanvasFaces(cutAbs: string, sourceAbs: string): Promise<FaceBox[] | null> {
  if (!fs.existsSync(sourceAbs)) return null;
  const [cut, source] = await Promise.all([sharp(cutAbs).metadata(), sharp(sourceAbs).metadata()]);
  if (cut.width !== source.width || cut.height !== source.height) return null;
  const side = readJson(sidecarPath(sourceAbs));
  const faces = Array.isArray(side?.faces) ? (side.faces as PictureFace[]) : [];
  return faces.length ? asBoxes(faces) : null;
}

const asBoxes = (faces: readonly PictureFace[]): FaceBox[] => faces.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, score: f.score ?? 1 }));

/**
 * One asset measured, free and local: each field once (`force`: again, from the picture's first state). `faces`: the
 * detector's boxes when the caller has them, else the record's, else its box sidecar's. The sidecar gets the verdicts too:
 * the project files read faces from it. Mutates the record. Throws on an unreadable picture; `measureInventory` makes that a note.
 */
export async function measureAsset(a: Asset, root: string, opts: { faces?: readonly FaceBox[] | null; expression?: string | null; force?: boolean; source?: Asset | null } = {}): Promise<void> {
  const abs = path.join(root, a.file);
  if (!fs.existsSync(abs)) return;
  const force = opts.force === true;
  let file = abs;
  const r: Partial<PictureRegions> = { ...(a.regions ?? {}) };
  if ((!r.shape || force) && isLogoAsset(a) && !a.flags.includes('logo_keyed')) {
    const keyed = await keyLogoFile(abs);
    if (keyed) file = keyed;
    delete r.chip;
    if (!keyed) r.chip = true;
    if (file !== abs) {
      a.file = path.relative(root, file).split(path.sep).join('/');
      if (!a.flags.includes('logo_keyed')) a.flags.push('logo_keyed');
    }
  }

  // Faces first: the clean-up keeps the person they name.
  const isCut = isCutAsset(a);
  const side = sidecarPath(file);
  const sidecar = fs.existsSync(side) ? readJson(side) : null;
  const sideFaces = Array.isArray(sidecar?.faces) ? (sidecar.faces as PictureFace[]) : null;
  const legacy = a.face ? [{ ...a.face, score: 1 }] : null;
  // A cut made later has no faces of its own; on the same canvas, its photo's are its own.
  const sourceAbs = opts.source?.file ? path.join(root, opts.source.file) : null;
  const sourceFaces = isCut && sourceAbs ? await sameCanvasFaces(abs, sourceAbs) : null;
  const known = opts.faces ?? r.faces ?? sideFaces ?? legacy;
  const found = known?.length ? known : sourceFaces ?? known;
  let headChanged = false;
  if (found && (force || r.faces === undefined || r.faces.some((f) => f.trusted === undefined) || (Boolean(sourceFaces?.length) && !r.faces.length))) {
    const source = isCut && fs.existsSync(rawCutPath(file)) ? rawCutPath(file) : file;
    const { data, info } = await sharp(source).ensureAlpha().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const judged = trustFaces(asBoxes(found), { people: a.people, plausible: (b) => looksLikeHead(data, info.width, info.height, b, isCut, b.score < STRONG_FACE_SCORE) });
    r.faces = judged;
    const main = mainFace(judged);
    headChanged = JSON.stringify(main) !== JSON.stringify(a.face);
    if (judged.length) a.face = main;
  }

  // The old background's colours only come off with the photo in hand; a cut saved before its photo was known is cleaned again (always from its raw file).
  const photoInHand = Boolean(sourceAbs && fs.existsSync(sourceAbs));
  if (isCut && (!r.cut || force || headChanged || (photoInHand && !r.cut.with_source))) {
    const person = isPersonCut(a);
    const head = person ? mainFace(r.faces as FaceBox[] | undefined) : null;
    const m = await cleanCutFile(file, { person, head, sourceFile: sourceAbs });
    const detail = await detailWidth(file);
    const sharpness = round4(clamp(sharpWidth(detail) / FRAME_W));
    const grade = gradeCut({ ...m, sharpness }, person);
    r.cut = { grade, edge_softness: m.edge_softness, islands: m.islands, straight_cuts: m.straight_cuts, sharpness, fringe: m.fringe, with_source: photoInHand };
    a.flags = a.flags.filter((f) => f !== CUT_REJECTED_FLAG);
    if (grade === 'rejected') a.flags.push(CUT_REJECTED_FLAG);
    r.sharp_width_px = sharpWidth(detail);
    // The file changed: what was measured on it goes.
    delete r.shape;
    delete r.brightness;
    delete r.phash;
  }

  if (!r.shape || force) Object.assign(r, await measurePicture(file));
  if (r.brightness === undefined || !r.open_edges || force) {
    const { data, info } = await sharp(file).ensureAlpha().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    Object.assign(r, brightnessAndEdges(data, info.width, info.height));
  }
  if (r.sharp_width_px === undefined || (force && !isCut)) r.sharp_width_px = sharpOf(await detailWidth(file), a);
  if (isLogoAsset(a) && (r.chroma === undefined || force)) {
    const { data, info } = await sharp(file).ensureAlpha().resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    r.chroma = inkChroma(data, info.width, info.height);
  }
  const measuredWords = (r as { words?: { box: { x: number; y: number; w: number; h: number } }[] }).words ?? [];
  if (!isCut && !isLogoAsset(a) && measuredWords.length && (r.edge_cut === undefined || force)) {
    const { data, info } = await sharp(file).flatten({ background: '#808080' }).greyscale().resize({ width: 480, withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const cut = edgeCutOf(data, info.width, info.height, measuredWords);
    if (cut) r.edge_cut = cut;
    else delete r.edge_cut;
  }
  if (!isCut && !isLogoAsset(a) && (r.focus === undefined || force)) {
    const { data, info } = await sharp(file).flatten({ background: '#808080' }).resize({ width: FOCUS_PX, height: FOCUS_PX, fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    r.focus = pictureFocus(data, info.width, info.height);
  }
  if (!r.phash || force) r.phash = await phash(file);
  if (opts.expression !== undefined) r.expression = opts.expression;
  else if (r.expression === undefined) r.expression = null;
  a.regions = r as PictureRegions;

  if (sidecar) {
    let changed = false;
    const lift = typeof sidecar.lift === 'string' && sidecar.lift ? path.join(path.dirname(side), path.basename(sidecar.lift)) : null;
    if (lift && fs.existsSync(lift) && (force || !fs.existsSync(rawCutPath(lift)))) {
      const m = await cleanCutFile(lift, { person: a.people.length > 0 });
      if (gradeCut({ ...m, sharpness: 1 }, a.people.length > 0) === 'rejected') {
        sidecar.lift = null;
        changed = true;
        a.flags = a.flags.filter((f) => f !== 'lift');
        if ('lift' in r) (r as { lift?: unknown }).lift = null;
      }
    }
    if (r.faces && JSON.stringify(sidecar.faces) !== JSON.stringify(r.faces)) {
      sidecar.faces = r.faces;
      changed = true;
    }
    if (changed) fs.writeFileSync(side, `${JSON.stringify(sidecar, null, 1)}\n`);
  }
}

/** Near-identical pictures: each picture's `dup_of` is the first earlier one it repeats, or null. A cutout is only compared with cutouts (cut from a photo it's that photo used another way), and logos and made pictures don't count. Pure over the records. */
export function markDuplicates(inventory: VisualsInventory): void {
  const counts = (a: Asset) => !a.made && !isLogoAsset(a) && Boolean(a.regions?.phash);
  const related = (a: Asset, b: Asset) => isCutAsset(a) !== isCutAsset(b);
  const seen: Asset[] = [];
  for (const a of inventory.assets) {
    if (!a.regions?.shape && !counts(a)) continue;
    if (!counts(a)) {
      a.regions!.dup_of = null;
      continue;
    }
    const of = seen.find((b) => !related(a, b) && hamming(a.regions!.phash!, b.regions!.phash!) <= DUP_BITS);
    a.regions!.dup_of = of?.id ?? null;
    if (a.regions!.cut?.grade !== 'rejected') seen.push(a);
  }
}

/**
 * Every asset measured once: `regions` on its record, a logo keyed to a new file, a cutout cleaned and graded, duplicates
 * marked, and the anchors of rejected cuts moved to the person's next best portrait. Fails open per asset: a note each, and
 * that picture falls back to its rectangle. `root` is the folder its `file` is relative to. `force` measures everything
 * again (the free replay). Mutates the inventory's records and returns the notes.
 */
export async function measureInventory(inventory: VisualsInventory, root: string, opts: { force?: boolean } = {}): Promise<string[]> {
  const notes: string[] = [];
  for (const a of inventory.assets) {
    try {
      await measureAsset(a, root, { force: opts.force, source: sourceOf(a, inventory) });
    } catch (error) {
      notes.push(`measure: ${a.id} skipped (${error instanceof Error ? error.message.slice(0, 100) : String(error)})`);
    }
  }
  markDuplicates(inventory);
  const rejected = inventory.assets.filter((a) => a.regions?.cut?.grade === 'rejected' && a.anchor_for).map((a) => a.id);
  if (rejected.length) inventory.assets = reanchor(inventory, rejected).inventory.assets;
  return notes;
}
