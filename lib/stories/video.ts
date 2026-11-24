/**
 * Morning Download's video wiring (MD-LFD Revisions D16–D19, 2026-11-24). The build asks `find` for each story in
 * its window, and `store` fits a picked clip to the story frame's photo band and keeps it in the stories bucket.
 * The render stage (render-stage.ts storyVideo) turns the frame into an MP4 with the clip playing in the band.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BAND_H, BAND_W, CONTAINED_BOTTOM, CONTAINED_TOP } from '@/lib/news-photos/band';
import type { Photo, StoryVideo } from '@/lib/stories/render/types';
import type { StoriesStorage } from '@/lib/stories/storage';
import type { FinderDeps, FoundClip, VideoFind, VideoStory } from '@/lib/video-finder/find';

/** The story frame's photo band (stories.css .st-story__photo: 1080 wide, 1180 tall). */
export const MD_BAND = { w: BAND_W, h: BAND_H } as const;
/**
 * Where the clip plays inside the band: a contained photo's place (decideBand), between the masthead and the copy,
 * over the clip's own blur fill. A full-bleed clip put the masthead on the video (set d61efd39). The clip is fitted
 * (crop or blur) for this region's shape, and its poster, a still of the band clip, is contained like such a photo.
 */
export const MD_VIDEO_PLACE = { top: CONTAINED_TOP, bottom: CONTAINED_BOTTOM } as const;
export const MD_VIDEO_ASPECT = MD_BAND.w / (MD_VIDEO_PLACE.bottom - MD_VIDEO_PLACE.top);

/** The poster a stored band clip carries: always contained (CONTAINED_FADE), since the clip sits at MD_VIDEO_PLACE. */
export function videoPoster(src: string, credit: string): Photo {
  return { src, credit, kind: 'scene', contained: true };
}
/** Spend cap for one Morning Download build's video checks (about $0.02 a story in the lab, 8–10 stories a day). */
export const MD_VIDEO_CAP_USD = 0.5;
/** Stories checked at once (each runs its own waves of 4 candidates). */
export const MD_VIDEO_CONCURRENCY = 3;
/** The poster's signed URL lives this long (the render and the hub read it; the frame's own JPEG replaces it after). */
const POSTER_URL_SEC = 7 * 86_400;

export type StoryVideoDeps = {
  find(story: VideoStory): Promise<VideoFind>;
  /** Fit the clip to the band and store it. Null when it cannot be fitted or stored (the story falls back a rung). */
  store(clip: FoundClip, tier: 'golden' | 'good', key: string): Promise<{ video: StoryVideo; poster: Photo; usd: number } | null>;
  /** Spend so far by vendor: Haiku (brief, titles, AI check), Jev (frames, band boxes), Serper searches. */
  spent(): { anthropic: number; jev: number; search: number };
};

/** The credit line for a clip: the channel or account it came from. */
export function clipCredit(c: Pick<FoundClip, 'channel' | 'site'>): string {
  const who = c.channel?.trim() || c.site?.trim() || 'source';
  return `Video: ${who}`;
}

/** True when this machine can run the finder (yt-dlp and ffmpeg on PATH, Serper and Jev keys set). */
export function videoAvailable(env: NodeJS.ProcessEnv = process.env): { ok: boolean; why?: string } {
  if (!env.SERPER_API_KEY) return { ok: false, why: 'SERPER_API_KEY is not set' };
  if (!env.TYPESAFE_API_KEY) return { ok: false, why: 'TYPESAFE_API_KEY is not set' };
  // ffmpeg takes -version (it rejects --version); yt-dlp takes --version.
  for (const [bin, flag] of [['yt-dlp', '--version'], ['ffmpeg', '-version']] as const) {
    try { execFileSync(bin, [flag], { stdio: 'ignore', timeout: 10_000 }); } catch { return { ok: false, why: `${bin} is not installed` }; }
  }
  return { ok: true };
}

/** The live wiring for one set. */
export async function liveStoryVideo(o: { setId: string; storage: StoriesStorage; anthropic: FinderDeps['anthropic']; log?: (line: string) => void; capUsd?: number }): Promise<StoryVideoDeps> {
  const { createVideoFinder } = await import('@/lib/video-finder/find');
  const { fitClip, liveBoxSubject, renderBand } = await import('@/lib/video-finder/band');
  const { TypeSafeClient } = await import('@typesafe-ai/sdk');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-video-'));
  const cap = o.capUsd ?? MD_VIDEO_CAP_USD;
  const finder = createVideoFinder({
    anthropic: o.anthropic,
    jev: new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } }) as never,
    serperKey: process.env.SERPER_API_KEY ?? '',
    workDir,
    capUsd: cap,
    ...(o.log ? { log: o.log } : {}),
  });
  const boxSubject = await liveBoxSubject();
  let bandUsd = 0;
  return {
    find: (s) => finder.find(s),
    spent: () => { const f = finder.spent(); return { anthropic: f.haikuUsd, jev: f.jevUsd + bandUsd, search: f.serperUsd }; },
    async store(clip, tier, key) {
      const dir = fs.mkdtempSync(path.join(workDir, 'band-'));
      try {
        const fit = await fitClip(clip.file, MD_VIDEO_ASPECT, boxSubject, dir);
        if (!fit) return null;
        bandUsd += fit.usd;
        const out = path.join(dir, 'band.mp4');
        const poster = path.join(dir, 'band.jpg');
        await renderBand(clip.file, fit, MD_BAND.w, MD_BAND.h, out, poster, MD_VIDEO_PLACE);
        const slug = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
        const bandPath = `sets/${o.setId}/video/${slug}.mp4`;
        const posterPath = `sets/${o.setId}/video/${slug}.jpg`;
        await o.storage.upload(bandPath, fs.readFileSync(out), 'video/mp4');
        await o.storage.upload(posterPath, fs.readFileSync(poster), 'image/jpeg');
        const src = await o.storage.sign(posterPath, POSTER_URL_SEC);
        return {
          video: { path: bandPath, seconds: Math.round(Math.min(fit.duration, clip.len) * 10) / 10, tier, sourceUrl: clip.sourceUrl, fit: fit.fit.mode },
          poster: videoPoster(src, clipCredit(clip)),
          usd: fit.usd,
        };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
