import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

/**
 * A marker drawing to animatable strokes (RC-48): the drawing is thresholded to one-bit ink, traced
 * along its centerlines with autotrace (`-centerline`, open paths, no fills), split into single strokes,
 * and ordered the way a hand draws: the longest stroke first (the outline), then the rest top to bottom,
 * left to right. Specks shorter than MIN_STROKE are dropped. Output coordinates are the image's pixels.
 */

export const MIN_STROKE = 12;
export const MAX_SIDE = 900;

export type Strokes = { width: number; height: number; strokes: string[] };

export function autotraceBin(): string {
  if (process.env.AUTOTRACE_BIN) return process.env.AUTOTRACE_BIN;
  return ['/opt/homebrew/bin/autotrace', '/usr/local/bin/autotrace', '/usr/bin/autotrace'].find((p) => fs.existsSync(p)) ?? 'autotrace';
}

/** Split an SVG path's data into one path per `M` (each subpath is one pen stroke). */
export function splitSubpaths(d: string): string[] {
  return d
    .split(/(?=M)/)
    .map((s) => s.trim())
    .filter((s) => /^M[\d.\s-]/.test(s) && /[LCQ]/.test(s));
}

/** Points of a path (its command endpoints and control points): enough for ordering and length. */
export function pathPoints(d: string): [number, number][] {
  const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
  return pts;
}

export function approxLength(d: string): number {
  const p = pathPoints(d);
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]);
  return L;
}

/** Hand order: the longest stroke, then top-to-bottom, left-to-right by each stroke's start. */
export function handOrder(strokes: string[]): string[] {
  const kept = strokes.filter((s) => approxLength(s) >= MIN_STROKE);
  if (!kept.length) return [];
  const longest = kept.reduce((a, b) => (approxLength(b) > approxLength(a) ? b : a));
  const rest = kept.filter((s) => s !== longest);
  const start = (s: string) => pathPoints(s)[0] ?? [0, 0];
  rest.sort((a, b) => {
    const [ax, ay] = start(a), [bx, by] = start(b);
    return Math.abs(ay - by) > 24 ? ay - by : ax - bx;
  });
  return [longest, ...rest];
}

/** Trace a drawing (any image sharp reads; dark ink on a light ground) into strokes. */
export async function traceDrawing(src: string, { bin = autotraceBin() }: { bin?: string } = {}): Promise<Strokes> {
  const meta = await sharp(src).metadata();
  const scale = Math.min(1, MAX_SIDE / Math.max(meta.width ?? MAX_SIDE, meta.height ?? MAX_SIDE));
  const width = Math.round((meta.width ?? MAX_SIDE) * scale), height = Math.round((meta.height ?? MAX_SIDE) * scale);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-trace-'));
  try {
    // Transparent areas count as paper; ink is anything darker than mid grey.
    const { data } = await sharp(src).resize(width, height).flatten({ background: '#ffffff' }).greyscale().threshold(140).raw().toBuffer({ resolveWithObject: true });
    const pbm = path.join(dir, 'ink.pbm');
    const rowBytes = Math.ceil(width / 8);
    const bits = Buffer.alloc(rowBytes * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[y * width + x]! < 128) bits[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    fs.writeFileSync(pbm, Buffer.concat([Buffer.from(`P4\n${width} ${height}\n`), bits]));
    const res = spawnSync(bin, ['-centerline', '-output-format', 'svg', pbm], { encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    if (res.error || res.status !== 0) throw new Error(`autotrace failed: ${(res.error?.message ?? res.stderr ?? '').trim().slice(-300)}`);
    const ds = [...res.stdout.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]!);
    return { width, height, strokes: handOrder(ds.flatMap(splitSubpaths)) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
