import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { FitCheck } from '@/lib/social/render/fit-check';
import type { Post as RenderPost } from '@/lib/social/render/types';

import { CAROUSEL_MAX_ITEMS } from './config';

/**
 * The final render of a shipped post, as the JPEGs Instagram gets: rendered
 * once more from the stored render (local Chromium, no AI), so the images
 * always match the post's last text. Returns Storage paths in slide order.
 */
export async function storeSlideJpegs(
  slug: string,
  render: RenderPost,
  deps: { fitCheck: FitCheck; upload: (objectPath: string, body: Buffer) => Promise<void> },
): Promise<string[]> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'social-slides-'));
  try {
    await deps.fitCheck(render, { screenshotDir: dir, name: 'slide' });
    const pngs = (await fsp.readdir(dir)).filter((f) => /^slide-slide-\d+\.png$/.test(f)).sort();
    if (pngs.length === 0) throw new Error('The render produced no slide images.');
    if (pngs.length > CAROUSEL_MAX_ITEMS) throw new Error(`The post has ${pngs.length} slides; Instagram takes at most ${CAROUSEL_MAX_ITEMS}.`);
    const sharp = (await import('sharp')).default;
    const objects: string[] = [];
    for (const [i, file] of pngs.entries()) {
      const jpeg = await sharp(path.join(dir, file)).flatten({ background: '#000000' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      const objectPath = `posts/${slug}/slide-${String(i + 1).padStart(2, '0')}.jpg`;
      await deps.upload(objectPath, jpeg);
      objects.push(objectPath);
    }
    return objects;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
