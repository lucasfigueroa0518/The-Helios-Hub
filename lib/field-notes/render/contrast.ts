/**
 * The readability check (CONTRACT-v4 section 6), pure code: white text by default, measured per block
 * on the photo pixels behind it AFTER the gentle darkening the layout applies there. The mean luminance
 * must clear WCAG for the type size and the worst-case percentile (p90, for light text) the floor, so
 * one bright patch does not slip through. Off-black is #171717, never pure #000.
 */
import type { Rect, TextFill } from '../types';

export const WHITE_HEX = '#FFFFFF';
export const OFF_BLACK_HEX = '#171717';
/** 40px and up on the 1080 canvas counts as large type. */
export const LARGE_TYPE_PX = 40;
export const CONTRAST_NORMAL = 4.5;
export const CONTRAST_LARGE = 3;
/** The worst-case percentile must still clear this (AA for large type) even when the mean passes. */
export const WORST_CASE_FLOOR = 3;

const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB colour (0-255 channels). */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * LINEAR[Math.round(r)]! + 0.7152 * LINEAR[Math.round(g)]! + 0.0722 * LINEAR[Math.round(b)]!;
}

/** WCAG contrast ratio of two relative luminances (1 to 21). */
export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function hexLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return relativeLuminance(r, g, b);
}

export function isLargeType(fontPx: number): boolean {
  return fontPx >= LARGE_TYPE_PX;
}

export function requiredContrast(large: boolean): number {
  return large ? CONTRAST_LARGE : CONTRAST_NORMAL;
}

/** Packed RGB triplets (3 bytes per pixel). */
export type Samples = Uint8Array;

export type RawImage = { data: Uint8Array; width: number; height: number; channels: 1 | 2 | 3 | 4 };

const MAX_SAMPLES = 24_000;

/** Samples the pixels of `rect` (canvas px), strided so a region stays cheap to analyse. */
export function sampleRegion(img: RawImage, rect: Rect): Samples {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.h));
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const stride = Math.max(1, Math.ceil(Math.sqrt((w * h) / MAX_SAMPLES)));
  const out: number[] = [];
  for (let y = y0; y < y1; y += stride) {
    for (let x = x0; x < x1; x += stride) {
      const i = (y * img.width + x) * img.channels;
      if (img.channels >= 3) out.push(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!);
      else out.push(img.data[i]!, img.data[i]!, img.data[i]!);
    }
  }
  return Uint8Array.from(out);
}

export type LumStats = { mean: number; p10: number; p90: number; n: number };

/** Mean and 10th/90th percentile relative luminance of the samples. */
export function lumStats(samples: Samples): LumStats {
  const n = Math.floor(samples.length / 3);
  if (n === 0) return { mean: 0, p10: 0, p90: 0, n: 0 };
  const lum = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    const l = relativeLuminance(samples[j]!, samples[j + 1]!, samples[j + 2]!);
    lum[i] = l;
    sum += l;
  }
  lum.sort();
  const at = (q: number) => lum[Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))))]!;
  return { mean: sum / n, p10: at(0.1), p90: at(0.9), n };
}

export type ColorContrast = { mean: number; worst: number; ok: boolean; required: number };

/** Contrast of a text colour against the region: the mean must clear the threshold, the worst percentile the floor. */
export function colorContrast(stats: LumStats, colorLum: number, large: boolean): ColorContrast {
  const required = requiredContrast(large);
  const mean = contrastRatio(colorLum, stats.mean);
  const worst = Math.min(contrastRatio(colorLum, stats.p10), contrastRatio(colorLum, stats.p90));
  return { mean, worst, required, ok: mean >= required && worst >= Math.min(required, WORST_CASE_FLOOR) };
}

export function colorPasses(samples: Samples, colorHex: string, opts: { large: boolean }): ColorContrast {
  return colorContrast(lumStats(samples), hexLuminance(colorHex), opts.large);
}

/** The samples as they look under a black overlay of strength `darken` (0-1), composited in sRGB as the browser does. */
export function darkenSamples(samples: Samples, darken: number): Samples {
  const k = 1 - Math.max(0, Math.min(1, darken));
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.round(samples[i]! * k);
  return out;
}

export function fillHex(fill: TextFill): string {
  return fill === 'white' ? WHITE_HEX : OFF_BLACK_HEX;
}
