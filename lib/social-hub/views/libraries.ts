import type { HubQuery } from '@/lib/social-hub/db';
import { librarySummary } from '@/lib/media-library/read';
import { readMusic, type MusicRead } from '@/lib/social-hub/queries/music';

/**
 * The shared libraries the pipelines draw from (BRIEFS.md §1): the Meta
 * trending-audio pool and the photo bank. Each degrades to "not set up yet".
 */

export type PhotoSummary = { present: false } | { present: true; stored: number; reusable: number; addedLast7d: number; lastAddedAt: string | null };

export type LibrariesModel = { music: MusicRead; photos: PhotoSummary };

export async function loadLibraries(q: HubQuery): Promise<LibrariesModel> {
  const [music, photos] = await Promise.all([
    readMusic(q).catch((): MusicRead => ({ present: false })),
    readPhotoSummary(q).catch((): PhotoSummary => ({ present: false })),
  ]);
  return { music, photos };
}

/** Counts from the photo bank (media_library, D49); absent until its schema is applied. */
export async function readPhotoSummary(q: HubQuery): Promise<PhotoSummary> {
  const summary = await librarySummary(q);
  if (summary.absent) return { present: false };
  return { present: true, stored: summary.stored, reusable: summary.reusable, addedLast7d: summary.addedLast7d, lastAddedAt: summary.lastAddedAt };
}
