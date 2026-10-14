/**
 * One photo per story (spec §5) through the Stories finder, found as one set
 * so no two slides share a photo. The article's own images arrive through the
 * source page the finder reads. A null means the whole fallback chain found
 * nothing usable; the run replaces that story.
 *
 * The finder's last resort is an "icon scene" search for the slide's icon, and
 * a Last Few Days slide has none, so it falls to the default icon's generic
 * scene (a stack of newspapers). That photo says nothing about the story, so
 * it is refused here (null → the run replaces the story).
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

/** The finder's trace step for its icon-scene fallback (lib/social/photos/design.ts). */
export const ICON_SCENE_STEP = 'icon scene (';
export const REFUSED_ICON_SCENE = 'lfd: refused icon-scene fallback';

export type FoundPhotos = {
  photos: Array<Photo | null>;
  /** The finder's steps per story (same order as the items), plus any refusal noted here. */
  traces: string[][];
};

export async function findPhotos(finder: PhotoFinder, items: Array<{ pick: Pick; copy: StoryCopy }>, exclude: Set<string>): Promise<FoundPhotos> {
  if (items.length === 0) return { photos: [], traces: [] };
  const trace: string[][] = [];
  const found = await findSetOrEach(finder, items.map(({ pick, copy }) => requestFor(pick, copy, exclude)), trace);
  const traces = items.map((_, i) => [...(trace[i] ?? [])]);
  const photos = items.map((_, i) => {
    const photo = found[i] ?? null;
    if (!photo || !traces[i]!.some((line) => line.startsWith(ICON_SCENE_STEP))) return photo;
    traces[i]!.push(REFUSED_ICON_SCENE);
    return null;
  });
  return { photos, traces };
}
