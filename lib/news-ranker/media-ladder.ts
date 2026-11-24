/**
 * The media ladder (MD-LFD Revisions D16–D19, 2026-11-23/24): which one media item a story posts with, and how a
 * golden video moves a story into the day. Shared by Morning Download and Last Few Days. Pure; tested offline.
 *
 *   MD:  golden video → photo → good video (only when no photo is usable) → the story drops.
 *   LFD: golden video → a meme that clears the 92% gate → photo → the story drops (Lucas 2026-11-24).
 *
 * Boost (D17, D18): only inside the window the editorial order already allows. Every story in the window with a
 * golden video posts, ahead of the stories that would post with a photo; the editorial picks fill the rest. Good
 * videos never promote, photos get no boost. The posted stories keep their editorial order.
 */

export type VideoTier = 'golden' | 'good' | 'none';
export type MdMedia = 'video' | 'photo';
export type LfdMedia = 'video' | 'meme' | 'photo';

/** MD looks for golden videos in its top 8 after cleanup (D17). */
export const MD_VIDEO_WINDOW = 8;

/** D16, Morning Download. */
export function mdMedia(m: { video: VideoTier; photo: boolean }): MdMedia | null {
  if (m.video === 'golden') return 'video';
  if (m.photo) return 'photo';
  if (m.video === 'good') return 'video';
  return null;
}

/** D16 + D19, Last Few Days (Lucas 2026-11-24: "Golden video, then a meme that clears the 92% gate, then photo"). */
export function lfdMedia(m: { video: VideoTier; meme: boolean; photo: boolean }): LfdMedia | null {
  if (m.video === 'golden') return 'video';
  if (m.meme) return 'meme';
  if (m.photo) return 'photo';
  return null;
}

/**
 * D17/D18: `order` is the editorial order (best first), `chosen` the editorial picks, `max` the day's cap.
 * Every story among the first `window` of `order` with a golden video posts (up to `max`); the picks fill the rest
 * in editorial order. Returns the posted stories in editorial order, each marked promoted when the boost brought it in.
 */
export function promoteGolden<T>(
  order: readonly T[],
  chosen: readonly T[],
  opts: { window: number; max: number; tier: (s: T) => VideoTier },
): Array<{ story: T; promoted: boolean }> {
  const rank = new Map<T, number>();
  for (const s of [...order, ...chosen]) if (!rank.has(s)) rank.set(s, rank.size);
  const golden = order.slice(0, opts.window).filter((s) => opts.tier(s) === 'golden').slice(0, opts.max);
  const fill = chosen.filter((s) => !golden.includes(s)).sort((a, b) => rank.get(a)! - rank.get(b)!);
  const posted = [...golden, ...fill].slice(0, Math.max(opts.max, golden.length));
  return posted.sort((a, b) => rank.get(a)! - rank.get(b)!).map((story) => ({ story, promoted: golden.includes(story) && !chosen.includes(story) }));
}

/**
 * D16 drop, MD: a story with no media drops. When that leaves fewer than `min`, the best-ranked media-less stories
 * stay (as type frames) to reach `min` (D17: "it just uses whatever photo for stories it can").
 * `list` is in editorial order; returns indexes into it, still in order.
 */
export function keepWithMedia(media: ReadonlyArray<MdMedia | LfdMedia | null>, min: number): number[] {
  const withMedia = media.flatMap((m, i) => (m ? [i] : []));
  if (withMedia.length >= min) return withMedia;
  const extra = media.flatMap((m, i) => (m ? [] : [i])).slice(0, min - withMedia.length);
  return [...withMedia, ...extra].sort((a, b) => a - b);
}
