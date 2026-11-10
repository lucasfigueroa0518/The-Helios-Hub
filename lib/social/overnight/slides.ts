import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { FitCheck, FitResult } from '@/lib/social/render/fit-check';
import type { Post as RenderPost } from '@/lib/social/render/types';

import { CAROUSEL_MAX_ITEMS } from './config';

/** A slide image that failed to load. Nothing was uploaded: a post never ships a broken image. */
export class SlideImagesFailed extends Error {
  constructor(readonly fit: FitResult, readonly failed: string[]) {
    super(`A slide image failed to load, so no slides were stored: ${failed.join('; ')}`);
    this.name = 'SlideImagesFailed';
  }
}

/** The fit check's "image failed to load" problems. */
export const failedImageProblems = (fit: Pick<FitResult, 'problems'> | null | undefined): string[] =>
  (fit?.problems ?? []).filter((p) => /image failed to load/.test(p));

/**
 * The final render of a shipped post, as the JPEGs Instagram gets: rendered
 * once more from the stored render (local Chromium, no AI), so the images
 * always match the post's last text. Returns Storage paths in slide order.
 * Throws SlideImagesFailed, before any upload, when an image on any slide failed to load (unless the caller
 * checks each slide it uploads itself).
 */
export async function storeSlideJpegs(
  slug: string,
  render: RenderPost,
  deps: {
    fitCheck: FitCheck;
    upload: (objectPath: string, body: Buffer) => Promise<void>;
    prefix?: string;
    /** Only for a caller that uploads some slides and blocks a failed image on each slide it uploads (revisions). */
    failedImagesCheckedPerSlide?: true;
  },
): Promise<string[]> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'social-slides-'));
  try {
    const fit = await deps.fitCheck(render, { screenshotDir: dir, name: 'slide' });
    const failed = failedImageProblems(fit);
    if (failed.length && !deps.failedImagesCheckedPerSlide) throw new SlideImagesFailed(fit, failed);
    const pngs = (await fsp.readdir(dir)).filter((f) => /^slide-slide-\d+\.png$/.test(f)).sort();
    if (pngs.length === 0) throw new Error('The render produced no slide images.');
    if (pngs.length > CAROUSEL_MAX_ITEMS) throw new Error(`The post has ${pngs.length} slides; Instagram takes at most ${CAROUSEL_MAX_ITEMS}.`);
    const sharp = (await import('sharp')).default;
    const objects: string[] = [];
    for (const [i, file] of pngs.entries()) {
      const jpeg = await sharp(path.join(dir, file)).flatten({ background: '#000000' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      const objectPath = `${deps.prefix ?? 'posts'}/${slug}/slide-${String(i + 1).padStart(2, '0')}.jpg`;
      await deps.upload(objectPath, jpeg);
      objects.push(objectPath);
    }
    return objects;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
