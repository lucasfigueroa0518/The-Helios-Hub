/**
 * The simulated post with memes (LFD lab plan §4, §5): the original post's
 * stories, reordered and re-imaged by the placement, rendered with Tommy's
 * buildPost so the slides, caption and credits are exactly what a real run
 * would make. Only the cover's meme and the meme slides differ.
 */
import { buildPost } from '@/lib/lfd/post';
import type { Pick, Ready, StoryCopy } from '@/lib/lfd/types';
import type { Post as RenderPost } from '@/lib/social/render/types';
import type { Photo } from '@/lib/stories/render/types';

import type { Placement } from '../lfd-placement';

/** A story as lfd.posts saves it (lib/lfd/run.ts insertPost). */
export type SavedStory = {
  key: string;
  lane: Pick['lane'];
  origin: Pick['origin'];
  url: string;
  outlet: string;
  major: number | null;
  net: number | null;
  lead: number | null;
  setup: string;
  headline: string;
  highlight: string;
  names: string[];
  body: string;
  photo: Photo;
};

export function readyFromSaved(s: SavedStory): Ready {
  const copy: StoryCopy = { key: s.key, setup: s.setup, headline: s.headline, highlight: s.highlight, names: s.names, body: s.body, photo: { kind: '', query: '', subjects: [], alts: [] } };
  const pick: Pick = {
    key: s.key, refs: [], origin: s.origin, headline: s.headline, sourceName: s.outlet, url: s.url, body: s.body,
    publishedAt: null, net: s.net, blockbuster: 0, firstSeen: null, alsoFrom: [], major: s.major, lane: s.lane,
  };
  return { pick, copy, photo: s.photo };
}

/**
 * The post with memes placed. `memeUrl` turns a meme id into an image URL the renderer can load (a data URL in the
 * simulation). Mosaic photos stay the stories' own photos, in the new order.
 */
export function postWithMemes(stories: SavedStory[], placement: Placement, memeUrl: (memeId: string) => string, now: Date): RenderPost {
  const byKey = new Map(stories.map((s) => [s.key, s]));
  const ready = placement.order.map((k) => readyFromSaved(byKey.get(k)!));
  const post = buildPost(ready, now);
  const slides = post.slides.map((slide) => {
    if (slide.layoutVariant === 'lfd_cover' && placement.cover.kind === 'meme') {
      return { ...slide, lfdCover: { photos: slide.lfdCover?.photos ?? [], meme: { url: memeUrl(placement.cover.memeId) } } };
    }
    if (slide.layoutVariant !== 'lfd_story') return slide;
    const key = placement.order[slide.position - 1];
    const image = key ? placement.slideImage[key] : undefined;
    if (!image || image.kind !== 'meme') return slide;
    const { photoFocus: _f, ...rest } = slide;
    return { ...rest, photoUrl: memeUrl(image.memeId), photoKind: 'meme' as const };
  });
  return { ...post, slides };
}
