/**
 * Reads for other systems (spec docs/superpowers/specs/2026-10-08-social-storage.md §3).
 * Server-only: they use the shared Postgres pool. Other systems read posts and
 * used photos here (or query the `social` tables); they never write
 * used_photos except for a photo they actually published.
 */
import { getPost as getPostQ, listPosts as listPostsQ, listUsedPhotos as listUsedPhotosQ, type PostStatus } from './pg';
import { socialQuery } from './index';

export async function listSocialPosts(opts: { since?: Date; status?: PostStatus; limit?: number } = {}) {
  return listPostsQ(await socialQuery(), opts);
}

export async function getSocialPost(slug: string) {
  return getPostQ(await socialQuery(), slug);
}

/** Photos used in the last `days` (default 7: the no-repeat window), newest first, with their bank tags. */
export async function recentUsedPhotos(days?: number) {
  return listUsedPhotosQ(await socialQuery(), { days });
}
