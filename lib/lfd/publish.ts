/**
 * Publishing a Last Few Days post (spec §7.4): the same Instagram feed-carousel
 * calls and account gate as Carousels (lib/social/overnight/publish.ts
 * carryFeedAttempt). Its own steps: the queue rule (an lfd.posts row in review
 * with 2–10 slides), marking lfd.posts published, and recording its photos in
 * social.used_photos for the shared 7-day no-repeat rule (spec §5).
 */
import {
  carryFeedAttempt,
  checkFeedPayload,
  claimFeedAttempt,
  failStaleAttempts,
  queueFeedAttempt,
  type PublishDeps,
  type PublishTrigger,
  type Queued,
} from '@/lib/social/overnight/publish';
import type { Query } from '@/lib/social/store/pg';

import { LFD_PHOTO_STORY_PREFIX } from './config';
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

type StoryPhoto = { src?: unknown; credit?: unknown; kind?: unknown };

/**
 * The post's photos into social.used_photos (one row per story slide; the
 * cover reuses them). Logos are exempt from the 7-day rule, so they are not
 * recorded. post_id stays NULL: it points at social.posts, and this is not one.
 */
export async function recordLfdPhotos(query: Query, postId: string, at: Date): Promise<number> {
  const { rows } = await query(`SELECT stories FROM lfd.posts WHERE id = $1`, [postId]);
  const stories = (Array.isArray(rows[0]?.stories) ? rows[0].stories : []) as Array<{ photo?: StoryPhoto }>;
  let recorded = 0;
  for (const [i, story] of stories.entries()) {
    const photo = story.photo;
    if (!photo || typeof photo.src !== 'string' || !photo.src || photo.kind === 'logo') continue;
    await query(
      `INSERT INTO social.used_photos (url, used_at, story_id, slide, source, credit, scene)
       VALUES ($1, $2::timestamptz, $3, $4, 'lfd', $5, $6) ON CONFLICT DO NOTHING`,
      [photo.src, at.toISOString(), `${LFD_PHOTO_STORY_PREFIX}${postId}`, i + 2, typeof photo.credit === 'string' ? photo.credit : null, typeof photo.kind === 'string' ? photo.kind : null],
    );
    recorded += 1;
  }
  return recorded;
}

/** The type's step once Instagram has the post. A photo-record failure never fails a post that went out. */
export async function markLfdPublished(query: Query, postId: string, finishedAt: string): Promise<void> {
  await query(`UPDATE lfd.posts SET status = 'published', published_at = $2::timestamptz WHERE id = $1`, [postId, finishedAt]);
  await recordLfdPhotos(query, postId, new Date(finishedAt)).catch(() => undefined);
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
