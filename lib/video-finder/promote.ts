/**
 * Golden-video promotion for Morning Download (lab, 2026-11-23). Lucas: "a story with a great video is GOLDEN!!!!!
 * … our video finder should be checking to see which stories in the top 8 it can find a great video, and those should
 * get promoted to being used. But only TOP stories with GOLDEN videos get through."
 *
 * Rule, on top of the photo walk (choosePosts, 2026-11-22):
 *   1. After the same cleanup (duplicates dropped, one story per crowding group), video-check the top
 *      VIDEO_CHECK_DEPTH stories.
 *   2. Every one of them with a golden clip is posted, whatever its tier or photo, ahead of photo-only stories.
 *   3. The photo walk's picks fill the remaining slots up to MAX_POSTS, in rank order.
 *   4. A posted story uses its clip only when the clip is golden; otherwise its photo. Good-but-not-golden clips
 *      neither promote a story nor replace a photo.
 * Pure; tested offline.
 */
export const VIDEO_CHECK_DEPTH = 8;
/** Same cap as the photo walk (news-ranker-rerank MAX_POSTS). */
export const MAX_POSTS = 5;

export type VideoVerdict = 'golden' | 'good' | 'none';
export type RankedStory = { id: string; duplicate_of: string | null; top_tier: boolean | null; crowds: string | null };
export type Post = { id: string; media: 'video' | 'photo'; promoted: boolean };

/** The photo walk's cleanup: drop duplicates, keep the highest-ranked story of each crowding group. */
export function cleanRanked<T extends RankedStory>(ranked: T[]): T[] {
  const list = ranked.filter((s) => !s.duplicate_of);
  const parent = new Map<string, string>();
  const root = (x: string): string => { const p = parent.get(x); if (!p || p === x) return x; const r = root(p); parent.set(x, r); return r; };
  for (const s of list) if (s.crowds && list.some((t) => t.id === s.crowds)) parent.set(root(s.id), root(s.crowds));
  const seen = new Set<string>();
  return list.filter((s) => { const r = root(s.id); if (seen.has(r)) return false; seen.add(r); return true; });
}

/**
 * `photoPosts` is the photo walk's result (choosePosts ids). Returns the day's posts in rank order.
 */
export function choosePostsWithVideo<T extends RankedStory>(ranked: T[], photoPosts: string[], video: (s: T) => VideoVerdict): Post[] {
  const clean = cleanRanked(ranked);
  const rank = new Map(clean.map((s, i) => [s.id, i]));
  const golden = clean.slice(0, VIDEO_CHECK_DEPTH).filter((s) => video(s) === 'golden').map((s) => s.id).slice(0, MAX_POSTS);
  const rest = photoPosts.filter((id) => !golden.includes(id)).sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
  const ids = [...golden, ...rest].slice(0, Math.max(MAX_POSTS, golden.length));
  return ids
    .sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99))
    .map((id) => ({ id, media: golden.includes(id) ? 'video' : 'photo', promoted: golden.includes(id) && !photoPosts.includes(id) }));
}
