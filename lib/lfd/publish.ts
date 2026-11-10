/**
 * Publishing a Last Few Days post (spec §7.4): the same Instagram feed-carousel
 * calls and account gate as Carousels (lib/social/overnight/publish.ts
 * carryFeedAttempt). Its own steps: the queue rule (an lfd.posts row in review
 * with 2–10 slides), marking lfd.posts published, and recording its photos in
 * the used-photo ledger for the 20-day rule (CI-32, lib/photos/used.ts).
 */
import {
  carryFeedAttempt,
  checkFeedPayload,
  claimFeedAttempt,
  failStaleAttempts,
  queueFeedAttempt,
  NO_PHOTO_DOWNLOAD,
  type PublishDeps,
  type PublishedInfo,
  type PublishTrigger,
  type Queued,
} from '@/lib/social/overnight/publish';
import type { Query } from '@/lib/social/store/pg';

import { entriesFor, lfdPostPhotos, withHashes, type PhotoHashDeps } from '@/lib/photos/published-posts';
import { recordUsedPhotos } from '@/lib/photos/used';

import { lfdItemId } from './items';

export async function queueLfdPublish(query: Query, postId: string, trigger: PublishTrigger): Promise<Queued> {
  const { rows } = await query(`SELECT id::text AS id, status, caption, slide_objects FROM lfd.posts WHERE id = $1`, [postId]);
  const post = rows[0];
  if (!post) return { queued: false, note: 'The post is gone.', terminal: true };
  if (post.status === 'published') return { queued: false, note: 'This Last Few Days post is already published.', terminal: true, alreadyPublished: true };
  if (post.status !== 'review') return { queued: false, note: `Only posts in review publish (this one is ${post.status}).`, terminal: true };
  const objects = (Array.isArray(post.slide_objects) ? post.slide_objects : []) as string[];
  // The engine's caption already ends with the credits block (lib/lfd/post.ts captionFor).
  const caption = String(post.caption ?? '').trim();
  const problem = checkFeedPayload(objects, caption);
  if (problem) return { queued: false, note: problem, terminal: true };
  const itemId = await lfdItemId(query, postId);
  if (!itemId) return { queued: false, note: 'The post is gone.', terminal: true };
  return queueFeedAttempt(query, { vertical: 'last_few_days', itemId, trigger, caption, imageObjects: objects });
}

export function failStaleLfdAttempts(query: Query): Promise<void> {
  return failStaleAttempts(query, 'last_few_days');
}

/**
 * The post's photos into the used-photo ledger (CI-32: used = published), one row per story slide; the cover
 * reuses them. Logos and meme slides are brand assets: exempt, never logged (lib/photos/published-posts.ts). Each
 * photo is hashed best effort (pHash + dHash of its bytes); one that can't be fetched still gets a URL-only row.
 * `o.read`/`o.hash` are for tests; absent, the live reader.
 */
export async function recordLfdPhotos(query: Query, postId: string, at: Date, mediaId: string | null = null, o: PhotoHashDeps = {}): Promise<number> {
  const post = await lfdPostPhotos(query, postId);
  if (!post || !post.photos.length) return 0;
  return recordUsedPhotos(query, entriesFor({ ...post, photos: await withHashes(post.photos, o) }, at, mediaId));
}

/** The type's step once Instagram has the post. A photo-record failure only logs; it never fails a post that went out. */
export async function markLfdPublished(query: Query, postId: string, finishedAt: string, info?: PublishedInfo): Promise<void> {
  await query(`UPDATE lfd.posts SET status = 'published', published_at = $2::timestamptz WHERE id = $1`, [postId, finishedAt]);
  const log = (line: string) => console.warn(`[publish] used_photos lfd ${postId}: ${line}`);
  await recordLfdPhotos(query, postId, new Date(finishedAt), info?.mediaId ?? null, { ...(info?.photos ?? NO_PHOTO_DOWNLOAD), log }).catch((e) =>
    log(`not logged (${e instanceof Error ? e.message : String(e)}); the nightly Instagram read will log it`),
  );
}

export function carryLfdAttempt(deps: PublishDeps, id: string): Promise<{ id: string; status: 'published' | 'failed' }> {
  return carryFeedAttempt(deps, id, { vertical: 'last_few_days', onPublished: markLfdPublished });
}

/** Claim one queued Last Few Days post and carry it to Instagram. */
export async function claimAndPublishLfd(deps: PublishDeps): Promise<{ id: string; status: 'published' | 'failed' } | null> {
  const id = await claimFeedAttempt(deps.query, 'last_few_days');
  if (!id) return null;
  return carryLfdAttempt(deps, id);
}
