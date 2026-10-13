/**
 * One photo per story (spec §5) through the Stories finder, found as one set
 * so no two slides share a photo. The article's own images arrive through the
 * source page the finder reads. A null means the whole fallback chain found
 * nothing usable; the run replaces that story.
 */
import { findSetOrEach, type PhotoFinder, type PhotoRequest } from '@/lib/stories/photos';
import type { Photo } from '@/lib/stories/render/types';

import type { Pick, StoryCopy } from './types';

export function requestFor(pick: Pick, copy: StoryCopy, exclude: Set<string>): PhotoRequest {
  return {
    kind: copy.photo.kind,
    query: copy.photo.query,
    subjects: copy.photo.subjects,
    storyDate: pick.publishedAt?.slice(0, 10) ?? null,
    sourceUrls: [pick.url],
    alts: copy.photo.alts,
    copy: copy.headline,
    exclude,
  };
}

export async function findPhotos(finder: PhotoFinder, items: Array<{ pick: Pick; copy: StoryCopy }>, exclude: Set<string>): Promise<Array<Photo | null>> {
  if (items.length === 0) return [];
  return findSetOrEach(finder, items.map(({ pick, copy }) => requestFor(pick, copy, exclude)));
}
