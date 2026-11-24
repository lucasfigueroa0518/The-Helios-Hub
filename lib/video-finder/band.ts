/**
 * Fit a found clip into the box a frame shows it in (MD's photo band, an LFD slide's photo area), 2026-11-24.
 * Lucas's rule (D20 for photos, carried to video 2026-11-23): crop when every shot shows at least half of its subject
 * in the box's shape, otherwise blur-fit (the whole clip centred over a scaled-up, blurred, darkened copy of itself).
 * Upscaling is off (Lucas, 2026-11-23: "Abort the upscaling").
 *
 * Jev (`jev-preview`, a `box` question with the photo stage's ESSENTIAL wording) boxes the subject of one or two
 * samples per shot (about $0.0005 a clip); code does the geometry (vertical.ts).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { jevCostUsd } from '@/lib/social/jev/client';
import { probe } from './media';
import { cropExpr, decideVideoFit, detectCuts, shotsFrom, type Box, type VideoFit } from './vertical';

const run = promisify(execFile);

/** The photo crop's subject question (scripts/story-crop.ts ESSENTIAL, D20), verbatim. */
export const ESSENTIAL = 'The main subject: the smallest region that still shows what this picture is a picture of. Include every element a viewer needs to get it, such as each key person, product, screen or headline. Leave out background, scenery, extended limbs, props and corner badges that the picture can lose.';

/** One Jev box call on a JPEG: the subject's box as fractions of the frame, or null. */
export type BoxSubject = (jpeg: Buffer) => Promise<{ box: Box | null; usd: number }>;

/** The live box call through the TypeSafe SDK (loaded lazily so tests never need it). */
export async function liveBoxSubject(): Promise<BoxSubject> {
  const { box, image, TypeSafeClient } = await import('@typesafe-ai/sdk');
  const jev = new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } });
  return async (jpeg) => {
    const a = await jev.systemOne({ state: image(jpeg), questions: { essential: box(ESSENTIAL) }, model: 'jev-preview' } as never) as { answers: unknown; usage: { input_tokens?: number | null; output_tokens?: number | null } };
    return { box: (a.answers as Record<string, { box?: Box }>).essential?.box ?? null, usd: jevCostUsd({ input_tokens: a.usage.input_tokens ?? 0, output_tokens: a.usage.output_tokens ?? 0 }) };
  };
}

export type BandFit = { fit: VideoFit; w: number; h: number; duration: number; usd: number };

/** Shots, a subject box per sample, then crop or blur for a box of `aspect` (width / height). */
export async function fitClip(src: string, aspect: number, boxSubject: BoxSubject, tmpDir: string): Promise<BandFit | null> {
  const p = await probe(src);
  if (!p || !p.width || !p.height) return null;
  const shots = shotsFrom(await detectCuts(src), p.duration);
  let usd = 0;
  const boxes: (Box | null)[][] = [];
  for (const [s, shot] of shots.entries()) {
    boxes.push(await Promise.all(shot.samples.map(async (t, k) => {
      const f = path.join(tmpDir, `band-s${s}-${k}.jpg`);
      try {
        await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', src, '-frames:v', '1', '-q:v', '3', f], { timeout: 30_000 });
        const got = await boxSubject(fs.readFileSync(f));
        usd += got.usd;
        return got.box;
      } catch {
        return null;
      } finally {
        fs.rmSync(f, { force: true });
      }
    })));
  }
  return { fit: decideVideoFit(p.width, p.height, shots, boxes, aspect), w: p.width, h: p.height, duration: p.duration, usd };
}

/**
 * Where in the W×H clip the picture sits: rows `top` to `bottom`, full width, over a blurred, darkened copy of itself
 * (MD: the contained photo's place between the masthead and the copy, so the masthead never sits on the clip).
 * `fit` must then be decided for that region's aspect, W / (bottom − top).
 */
export type BandPlace = { top: number; bottom: number };

/** The ffmpeg graph that turns the source into a W×H clip by `fit` (input 0 → [v]). Pure; tested offline. */
export function bandGraph(fit: VideoFit, w: number, h: number, W: number, H: number, place?: BandPlace): string {
  if (place) {
    const even = (n: number) => Math.round(n / 2) * 2;
    const top = even(place.top), rh = even(place.bottom - place.top);
    const bw = even(W / 4), bh = even(H / 4);
    const bg = `[a]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=10:2,scale=${W}:${H},colorchannelmixer=rr=.7:gg=.7:bb=.7,setsar=1[bg]`;
    // A clip narrower than the region (vertical) is shown whole, like a blur fit: no subject box was checked
    // against cutting its top and bottom.
    const fg = fit.mode !== 'crop'
      ? `[b]scale=${W}:${rh}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[fg];[bg][fg]overlay=(W-w)/2:${top}+(${rh}-h)/2[v]`
      : `[b]crop=${even(fit.win * w)}:${h}:'${cropExpr(fit, w)}':0,scale=${W}:${rh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${rh},setsar=1[fg];[bg][fg]overlay=0:${top}[v]`;
    return `[0:v]split[a][b];${bg};${fg}`;
  }
  if (fit.mode === 'blur') {
    const bw = Math.round(W / 4 / 2) * 2, bh = Math.round(H / 4 / 2) * 2;
    return `[0:v]split[a][b];[a]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=10:2,scale=${W}:${H},colorchannelmixer=rr=.7:gg=.7:bb=.7,setsar=1[bg];`
      + `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`;
  }
  const region = fit.mode === 'crop' ? `crop=${Math.round((fit.win * w) / 2) * 2}:${h}:'${cropExpr(fit, w)}':0,` : '';
  return `[0:v]${region}scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1[v]`;
}

/** Render the W×H band clip, its picture at `place` when given (sound kept when the clip has it) and its poster JPEG (the frame at 1 s). */
export async function renderBand(src: string, fit: BandFit, W: number, H: number, out: string, poster: string, place?: BandPlace): Promise<void> {
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-filter_complex', bandGraph(fit.fit, fit.w, fit.h, W, H, place), '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], { timeout: 300_000 });
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.min(1, fit.duration / 2)), '-i', out, '-frames:v', '1', '-q:v', '2', poster], { timeout: 30_000 });
}

/**
 * The finished frame video: the frame's three layers (rendered by the frame's own renderer) around the band clip.
 *   under  the frame with no photo and no text (its backdrop), opaque PNG
 *   matte  white where the photo shows and how much (its fade mask), black elsewhere
 *   over   everything drawn over the photo (shade, masthead, copy, credit), transparent PNG
 * The band clip sits at `box` (its own W×H), shows through the matte over `under`, and `over` goes on top.
 */
export function composeGraph(frame: { w: number; h: number }, box: { x: number; y: number }): string {
  return `[1:v]format=rgba,pad=${frame.w}:${frame.h}:${box.x}:${box.y}:color=black@0[vp];[2:v]format=gray,scale=${frame.w}:${frame.h}[m];`
    + `[vp][m]alphamerge[va];[0:v][va]overlay=0:0:shortest=1[b];[b][3:v]overlay=0:0,format=yuv420p[out]`;
}

export async function composeFrameVideo(layers: { under: string; matte: string; over: string }, band: string, box: { x: number; y: number }, frame: { w: number; h: number }, seconds: number, out: string): Promise<void> {
  const still = (f: string) => ['-loop', '1', '-framerate', '30', '-t', String(seconds), '-i', f];
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...still(layers.under), '-i', band, ...still(layers.matte), ...still(layers.over),
    '-filter_complex', composeGraph(frame, box), '-map', '[out]', '-map', '1:a?', '-t', String(seconds),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], { timeout: 300_000 });
}
