/** The render Post, caption and credits for a Last Few Days post (spec §4.5, §6). */
import { placeMemes, type Placement } from '@/lib/memes/lfd-placement';
import { heliosLine } from '@/lib/social/captions/helios-line';
import type { Post as RenderPost, SlideCanvas, SlideCopy } from '@/lib/social/render/types';
import { FOLLOW_LINE } from '@/lib/social/writer/draft';

import type { LfdCaptionLines } from './caption-lines';
import type { Ready } from './types';

/** Engine rescue and the post-hoc stage both mark a story this way. */
export function memeIdOf(r: Ready): string | null {
  return r.meme?.memeId ?? (r.photoSource === 'meme' ? r.pick.key : null);
}

/**
 * Apply the LFD meme placement to a lead-ordered lineup: strongest meme in the
 * top 3 becomes the cover; otherwise the cover stays a photo mosaic and that
 * meme is the second story slide. Mosaic tiles are never meme images.
 */
export function arrangeMemes(ready: Ready[]): { ready: Ready[]; placement: Placement } {
  const placement = placeMemes(ready.map((r) => ({ key: r.pick.key, memeId: memeIdOf(r) })));
  const byKey = new Map(ready.map((r) => [r.pick.key, r]));
  return {
    ready: placement.order.map((key) => {
      const r = byKey.get(key)!;
      const p = placement.placed.find((x) => x.key === key);
      return p && r.meme ? { ...r, meme: { ...r.meme, role: p.role, position: p.position } } : r;
    }),
    placement,
  };
}

export function coverMemeOf(ready: Ready[], placement: Placement): { url: string } | undefined {
  const cover = placement.cover;
  if (cover.kind !== 'meme') return undefined;
  const r = ready.find((x) => x.pick.key === cover.storyKey);
  return r ? { url: r.photo.src } : undefined;
}

export const LFD_HOOK_LINES = ['Do you realize what', 'just happened in AI', 'in the last few days?'] as const;
export const LFD_KICKER = 'Trending in AI';

/**
 * The cover hook library (Lucas, 2026-11-23), in rotation order. `accent` is the phrase drawn in the accent colour.
 * Every hook must stay true in any week, since it rotates blind. `{N}` is the post's story count.
 */
export const LFD_COVER_HOOKS: ReadonlyArray<{ text: string; accent: string }> = [
  { text: 'Do you realize what just happened in AI in the last few days?', accent: 'in the last few days?' },
  { text: '{N} things happened in AI you need to know.', accent: '{N} things' },
  { text: 'Everyone in AI is talking about this. Are you?', accent: 'Are you?' },
  { text: 'AI changed this week. Most people haven’t noticed yet.', accent: 'haven’t noticed yet.' },
  { text: 'What happened in AI while you were sleeping.', accent: 'while you were sleeping.' },
  { text: 'If you missed the last few days in AI, start here.', accent: 'start here.' },
  { text: 'Here’s what happened in AI while you were busy.', accent: 'while you were busy.' },
];

/** The hook after `prevText` (the last post's hook), with `{N}` filled in. No earlier hook: the first one. */
export function nextLfdCoverHook(prevText: string | null | undefined, storyCount: number): { text: string; accent: string } {
  const fill = (s: string) => s.replaceAll('{N}', String(storyCount));
  const matches = (t: string, prev: string) => {
    const [head, tail] = t.split('{N}');
    return tail === undefined ? prev === t : prev.startsWith(head!) && prev.endsWith(tail) && /^\d+$/.test(prev.slice(head!.length, prev.length - tail.length));
  };
  const at = prevText ? LFD_COVER_HOOKS.findIndex((h) => matches(h.text, prevText)) : -1;
  const h = LFD_COVER_HOOKS[(at + 1) % LFD_COVER_HOOKS.length]!;
  return { text: fill(h.text), accent: fill(h.accent) };
}

/** The design profiles, in rotation order (2026-11-23). A post takes the one after the last post's. */
export const LFD_CANVASES: readonly SlideCanvas[] = ['black', 'green', 'orange', 'white'];

/** The profile after `prev`. With no earlier post the rotation starts on black; a post saved before profiles existed counts as black. */
export function nextLfdCanvas(prev: string | null | undefined, hadPost = prev !== undefined): SlideCanvas {
  if (!hadPost) return 'black';
  const at = LFD_CANVASES.indexOf((prev ?? 'black') as SlideCanvas);
  return LFD_CANVASES[((at < 0 ? 0 : at) + 1) % LFD_CANVASES.length]!;
}
export const CAPTION_MAX_CHARS = 2200;

/** A feed title is not an outlet: credit the site the story's link points to instead. */
export function outletOf(r: Ready): string {
  const name = (r.pick.sourceName ?? '').trim();
  if (name && !/^feed\b/i.test(name)) return name;
  try {
    return new URL(r.pick.url).hostname.replace(/^www\./, '');
  } catch {
    return name;
  }
}

export function creditsFor(ready: Ready[]): string {
  const sources = [...new Set(ready.map(outletOf).filter(Boolean))];
  const photos = [...new Set(ready.map((r) => r.photo.credit).filter(Boolean))];
  return [sources.length ? `Sources: ${sources.join(', ')}` : '', photos.length ? `Photos: ${photos.join('; ')}` : ''].filter(Boolean).join('\n');
}

/** The post's Helios line. Seeded by its story keys (order-free), so re-renders and meme reorders keep it. */
export function lfdHeliosLine(ready: Ready[]): string {
  return heliosLine('lfd', ready.map((r) => r.pick.key).sort().join('|'));
}

/** The fallback caption, built by code: the fixed hook, the headlines, the Helios line and credits. */
function templateCaption(ready: Ready[]): string {
  const hook = 'Do you realize what just happened in AI in the last few days? Swipe ⬅️ to catch up.';
  const headlines = ready.map((r) => `– ${r.copy.headline}`);
  const build = (n: number) => [hook, headlines.slice(0, n).join('\n'), lfdHeliosLine(ready), creditsFor(ready)].filter(Boolean).join('\n\n');
  // Over the limit: drop the lowest-ranked headline lines; hook, Helios line and credits stay whole.
  let n = headlines.length;
  let caption = build(n);
  while (caption.length > CAPTION_MAX_CHARS && n > 0) caption = build(--n);
  return caption;
}

/**
 * The caption and the path that produced it: the model-written lines (caption-lines.ts), the Helios
 * line, then credits; or the template when `lines` is null. Over the limit, recap lines go from the end
 * first; the opener, question and Helios line stay whole. If even one recap line will not fit, the
 * template ships and `by` says so.
 */
export function composeCaption(ready: Ready[], lines?: LfdCaptionLines | null): { caption: string; by: 'model' | 'template' } {
  if (!lines) return { caption: templateCaption(ready), by: 'template' };
  const recap = lines.body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const build = (n: number) => [lines.opener, recap.slice(0, n).join('\n'), lines.question, lfdHeliosLine(ready), creditsFor(ready)].filter(Boolean).join('\n\n');
  for (let n = recap.length; n >= 1; n--) {
    const caption = build(n);
    if (caption.length <= CAPTION_MAX_CHARS) return { caption, by: 'model' };
  }
  return { caption: templateCaption(ready), by: 'template' };
}

/**
 * The caption after the stories' photos or order change but not their words (the meme step, a photo
 * revision): a template caption is rebuilt whole; a model caption keeps everything and only its
 * credits, always last, are rebuilt. Null when the caption does not end with its credits or the result
 * is over the limit: the caller keeps the caption it has.
 */
export function recreditCaption(caption: string, from: Ready[], to: Ready[]): string | null {
  if (caption === composeCaption(from, null).caption) return composeCaption(to, null).caption;
  const oldCredits = creditsFor(from);
  const newCredits = creditsFor(to);
  if (oldCredits === newCredits) return caption;
  let head: string;
  if (!oldCredits) head = caption;
  else if (caption.endsWith(`\n\n${oldCredits}`)) head = caption.slice(0, -(oldCredits.length + 2));
  else if (caption === oldCredits) head = '';
  else return null;
  const next = [head, newCredits].filter(Boolean).join('\n\n');
  return next.length > CAPTION_MAX_CHARS ? null : next;
}

export function captionFor(ready: Ready[], lines?: LfdCaptionLines | null): string {
  return composeCaption(ready, lines).caption;
}

/**
 * `coverHook` is the rotated hook (nextLfdCoverHook): it goes in the alt text and on `lfdCover.hook`. `coverImage`
 * is the AI cover (lib/lfd/cover), drawn above the hook. Without an image the cover draws as before (mosaic or meme).
 */
export function buildPost(
  ready: Ready[],
  now: Date,
  lines?: LfdCaptionLines | null,
  opts?: { coverMeme?: { url: string; aspect?: number }; canvas?: SlideCanvas; coverHook?: { text: string; accent: string }; coverImage?: { url: string } },
): RenderPost {
  // Cover is a single meme, or a collage of non-meme photos. Never mix them.
  const mosaic = ready.filter((r) => r.photoSource !== 'meme');
  const cover: SlideCopy = {
    position: 0,
    layoutVariant: 'lfd_cover',
    altText: `${opts?.coverHook?.text ?? LFD_HOOK_LINES.join(' ')} ${LFD_KICKER}.`,
    lfdCover: {
      photos: mosaic.map((r) => ({ url: r.photo.src, kind: r.photo.kind, ...(r.photo.focus ? { focus: r.photo.focus } : {}) })),
      ...(opts?.coverMeme ? { meme: opts.coverMeme } : {}),
      ...(opts?.coverImage ? { image: { url: opts.coverImage.url } } : {}),
      ...(opts?.coverHook ? { hook: { text: opts.coverHook.text, accent: opts.coverHook.accent } } : {}),
    },
  };
  const stories: SlideCopy[] = ready.map((r, i) => ({
    position: i + 1,
    layoutVariant: 'lfd_story',
    altText: [r.copy.setup, r.copy.headline, r.copy.body].filter(Boolean).join(' '),
    lfdStory: { setup: r.copy.setup, headline: r.copy.headline, highlight: r.copy.highlight, names: r.copy.names, body: r.copy.body },
    photoUrl: r.photo.src,
    photoCredit: r.photo.credit,
    // A logo is shown whole on a plate, never cropped like a photo (photo spec §4).
    // A rescued/added meme uses the meme well (postWithMemes does the same after save).
    ...(r.photo.kind === 'logo' ? { photoKind: 'logo' as const } : r.photoSource === 'meme' ? { photoKind: 'meme' as const } : {}),
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
    slides: opts?.canvas ? [cover, ...stories, follow].map((sl) => ({ ...sl, canvas: opts.canvas })) : [cover, ...stories, follow],
    caption: captionFor(ready, lines),
    attributionBlock: undefined,
  };
}
