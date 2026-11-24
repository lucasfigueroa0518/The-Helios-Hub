/**
 * Band fit for the Morning Download photo band (MD-LFD D24 revised, D22; WC11: MD only). One Jev jev-preview call
 * carries the essential-subject box and the has-text flag (scripts/md-held-render.ts); code does the geometry
 * (decideBand, renderBand: scripts/story-crop.ts) and upscales only when the shown region is stretched 1.25× or more
 * (needsUpscale, esrganSharpen, bandFrame: scripts/story-upscale.ts). No upscaler binary → plain frame, noted.
 * Prompt text and constants copied verbatim from those scripts.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { box, image, noul, type Questions } from '@typesafe-ai/sdk';
import sharp from 'sharp';

import { findUpscaler, REALESRGAN_MODEL } from '@/lib/reel-ai-drama/harvest/live';
import { upscaleDiff, UPSCALE_MAX_BLOCK_DIFF, UPSCALE_MAX_MEAN_DIFF } from '@/lib/reel-ai-drama/harvest/media';
import { jevCostUsd } from '@/lib/social/jev/client';

import type { PhotoJev } from './grade';

export const ESSENTIAL = 'The main subject: the smallest region that still shows what this picture is a picture of. Include every element a viewer needs to get it, such as each key person, product, screen or headline. Leave out background, scenery, extended limbs, props and corner badges that the picture can lose.';
export const HAS_TEXT = 'Does the picture carry text a viewer must read in full to get it, such as a headline, title, caption, label or chart?';
export const BAND_JEV_MODEL = 'jev-preview';

export type Box = { top: number; bottom: number; left: number; right: number };
/** Makes a region sharper at a target size (an upscaler); returns an image of any size, resized afterwards. */
export type Sharpen = (region: Buffer, tw: number, th: number) => Promise<Buffer>;

/**
 * Band fit (Lucas, 2026-11-23: "the photos need to be fitted to the band… Jensen's face was only shown halfway off the
 * frame. That can never happen. It's the subject"). A Morning Download story shows its photo in a 1080×1180 band at
 * the top (.st-story__photo) that fades into the backdrop from 52% of its height (fades.ts). The subject must sit
 * whole in the clear part of the band, never cut and never in the fade.
 *
 * Pure geometry. The scale is the largest that both covers the band and keeps the subject (plus margin) inside the
 * clear zone; if those disagree, the subject wins and a blurred copy fills what the photo doesn't cover (the band's
 * bottom fades out, so a short photo leaves its gap where it barely shows). A picture with text a viewer must read
 * whole, or no subject box, treats the whole picture as the subject.
 */
export const BAND_W = 1080;
export const BAND_H = 1180;
/**
 * How far down the band the subject's bottom edge may reach. A subject may run into the top of the fade (opacity
 * ≥ 0.4 at 0.8 on black) but never off an edge; text a viewer must read stays where the photo is clear (≥ 0.8 at 0.62).
 */
export const BAND_CLEAR = 0.8;
export const BAND_CLEAR_TEXT = 0.62;
/** Breathing room around a subject, on any side where the subject doesn't already reach the picture's own edge. */
export const BAND_MARGIN = 0.03;
/**
 * A photo that can't fill the band this far down (whole subject kept) is contained instead: shown whole-subject at full
 * opacity, centred between the masthead (ends 350px) and the copy (starts 1110px), over its own blur fill.
 * Lucas, 2026-11-23: "The photos are hanging out on the top of the screen when they SHOULD be hanging out in the middle."
 */
export const BAND_COVER_MIN = 0.85;
export const CONTAINED_TOP = 380;
export const CONTAINED_BOTTOM = 1040;
export type BandPlan = { scale: number; left: number; top: number; drawW: number; drawH: number; covers: boolean; contained: boolean };

export function decideBand(w: number, h: number, essential: Box | null, hasText = false): BandPlan {
  const b = !essential || hasText ? { left: 0, right: 1, top: 0, bottom: 1 } : essential;
  const sw = Math.max(1, (b.right - b.left) * w), sh = Math.max(1, (b.bottom - b.top) * h);
  const m = BAND_MARGIN * BAND_W, clear = (hasText ? BAND_CLEAR_TEXT : BAND_CLEAR) * BAND_H;
  const edge = 0.01;
  const ml = b.left > edge ? m : 0, mr = b.right < 1 - edge ? m : 0, mt = b.top > edge ? m : 0;
  const cover = Math.max(BAND_W / w, BAND_H / h);
  const scale = Math.min(cover, (BAND_W - ml - mr) / sw, (clear - mt) / sh);
  const drawW = w * scale, drawH = h * scale;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  // Prefer covering the band (no gaps), centred on the subject; then force the subject fully into view.
  const cx = BAND_W / 2 - ((b.left + b.right) / 2) * drawW;
  let left = drawW >= BAND_W ? clamp(cx, BAND_W - drawW, 0) : (BAND_W - drawW) / 2;
  left = clamp(left, ml - b.left * drawW, BAND_W - mr - b.right * drawW);
  const cy = (mt + clear) / 2 - ((b.top + b.bottom) / 2) * drawH;
  let top = drawH >= BAND_H ? clamp(cy, BAND_H - drawH, 0) : 0;
  top = clamp(top, mt - b.top * drawH, clear - b.bottom * drawH);
  const covers = left <= 0.5 && top <= 0.5 && left + drawW >= BAND_W - 0.5 && top + drawH >= BAND_H - 0.5;
  if (drawW >= BAND_W - 0.5 && drawH >= BAND_COVER_MIN * BAND_H) return { scale, left, top, drawW, drawH, covers, contained: false };
  // Contained: same subject-first scale, capped to the space between masthead and copy, centred there.
  const room = CONTAINED_BOTTOM - CONTAINED_TOP;
  const cs = Math.min(scale, room / h, BAND_W / w);
  const cw = w * cs, ch = h * cs;
  let cl = cw >= BAND_W ? clamp(BAND_W / 2 - ((b.left + b.right) / 2) * cw, BAND_W - cw, 0) : (BAND_W - cw) / 2;
  cl = clamp(cl, -b.left * cw, BAND_W - b.right * cw);
  return { scale: cs, left: cl, top: CONTAINED_TOP + (room - ch) / 2, drawW: cw, drawH: ch, covers: false, contained: true };
}

/** Render one photo into the 1080×1180 band; `sharpen`, when given, runs on the shown region only. */
export async function renderBand(input: Buffer, p: BandPlan, sharpen?: Sharpen): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const w = meta.width!, h = meta.height!;
  // The part of the source that lands inside the band, and where it lands.
  const sx = Math.max(0, Math.floor(-p.left / p.scale)), sy = Math.max(0, Math.floor(-p.top / p.scale));
  const ex = Math.min(w, Math.ceil((BAND_W - p.left) / p.scale)), ey = Math.min(h, Math.ceil((BAND_H - p.top) / p.scale));
  const dx = Math.max(0, Math.round(p.left + sx * p.scale)), dy = Math.max(0, Math.round(p.top + sy * p.scale));
  const tw = Math.min(BAND_W - dx, Math.round((ex - sx) * p.scale)), th = Math.min(BAND_H - dy, Math.round((ey - sy) * p.scale));
  let region: Buffer = await sharp(input).extract({ left: sx, top: sy, width: ex - sx, height: ey - sy }).toBuffer();
  if (sharpen) region = await sharpen(region, tw, th);
  const fg = await sharp(region).resize(tw, th, { fit: 'fill', kernel: 'lanczos3' }).toBuffer();
  const bg = p.covers
    ? await sharp({ create: { width: BAND_W, height: BAND_H, channels: 3, background: '#000' } }).png().toBuffer()
    : await sharp(input).resize(BAND_W, BAND_H, { fit: 'cover' }).blur(40).modulate({ brightness: 0.7 }).toBuffer();
  return sharp(bg).composite([{ input: fg, left: dx, top: dy }]).jpeg({ quality: 90 }).toBuffer();
}

/**
 * Shipped rule (D22, Lucas 2026-11-23: "ship that upscaler"): upscale exactly when the shown region is stretched this
 * far or more. Below it the source already has the pixels, and upscaling hurt more than it helped.
 */
export const UPSCALE_FROM_STRETCH = 1.25;

/** Pure: should this frame be upscaled? */
export function needsUpscale(stretch: number): boolean {
  return stretch >= UPSCALE_FROM_STRETCH;
}

const execFileP = promisify(execFile);

/**
 * The photo path's own upscaler (2026-11-24, Lucas: "The VM NEEDS to run the upscaler"), apart from AI Drama's
 * x4plus default. Every kind returns the input at ×4; the caller resizes.
 * - ncnn: realesrgan-ncnn-vulkan with x4plus (D22, as shipped), where a GPU runs it (the Macs).
 * - onnx: the compact photo model realesr-general-x4v3 on the CPU (scripts/upscale/esrgan_onnx.py), for the VM:
 *   no GPU, and ncnn on its software Vulkan took 122 s for a 320×350 crop. The compact model took 31 s for that
 *   crop and 84 s for 640×700 at one thread, so its input is capped (maxInputPx) to stay under about a minute.
 */
export type PhotoUpscaler = { kind: 'ncnn' | 'onnx'; bin: string; args: (input: string, output: string) => string[]; maxInputPx: number; timeoutMs: number };

/** About half the band's area (540×590 is 318k): the ×4 output still covers the band twice over when resized down. */
export const ONNX_MAX_INPUT_PX = 260_000;
export const ONNX_TIMEOUT_MS = 150_000;
export const ESRGAN_ONNX_SCRIPT = path.join('scripts', 'upscale', 'esrgan_onnx.py');
export const ESRGAN_ONNX_MODEL = path.join('scripts', 'upscale', 'realesr-general-x4v3.onnx');
/** The VM's Python with onnxruntime, numpy and Pillow (the rembg venv the deploy installs). */
export const ESRGAN_ONNX_PYTHON = '/opt/helios-social/rembg-venv/bin/python';

export function ncnnPhotoUpscaler(bin: string): PhotoUpscaler {
  return { kind: 'ncnn', bin, args: (i, o) => ['-i', i, '-o', o, '-n', REALESRGAN_MODEL, '-s', '4'], maxInputPx: Number.POSITIVE_INFINITY, timeoutMs: 180_000 };
}

/** One thread at nice 10, so the other workers on the VM keep their share. */
export function onnxPhotoUpscaler(python: string, root: string = process.cwd()): PhotoUpscaler {
  const script = path.join(root, ESRGAN_ONNX_SCRIPT), model = path.join(root, ESRGAN_ONNX_MODEL);
  return { kind: 'onnx', bin: 'nice', args: (i, o) => ['-n', '10', python, script, '-i', i, '-o', o, '-s', '4', '-m', model, '-t', '256', '-j', '1'], maxInputPx: ONNX_MAX_INPUT_PX, timeoutMs: ONNX_TIMEOUT_MS };
}

/** ncnn where it is installed (a GPU machine), else the CPU model when its Python and files are there, else null. */
export function findPhotoUpscaler(env: NodeJS.ProcessEnv = process.env, root: string = process.cwd()): PhotoUpscaler | null {
  const ncnn = findUpscaler();
  if (ncnn) return ncnnPhotoUpscaler(ncnn);
  const python = env.ESRGAN_ONNX_PYTHON?.trim() || ESRGAN_ONNX_PYTHON;
  if (fs.existsSync(python) && fs.existsSync(path.join(root, ESRGAN_ONNX_SCRIPT)) && fs.existsSync(path.join(root, ESRGAN_ONNX_MODEL))) return onnxPhotoUpscaler(python, root);
  return null;
}

/** Pure: the size the upscaler's input is shrunk to so it stays under `maxPx` (the region's own size when it fits). */
export function upscaleInputSize(w: number, h: number, maxPx: number): { w: number; h: number } {
  if (w * h <= maxPx) return { w, h };
  const k = Math.sqrt(maxPx / (w * h));
  return { w: Math.max(1, Math.floor(w * k)), h: Math.max(1, Math.floor(h * k)) };
}

/** Real-ESRGAN at ×4 on the region (at its native size, or shrunk to the upscaler's cap), with the garble check; the caller resizes the result. */
export function esrganSharpen(up: PhotoUpscaler, tmpDir: string): Sharpen {
  return async (region) => {
    const m = await sharp(region).metadata();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inp = path.join(tmpDir, `${id}.png`), out = path.join(tmpDir, `${id}.up.png`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const size = upscaleInputSize(Math.max(1, m.width!), Math.max(1, m.height!), up.maxInputPx);
    await sharp(region).resize(size.w, size.h, { kernel: 'lanczos3' }).png().toFile(inp);
    try {
      await execFileP(up.bin, up.args(inp, out), { timeout: up.timeoutMs, env: { ...process.env, OMP_NUM_THREADS: '1' } });
      const diff = await upscaleDiff(inp, out);
      if (diff.mean > UPSCALE_MAX_MEAN_DIFF || diff.worstBlock > UPSCALE_MAX_BLOCK_DIFF) throw new Error(`garbled upscale ${diff.mean.toFixed(3)}`);
      return fs.readFileSync(out);
    } finally { for (const f of [inp, out]) fs.rmSync(f, { force: true }); }
  };
}

/** The band photo as shipped: band fit plus upscaling when the photo is stretched (D22); never blocks the post. */
export async function bandFrame(input: Buffer, plan: BandPlan, tmpDir: string, bin: PhotoUpscaler | null): Promise<{ frame: Buffer; upscaled: boolean; note?: string }> {
  if (!needsUpscale(plan.scale)) return { frame: await renderBand(input, plan), upscaled: false };
  if (!bin) return { frame: await renderBand(input, plan), upscaled: false, note: 'needs upscaling, but the upscaler is not installed' };
  try {
    return { frame: await renderBand(input, plan, esrganSharpen(bin, tmpDir)), upscaled: true };
  } catch (e) {
    return { frame: await renderBand(input, plan), upscaled: false, note: `upscale failed, plain frame used: ${e instanceof Error ? e.message : e}` };
  }
}

export type BandFit = { jpeg: Buffer; contained: boolean; upscaled: boolean; costUsd: number; note?: string };

/** Jev's essential box + has-text flag in one call, or nulls when the call fails (whole picture treated as the subject). */
export async function askBand(img: Buffer, jev: PhotoJev): Promise<{ essential: Box | null; hasText: boolean; costUsd: number; error?: string }> {
  try {
    const res = await jev.systemOne({ state: image(img), questions: { essential: box(ESSENTIAL), text: noul(HAS_TEXT, { true: 'Text to read in full', false: 'No text that matters' }) } as unknown as Questions, model: BAND_JEV_MODEL });
    const costUsd = jevCostUsd({ input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0 });
    const a = res.answers as Record<string, { box?: Box; noul?: number }>;
    return { essential: a.essential?.box ?? null, hasText: (a.text?.noul ?? 0) >= 0.5, costUsd };
  } catch (e) {
    return { essential: null, hasText: false, costUsd: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The MD band frame for a picked photo; `contained` maps to Photo.contained. `upscaler`: findPhotoUpscaler() or null. */
export async function fitToBand(img: Buffer, deps: { jev: PhotoJev; upscaler: PhotoUpscaler | null; tmpDir: string }): Promise<BandFit> {
  const meta = await sharp(img).metadata();
  const a = await askBand(img, deps.jev);
  const plan = decideBand(meta.width!, meta.height!, a.essential, a.hasText);
  const f = await bandFrame(img, plan, deps.tmpDir, deps.upscaler);
  const notes = [a.error ? `band check failed (${a.error}), whole picture kept as the subject` : '', f.note ?? ''].filter(Boolean);
  return { jpeg: f.frame, contained: plan.contained, upscaled: f.upscaled, costUsd: a.costUsd, ...(notes.length ? { note: notes.join('; ') } : {}) };
}
