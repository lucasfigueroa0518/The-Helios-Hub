import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

/**
 * Background removal for object photos, on macOS or Linux (Q4: the prep must be able to run on the
 * social worker). rembg (MIT; the u2net model, Apache 2.0) on the CPU. The binary is REMBG_BIN, else the
 * repo's .venv-rembg, else `rembg` on PATH. The result is trimmed to its visible pixels with a small
 * margin so the kit can size it by its real extent.
 */

export function rembgBin(root: string = process.cwd()): string {
  if (process.env.REMBG_BIN) return process.env.REMBG_BIN;
  const local = path.join(root, '.venv-rembg', 'bin', 'rembg');
  return fs.existsSync(local) ? local : 'rembg';
}

export type CutoutResult = { ok: true; width: number; height: number; coverage: number } | { ok: false; error: string };

/** Smallest share of the frame a usable cutout covers (less is a speck: the remover found nothing). */
export const MIN_COVERAGE = 0.04;

export async function removeBackground(src: string, out: string, { bin = rembgBin() }: { bin?: string } = {}): Promise<CutoutResult> {
  const raw = `${out}.raw.png`;
  const res = spawnSync(bin, ['i', '-m', 'u2net', src, raw], { encoding: 'utf8', timeout: 180_000 });
  if (res.error || res.status !== 0 || !fs.existsSync(raw)) {
    return { ok: false, error: `rembg failed: ${(res.error?.message ?? res.stderr ?? '').trim().slice(-300)}` };
  }
  try {
    return await trimToAlpha(raw, out);
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

/** Trim a transparent PNG to its opaque pixels (alpha > 24) plus a 2% margin; report the coverage. */
export async function trimToAlpha(src: string, out: string): Promise<CutoutResult> {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, solid = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * channels + 3] > 24) {
        solid++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const coverage = solid / (w * h);
  if (x1 < 0 || coverage < MIN_COVERAGE) return { ok: false, error: `nothing cut out (${(coverage * 100).toFixed(1)}% of the photo)` };
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
  const left = Math.max(0, x0 - m), top = Math.max(0, y0 - m);
  const width = Math.min(w, x1 + m + 1) - left, height = Math.min(h, y1 + m + 1) - top;
  await sharp(src).extract({ left, top, width, height }).png().toFile(out);
  return { ok: true, width, height, coverage };
}
