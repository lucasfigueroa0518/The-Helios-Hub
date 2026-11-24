/**
 * Real footage on Last Few Days story slides (MD-LFD Revisions D16–D19, 2026-11-24).
 *
 * The run (run.ts) asks `find` for each lineup story and each story in the scan window. A golden clip makes the slide
 * a video slide: its photo is the clip's poster (so the JPEG, the vision check, the review screen and the hub work as
 * for any photo), and after the final render `slide` turns that slide into an MP4: the slide's three layers
 * (fit-check.ts lfdSlideLayers), the clip fitted to the slide's photo area (band.ts fitClip / renderBand), ffmpeg
 * between them (composeFrameVideo). Any failure there drops the slide a rung of the ladder (meme, then photo).
 *
 * The live wiring needs yt-dlp and ffmpeg on PATH and the Serper and TypeSafe keys (lib/stories/video.ts
 * videoAvailable); without them the run has no `video` dep and is exactly today's.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Post as RenderPost } from '@/lib/social/render/types';
import type { FinderDeps, VideoFind, VideoStory } from '@/lib/video-finder/find';

import { DEFAULT_LFD_VIDEO_CAP_USD } from './config';
import type { LfdVideoPick, StoryCopy } from './types';

/** An LFD slide is 1080 × 1350 (lib/social/render/fit-check.ts SLIDE_W / SLIDE_H). */
export const LFD_SLIDE = { w: 1080, h: 1350 } as const;
/** Instagram refuses a carousel video under 3 s. */
export const MIN_VIDEO_SECONDS = 3;
/** Lineup stories checked at once (each runs its own waves of candidates). */
export const LFD_VIDEO_CONCURRENCY = 3;

/** One video slide, made. `still` is a frame of the MP4 (the slide's JPEG is replaced with it, so review shows what posts). */
export type LfdSlideVideo = { mp4: Buffer; band: Buffer; still: Buffer; seconds: number; fit: 'crop' | 'blur' | 'vertical'; usd: number };

export type LfdVideoDeps = {
  /** The finder's spend cap for this post; `find` is not called once `spent().usd` reaches it. */
  capUsd: number;
  find(story: VideoStory): Promise<VideoFind>;
  /** Make the MP4 of story slide `position` (render.slides index) of `post` with `clip` in its photo area. Throws on any failure. */
  slide(a: { post: RenderPost; position: number; clip: LfdVideoPick }): Promise<LfdSlideVideo>;
  /** Spend so far: the finder (Haiku, Jev, Serper) and the band's subject boxes; `jevUsd` is the Jev part. */
  spent(): { usd: number; jevUsd: number };
};

/** The words and photo a video slide was made with; a saved slide whose check no longer matches posts its JPEG. */
export function videoCheck(s: Pick<StoryCopy, 'setup' | 'headline' | 'body'> & { photo: { src: string } }): string {
  return crypto.createHash('sha1').update([s.setup ?? '', s.headline, s.body, s.photo.src].join('\u0000')).digest('hex').slice(0, 16);
}

/** A Storage-safe name for a story key. */
export function videoSlug(key: string): string {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
}

/** The poster as a data URL: the social renderer loads https, data URLs, or files under public/ only. */
export function posterDataUrl(file: string): string {
  return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
}

/** The credit line for a clip: the channel or account it came from (lib/stories/video.ts clipCredit, the same words). */
export function videoCredit(c: Pick<LfdVideoPick, 'channel' | 'site'>): string {
  return `Video: ${c.channel?.trim() || c.site?.trim() || 'source'}`;
}

/** The live video dep, or null with the reason when this machine can't run the finder. */
export async function liveLfdVideo(o: { anthropic: FinderDeps['anthropic']; capUsd?: number; log?: (line: string) => void }): Promise<{ video: LfdVideoDeps } | { video: null; why: string }> {
  const { videoAvailable } = await import('@/lib/stories/video');
  const ok = videoAvailable();
  if (!ok.ok) return { video: null, why: ok.why ?? 'unavailable' };
  const { createVideoFinder } = await import('@/lib/video-finder/find');
  const { composeFrameVideo, fitClip, liveBoxSubject, renderBand } = await import('@/lib/video-finder/band');
  const { lfdSlideLayers } = await import('@/lib/social/render/fit-check');
  const { TypeSafeClient } = await import('@typesafe-ai/sdk');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfd-video-'));
  const capUsd = o.capUsd ?? DEFAULT_LFD_VIDEO_CAP_USD;
  const finder = createVideoFinder({
    anthropic: o.anthropic,
    jev: new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } }) as never,
    serperKey: process.env.SERPER_API_KEY ?? '',
    workDir,
    capUsd,
    ...(o.log ? { log: o.log } : {}),
  });
  const boxSubject = await liveBoxSubject();
  let bandUsd = 0;
  const even = (n: number) => Math.ceil(n / 2) * 2;
  return {
    video: {
      capUsd,
      find: (s) => finder.find(s),
      spent: () => {
        const f = finder.spent();
        return { usd: f.usd + bandUsd, jevUsd: f.jevUsd + bandUsd };
      },
      async slide({ post, position, clip }) {
        const dir = fs.mkdtempSync(path.join(workDir, 'slide-'));
        try {
          const l = await lfdSlideLayers(post, position);
          const W = even(l.box.w), H = even(l.box.h);
          const fit = await fitClip(clip.file, W / H, boxSubject, dir);
          if (!fit) throw new Error('the clip could not be read');
          bandUsd += fit.usd;
          const band = path.join(dir, 'band.mp4');
          await renderBand(clip.file, fit, W, H, band, path.join(dir, 'band.jpg'));
          const file = (name: string, b: Buffer) => { const f = path.join(dir, name); fs.writeFileSync(f, b); return f; };
          const seconds = Math.round(Math.min(fit.duration, clip.len || fit.duration) * 10) / 10;
          if (!(seconds >= MIN_VIDEO_SECONDS)) throw new Error(`the clip is ${seconds} s; Instagram needs ${MIN_VIDEO_SECONDS} s`);
          const out = path.join(dir, 'slide.mp4');
          await composeFrameVideo({ under: file('under.png', l.under), matte: file('matte.png', l.matte), over: file('over.png', l.over) }, band, { x: l.box.x, y: l.box.y }, LFD_SLIDE, seconds, out);
          const still = path.join(dir, 'still.jpg');
          await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.min(1, seconds / 2)), '-i', out, '-frames:v', '1', '-q:v', '2', still], { timeout: 30_000 });
          return { mp4: fs.readFileSync(out), band: fs.readFileSync(band), still: fs.readFileSync(still), seconds, fit: fit.fit.mode, usd: fit.usd };
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  };
}
