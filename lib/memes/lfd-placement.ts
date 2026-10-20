/**
 * Where memes go in a Last Few Days post (LFD lab plan §4, Lucas 2026-10-19).
 *
 * The meme stories are the stories whose slate gave a meme (its #1), in the
 * post's original order (its story-strength order), at most three.
 * - #1, when it is in the original top 3: its meme becomes the cover (with the
 *   hook banner), and the story moves to the first story slide with its
 *   original photo.
 * - #1, outside the top 3: the story moves to the second story slide, and that
 *   slide shows the meme in its photo box. The cover stays the photo mosaic.
 * - #2 and #3 keep their place among the others, and their slides show their
 *   memes in the photo box.
 * The cover mosaic always uses the stories' original photos (ME-100).
 */
export const TOP_STORIES = 3;
export const MAX_PLACED = 3;

export type PlacementInput = { key: string; memeId: string | null };

export type Placement = {
  /** Story keys in the new order. */
  order: string[];
  cover: { kind: 'mosaic' } | { kind: 'meme'; memeId: string; storyKey: string };
  /** What each story's slide shows, by key. */
  slideImage: Record<string, { kind: 'photo' } | { kind: 'meme'; memeId: string }>;
  /** Meme stories in rank order, with what happened to each. */
  placed: Array<{ key: string; memeId: string; rank: number; origIndex: number; role: 'cover' | 'slide'; position: number }>;
};

/** `stories` in the original post order. Positions in the result are 1-based story slides (the cover is 0). */
export function placeMemes(stories: PlacementInput[]): Placement {
  const memeStories = stories
    .map((s, origIndex) => ({ ...s, origIndex }))
    .filter((s): s is { key: string; memeId: string; origIndex: number } => s.memeId !== null)
    .slice(0, MAX_PLACED);
  const slideImage: Placement['slideImage'] = Object.fromEntries(stories.map((s) => [s.key, { kind: 'photo' as const }]));
  const order = stories.map((s) => s.key);
  let cover: Placement['cover'] = { kind: 'mosaic' };
  const first = memeStories[0];
  if (first) {
    order.splice(order.indexOf(first.key), 1);
    if (first.origIndex < TOP_STORIES) {
      cover = { kind: 'meme', memeId: first.memeId, storyKey: first.key };
      order.splice(0, 0, first.key);
    } else {
      order.splice(Math.min(1, order.length), 0, first.key);
      slideImage[first.key] = { kind: 'meme', memeId: first.memeId };
    }
  }
  for (const s of memeStories.slice(1)) slideImage[s.key] = { kind: 'meme', memeId: s.memeId };
  const placed = memeStories.map((s, i) => ({
    key: s.key,
    memeId: s.memeId,
    rank: i + 1,
    origIndex: s.origIndex,
    role: (i === 0 && cover.kind === 'meme' ? 'cover' : 'slide') as 'cover' | 'slide',
    position: order.indexOf(s.key) + 1,
  }));
  return { order, cover, slideImage, placed };
}
