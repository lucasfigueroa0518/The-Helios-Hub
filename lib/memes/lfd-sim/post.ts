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

/** A placed meme's image: a URL the renderer can load, and its width / height so the slide takes the meme's shape. */
export type MemeImage = { url: string; aspect?: number };

/**
 * The post with memes placed. `memeImage` turns a meme id into its image (a data URL in the simulation). Mosaic
 * photos stay the stories' own photos, in the new order.
 */
export function postWithMemes(stories: SavedStory[], placement: Placement, memeImage: (memeId: string) => MemeImage, now: Date): RenderPost {
  const byKey = new Map(stories.map((s) => [s.key, s]));
  const ready = placement.order.map((k) => readyFromSaved(byKey.get(k)!));
  const post = buildPost(ready, now);
  const slides = post.slides.map((slide) => {
    if (slide.layoutVariant === 'lfd_cover' && placement.cover.kind === 'meme') {
      const m = memeImage(placement.cover.memeId);
      return { ...slide, lfdCover: { photos: slide.lfdCover?.photos ?? [], meme: { url: m.url, ...(m.aspect ? { aspect: m.aspect } : {}) } } };
    }
    if (slide.layoutVariant !== 'lfd_story') return slide;
    const key = placement.order[slide.position - 1];
    const image = key ? placement.slideImage[key] : undefined;
    if (!image || image.kind !== 'meme') return slide;
    const { photoFocus: _f, ...rest } = slide;
    const m = memeImage(image.memeId);
    return { ...rest, photoUrl: m.url, photoKind: 'meme' as const, ...(m.aspect ? { photoAspect: m.aspect } : {}) };
  });
  return { ...post, slides };
}
