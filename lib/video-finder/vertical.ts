/**
 * Vertical fit for Morning Download video clips (IG Story 1080×1920), lab 2026-11-23.
 * Lucas: "upscale it and make it vertically cropped. This can be done when the crop would show at least 50% of the
 * subject … The shot may switch in the video. So EVERY shot has to be croppable vertically."
 *
 * Same split as the photo fit (D20): Jev boxes the subject (the photo `ESSENTIAL` prompt), code does the geometry.
 * - ffmpeg scene detection splits the clip into shots; each shot is sampled at one or two frames.
 * - A shot is croppable when one full-height 9:16 window covers at least half of the subject's width in every sample.
 * - Crop only if every shot is croppable (each shot gets its own window; the window jumps only on a cut).
 *   Otherwise blur-fit: the whole clip centred over a scaled-up, blurred, darkened copy of itself.
 * - Upscale with Real-ESRGAN x4plus (the D22 photo model) when the shown region is stretched 1.25× or more.
 *
 * The geometry (shotsFrom, coverage, shotWindow, decideVideoFit, cropExpr) is pure and tested offline.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Cross-process lock (a directory) so only one Real-ESRGAN job uses the GPU at a time; a lock older than 40 min is stale. */
async function withGpuLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lock = path.join(dir, '.gpu.lock');
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 40 * 60_000) fs.rmdirSync(lock); } catch { /* raced */ }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  try { return await fn(); } finally { fs.rmdirSync(lock); }
}

export const VIDEO_W = 1080;
export const VIDEO_H = 1920;
/** Lucas, 2026-11-23: crop when it shows at least 50% of the subject, in every shot. */
export const MIN_SUBJECT_SHOWN = 0.5;
/** Scene-change score that counts as a cut (ffmpeg `scene`, 0–1). */
export const CUT_SCORE = 0.3;
/** Shots shorter than this are merged into the shot before (flashes, dissolve frames). */
export const MIN_SHOT_SEC = 0.4;
/** D22: upscale exactly when the shown region is stretched this much or more. */
export const UPSCALE_FROM_STRETCH = 1.25;

export type Box = { left: number; right: number; top?: number; bottom?: number };
export type Shot = { start: number; end: number; samples: number[] };
export type ShotFit = { shot: Shot; boxes: (Box | null)[]; left: number | null; shown: number };
export type VideoFit =
  | { mode: 'crop'; win: number; shots: ShotFit[] }
  | { mode: 'blur'; win: number; shots: ShotFit[]; reason: string }
  | { mode: 'vertical'; win: number; shots: ShotFit[] };

/** Shots from cut times; tiny shots merge into the one before. Long shots get two samples (the subject may move). */
export function shotsFrom(cuts: number[], duration: number): Shot[] {
  const edges = [0, ...cuts.filter((c) => c > 0 && c < duration).sort((a, b) => a - b), duration];
  const shots: { start: number; end: number }[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const s = { start: edges[i]!, end: edges[i + 1]! };
    if (s.end - s.start < MIN_SHOT_SEC && shots.length) shots[shots.length - 1]!.end = s.end;
    else shots.push(s);
  }
  if (shots.length > 1 && shots[0]!.end - shots[0]!.start < MIN_SHOT_SEC) { shots[1]!.start = 0; shots.shift(); }
  const r = (x: number) => Math.round(x * 100) / 100;
  return shots.map((s) => {
    const len = s.end - s.start;
    const samples = len > 3 ? [s.start + len / 3, s.start + (2 * len) / 3] : [s.start + len / 2];
    return { start: r(s.start), end: r(s.end), samples: samples.map(r) };
  });
}

/** Share of the subject's width that the window [left, left+win] shows. */
export function coverage(b: Box, left: number, win: number): number {
  const w = Math.max(1e-3, b.right - b.left);
  return Math.max(0, Math.min(b.right, left + win) - Math.max(b.left, left)) / w;
}

/** The window position for one shot that shows the most of the subject in its worst sample. */
export function shotWindow(boxes: Box[], win: number): { left: number; shown: number } {
  if (!boxes.length) return { left: (1 - win) / 2, shown: 0 };
  let best = { left: 0, shown: -1 };
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const left = ((1 - win) * i) / steps;
    const shown = Math.min(...boxes.map((b) => coverage(b, left, win)));
    // Prefer more subject shown, then the window centred on the subjects.
    const centre = boxes.reduce((s, b) => s + (b.left + b.right) / 2, 0) / boxes.length;
    const off = Math.abs(left + win / 2 - centre);
    if (shown > best.shown + 1e-6 || (Math.abs(shown - best.shown) <= 1e-6 && off < Math.abs(best.left + win / 2 - centre))) best = { left, shown };
  }
  return { left: Math.round(best.left * 1e4) / 1e4, shown: Math.round(best.shown * 1000) / 1000 };
}

/**
 * Crop only when every shot keeps at least MIN_SUBJECT_SHOWN of its subject in every sample. `aspect` is the target
 * frame's width over height: 9:16 for a full story, the photo band's for a story frame or a carousel slide.
 */
export function decideVideoFit(w: number, h: number, shots: Shot[], boxes: (Box | null)[][], aspect = 9 / 16): VideoFit {
  const win = Math.min(1, (h * aspect) / w);
  const fits: ShotFit[] = shots.map((shot, i) => {
    const bs = boxes[i] ?? [];
    if (win >= 1) return { shot, boxes: bs, left: 0, shown: 1 };
    if (!bs.length || bs.some((b) => !b)) return { shot, boxes: bs, left: null, shown: 0 };
    const sw = shotWindow(bs as Box[], win);
    return { shot, boxes: bs, left: sw.left, shown: sw.shown };
  });
  if (win >= 1) return { mode: 'vertical', win, shots: fits };
  const bad = fits.filter((f) => f.left === null || f.shown < MIN_SUBJECT_SHOWN);
  if (bad.length) return { mode: 'blur', win, shots: fits, reason: `${bad.length}/${fits.length} shots would show under half the subject (or no subject found)` };
  return { mode: 'crop', win, shots: fits };
}

/** ffmpeg crop `x` expression: each shot's window, switching at its cut (in source pixels). */
export function cropExpr(fit: VideoFit, w: number): string {
  const xs = fit.shots.map((s) => Math.round((s.left ?? 0) * w));
  let expr = String(xs[xs.length - 1] ?? 0);
  for (let i = fit.shots.length - 2; i >= 0; i--) expr = `if(lt(t\\,${fit.shots[i]!.shot.end})\\,${xs[i]}\\,${expr})`;
  return expr;
}

export function needsUpscale(stretch: number): boolean {
  return stretch >= UPSCALE_FROM_STRETCH;
}

/** Cut times from ffmpeg scene detection. */
export async function detectCuts(file: string, score = CUT_SCORE): Promise<number[]> {
  try {
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', file, '-vf', `select='gt(scene,${score})',showinfo`, '-an', '-f', 'null', '-'], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  } catch {
    return [];
  }
}

/** Frame rate as a number (ffprobe r_frame_rate). */
async function fps(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file]);
  const [a, b] = stdout.trim().split('/').map(Number);
  return b ? a! / b : a || 30;
}

/**
 * Render the 1080×1920 story clip. Crop: the per-shot window, upscaled frame by frame with Real-ESRGAN when stretched
 * ≥1.25×. Blur: the whole frame (upscaled the same way when needed) over a blurred, darkened fill. Audio is copied.
 * A missing or failing upscaler falls back to lanczos and says so; it never blocks the clip.
 */
export async function renderVertical(src: string, fit: VideoFit, w: number, h: number, out: string, tmpDir: string, esrgan: string | null): Promise<{ upscaled: boolean; note?: string; stretch: number }> {
  const shownW = fit.mode === 'crop' ? Math.round(fit.win * w / 2) * 2 : w;
  const stretch = fit.mode === 'crop' || fit.mode === 'vertical' ? VIDEO_H / h : Math.min(VIDEO_W / w, VIDEO_H / h);
  const fgW = fit.mode === 'blur' ? Math.round((w * stretch) / 2) * 2 : VIDEO_W;
  const fgH = fit.mode === 'blur' ? Math.round((h * stretch) / 2) * 2 : VIDEO_H;
  const region = fit.mode === 'crop' ? `crop=${shownW}:${h}:'${cropExpr(fit, w)}':0` : 'null';
  const rate = await fps(src);
  let fgInput = src, fgFilter = region, upscaled = false, note: string | undefined;

  if (esrgan && needsUpscale(stretch)) {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'vf-'));
    try {
      fs.mkdirSync(path.join(dir, 'in')); fs.mkdirSync(path.join(dir, 'up'));
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', region, path.join(dir, 'in', '%05d.png')], { timeout: 300_000 });
      // One GPU: parallel shards queue here instead of fighting over it (four at once all hit the timeout, 2026-11-23).
      await withGpuLock(tmpDir, () => run(esrgan, ['-i', path.join(dir, 'in'), '-o', path.join(dir, 'up'), '-n', 'realesrgan-x4plus', '-s', '4', '-f', 'png'], { timeout: 1_800_000 }));
      const upFile = path.join(dir, 'up.mp4');
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(rate), '-i', path.join(dir, 'up', '%05d.png'), '-vf', fit.mode === 'blur' ? `scale=${fgW}:${fgH}:flags=lanczos` : `scale=-2:${VIDEO_H}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', upFile], { timeout: 600_000 });
      fs.renameSync(upFile, path.join(tmpDir, `${path.basename(out)}.fg.mp4`));
      fgInput = path.join(tmpDir, `${path.basename(out)}.fg.mp4`); fgFilter = 'null'; upscaled = true;
    } catch (e) {
      note = `upscale failed, lanczos instead: ${e instanceof Error ? e.message.slice(0, 120) : e}`;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } else if (needsUpscale(stretch)) note = 'needs upscaling, but realesrgan-ncnn-vulkan is not installed';

  // Blur: the whole frame at its fitted size. Crop / already vertical: fill 1080×1920 without distortion.
  const fg = fit.mode === 'blur' ? `${fgFilter},scale=${fgW}:${fgH}:flags=lanczos,setsar=1` : `${fgFilter},scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${VIDEO_W}:${VIDEO_H},setsar=1`;
  const graph = fit.mode === 'blur'
    ? `[1:v]${fg}[fg];[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=10:2,scale=${VIDEO_W}:${VIDEO_H},colorchannelmixer=rr=.7:gg=.7:bb=.7,setsar=1[bg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`
    : `[1:v]${fg}[v]`;
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-i', fgInput, '-filter_complex', graph, '-map', '[v]', '-map', '0:a?', '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', String(Math.round(rate)), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], { timeout: 600_000 });
  if (fgInput !== src) fs.rmSync(fgInput, { force: true });
  return { upscaled, note, stretch: Math.round(stretch * 100) / 100 };
}
