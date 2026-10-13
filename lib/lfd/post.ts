/** The render Post, caption and credits for a Last Few Days post (spec §4.5, §6). */
import type { Post as RenderPost, SlideCopy } from '@/lib/social/render/types';
import { FOLLOW_LINE } from '@/lib/social/writer/draft';

import type { Ready } from './types';

export const LFD_HOOK_LINES = ['Do you realize what', 'just happened in AI', 'in the last few days?'] as const;
export const LFD_KICKER = 'Trending in AI';
export const CAPTION_MAX_CHARS = 2200;

export function creditsFor(ready: Ready[]): string {
  const sources = [...new Set(ready.map((r) => r.pick.sourceName).filter(Boolean))];
  const photos = [...new Set(ready.map((r) => r.photo.credit).filter(Boolean))];
  return [sources.length ? `Sources: ${sources.join(', ')}` : '', photos.length ? `Photos: ${photos.join('; ')}` : ''].filter(Boolean).join('\n');
}

export function captionFor(ready: Ready[]): string {
  const lines = ready.map((r) => `– ${r.copy.headline}`);
  const caption = [
    'Do you realize what just happened in AI in the last few days? Swipe ⬅️ to catch up.',
    lines.join('\n'),
    FOLLOW_LINE,
    creditsFor(ready),
  ].join('\n\n');
  return caption.length <= CAPTION_MAX_CHARS ? caption : caption.slice(0, CAPTION_MAX_CHARS);
}

export function buildPost(ready: Ready[], now: Date): RenderPost {
  const cover: SlideCopy = {
    position: 0,
    layoutVariant: 'lfd_cover',
    altText: `${LFD_HOOK_LINES.join(' ')} ${LFD_KICKER}.`,
    lfdCover: { photos: ready.map((r) => ({ url: r.photo.src, ...(r.photo.focus ? { focus: r.photo.focus } : {}) })) },
  };
  const stories: SlideCopy[] = ready.map((r, i) => ({
    position: i + 1,
    layoutVariant: 'lfd_story',
    altText: [r.copy.setup, r.copy.headline, r.copy.body].filter(Boolean).join(' '),
    lfdStory: { setup: r.copy.setup, headline: r.copy.headline, highlight: r.copy.highlight, names: r.copy.names, body: r.copy.body },
    photoUrl: r.photo.src,
    photoCredit: r.photo.credit,
    ...(r.photo.focus ? { photoFocus: { x: r.photo.focus.x, y: r.photo.focus.y } } : {}),
  }));
  const follow: SlideCopy = { position: ready.length + 1, layoutVariant: 'follow', altText: FOLLOW_LINE, storySpecificLine: FOLLOW_LINE };
  return {
    format: 'carousel',
    storyType: 'tech',
    source: ready[0]?.pick.sourceName ?? 'Helios',
    sourceUrl: ready[0]?.pick.url ?? '',
    publishedAt: now.toISOString(),
    issueNumber: 0,
    slides: [cover, ...stories, follow],
    caption: captionFor(ready),
    attributionBlock: undefined,
  };
}
