import { findPost, type HubDataset } from '@/lib/social-hub/dataset';
import type { HubPost } from '@/lib/social-hub/types';
import { createStoriesStorage } from '@/lib/stories/storage';

const FRAME_API = /^\/api\/stories\/frames\//;

type SignMany = (paths: string[]) => Promise<Array<string | null>>;

async function liveSign(paths: string[]): Promise<Array<string | null>> {
  return createStoriesStorage().signMany(paths, 3600);
}

/**
 * Replace the frame route on the posts a page is about to show with signed
 * URLs from one batch. The bucket stays private. The shared dataset cache
 * keeps the route (and the object path); the signature is minted here, on
 * this request, and is not cached. A failed sign leaves the route in place.
 */
export async function signVisibleStoryFrames<T extends HubDataset>(dataset: T, postIds: ReadonlySet<string>, signMany: SignMany = liveSign): Promise<T> {
  if (postIds.size === 0) return dataset;
  const paths: string[] = [];
  const slots: Array<{ postIndex: number; frameIndex: number }> = [];
  dataset.posts.forEach((post, postIndex) => {
    if (!postIds.has(post.id) || post.media.kind !== 'frames') return;
    post.media.frames.forEach((frame, frameIndex) => {
      if (!frame.path || !frame.src || !FRAME_API.test(frame.src)) return;
      paths.push(frame.path);
      slots.push({ postIndex, frameIndex });
    });
  });
  if (paths.length === 0) return dataset;
  let urls: Array<string | null>;
  try {
    urls = await signMany(paths);
  } catch {
    return dataset;
  }
  const posts = dataset.posts.slice();
  const touched = new Map<number, HubPost>();
  slots.forEach((slot, i) => {
    const url = urls[i];
    if (!url) return;
    const current = touched.get(slot.postIndex) ?? posts[slot.postIndex]!;
    if (current.media.kind !== 'frames') return;
    const frames = current.media.frames.slice();
    frames[slot.frameIndex] = { ...frames[slot.frameIndex]!, src: url };
    touched.set(slot.postIndex, { ...current, media: { ...current.media, frames } });
  });
  if (touched.size === 0) return dataset;
  for (const [index, post] of touched) posts[index] = post;
  return { ...dataset, posts };
}

/** The post a drawer or a direct link opened, including an older alias. */
export async function signOpenedPost<T extends HubDataset>(dataset: T, rawId: string, signMany?: SignMany): Promise<T> {
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    // A malformed escape is not a post id.
  }
  const post = findPost(dataset, id);
  if (!post) return dataset;
  return signVisibleStoryFrames(dataset, new Set([post.id]), signMany);
}
