import type { Query } from '@/lib/social/store/pg';
import type { Post as RenderPost } from '@/lib/social/render/types';

import {
  CAPTION_MAX_CHARS,
  CAROUSEL_MAX_ITEMS,
  CAROUSEL_MIN_ITEMS,
  PUBLISH_IMAGE_URL_SECONDS,
  PUBLISH_POLL_SECONDS,
  PUBLISH_POLL_TIMEOUT_MINUTES,
  PUBLISH_STALE_MINUTES,
} from './config';
import { checkAccountQuota } from '@/lib/instagram/account-gate';

import { carouselItemId } from './items';
import type { CarouselMetaClient } from './meta';

/**
 * Feed-carousel publish attempts on the lifecycle spine (social_hub.publish_attempts):
 * requested → creating (item + parent containers) → processing (status poll) →
 * publishing (media_publish) → published | failed. Carousels and Last Few Days
 * post the same way (an image set as one CAROUSEL container); each type keeps
 * its own queue rule and its own "mark published" step (`onPublished`). A post
 * posts once. One publish at a time across every type already on the spine:
 * they share one Instagram account (D36).
 */

export type PublishTrigger = 'approve' | 'auto' | 'force';

/** The spine verticals that post an image set as a feed carousel. */
export type FeedVertical = 'carousels' | 'last_few_days' | 'ai_events';

const NOUN: Record<FeedVertical, string> = { carousels: 'carousel', last_few_days: 'Last Few Days post', ai_events: 'AI Events post' };

export type Queued =
  | { queued: true; id: string }
  | { queued: false; note: string; terminal: boolean; alreadyPublished?: true };

/** The caption Instagram gets: the post's caption, then its photo credits. */
export function carouselCaption(render: Pick<RenderPost, 'caption' | 'attributionBlock'>): string {
  return [render.caption?.trim(), render.attributionBlock?.trim()].filter(Boolean).join('\n\n');
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/** Why an image set can't go to Instagram, or null: 2–10 images in Storage and a caption within the limit. */
export function checkFeedPayload(imageObjects: readonly string[], caption: string): string | null {
  if (imageObjects.length < CAROUSEL_MIN_ITEMS || imageObjects.length > CAROUSEL_MAX_ITEMS) {
    return `The post needs ${CAROUSEL_MIN_ITEMS}–${CAROUSEL_MAX_ITEMS} slide images in Storage (has ${imageObjects.length}).`;
  }
  if (!caption) return 'The post has no caption.';
  if (caption.length > CAPTION_MAX_CHARS) return `The caption with credits is ${caption.length} characters; Instagram takes ${CAPTION_MAX_CHARS}.`;
  return null;
}

/** One requested attempt for an item. A second attempt in flight or published is refused by the spine's indexes. */
export async function queueFeedAttempt(
  query: Query,
  a: { vertical: FeedVertical; itemId: string; trigger: PublishTrigger; caption: string; imageObjects: readonly string[]; locationId?: string },
): Promise<Queued> {
  // publish_once (D36): an item that already has a published attempt never queues again, even when its own
  // row was not marked published (a failure after Instagram took the post).
  const { rows: published } = await query(
    `SELECT 1 FROM social_hub.publish_attempts WHERE content_item_id = $1 AND status = 'published' LIMIT 1`,
    [a.itemId],
  );
  if (published[0]) return { queued: false, note: `This ${NOUN[a.vertical]} is already published.`, terminal: true, alreadyPublished: true };
  try {
    const inserted = await query(
      `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, payload)
       VALUES ($1, $2, $3, 'requested', $4, $5::jsonb) RETURNING id`,
      [a.itemId, a.vertical, a.trigger, a.caption, JSON.stringify({ image_objects: a.imageObjects, ...(a.locationId ? { location_id: a.locationId } : {}) })],
    );
    return { queued: true, id: inserted.rows[0].id as string };
  } catch (error) {
    if (isUniqueViolation(error)) return { queued: false, note: `This ${NOUN[a.vertical]} is already publishing or published.`, terminal: false };
    throw error;
  }
}

/** Queue one post for Instagram. Only a finished pipeline post in review, with its slides in Storage, can go. */
export async function queuePublish(query: Query, postId: string, trigger: PublishTrigger): Promise<Queued> {
  const { rows } = await query(
    `SELECT id, status, origin, render, slide_objects FROM social.posts WHERE id = $1`,
    [postId],
  );
  const post = rows[0];
  if (!post) return { queued: false, note: 'The post is gone.', terminal: true };
  if (post.status === 'published') return { queued: false, note: 'This carousel is already published.', terminal: true, alreadyPublished: true };
  if (post.status !== 'review') return { queued: false, note: `Only posts in review publish (this one is ${post.status}).`, terminal: true };
  if (post.origin !== 'pipeline') return { queued: false, note: 'Development posts never publish.', terminal: true };
  const objects = (post.slide_objects ?? []) as string[];
  const caption = carouselCaption(post.render as RenderPost);
  const problem = checkFeedPayload(objects, caption);
  if (problem) return { queued: false, note: problem, terminal: true };
  const itemId = await carouselItemId(query, postId);
  if (!itemId) return { queued: false, note: 'The post is gone.', terminal: true };
  return queueFeedAttempt(query, { vertical: 'carousels', itemId, trigger, caption, imageObjects: objects });
}

/** Fail this type's attempts a dead worker left mid-publish. */
export async function failStaleAttempts(query: Query, vertical: FeedVertical = 'carousels'): Promise<void> {
  await query(
    `UPDATE social_hub.publish_attempts
        SET status = 'failed', finished_at = now(), error = $3
      WHERE vertical = $2 AND status IN ('creating', 'processing', 'publishing')
        AND started_at < now() - make_interval(mins => $1)`,
    [PUBLISH_STALE_MINUTES, vertical, `The worker stopped while this ${NOUN[vertical]} was publishing. Check Instagram before trying again.`],
  );
}

/** Claim this type's oldest queued attempt while nothing is in flight on the account. */
export async function claimFeedAttempt(query: Query, vertical: FeedVertical = 'carousels'): Promise<string | null> {
  await failStaleAttempts(query, vertical);
  const { rows } = await query(
    `UPDATE social_hub.publish_attempts SET status = 'creating', started_at = now()
      WHERE id = (
        SELECT id FROM social_hub.publish_attempts
         WHERE vertical = $1 AND status = 'requested'
           AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts a WHERE a.status IN ('creating', 'processing', 'publishing') AND a.started_at > now() - interval '30 minutes')
         ORDER BY requested_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id`,
    [vertical],
  );
  return (rows[0]?.id as string | undefined) ?? null;
}

async function update(query: Query, id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  const sets = keys.map((key, index) => `${key} = $${index + 2}`);
  await query(`UPDATE social_hub.publish_attempts SET ${sets.join(', ')} WHERE id = $1`, [id, ...keys.map((key) => fields[key])]);
}

export async function markScheduleForAttempt(query: Query, attemptId: string, status: 'published' | 'failed', error: string | null): Promise<void> {
  await query(
    `UPDATE social_hub.schedule SET status = $2, error = $3 WHERE publish_attempt_id = $1 AND status = 'publishing'`,
    [attemptId, status, error],
  );
}

export type PublishDeps = {
  query: Query;
  meta: CarouselMetaClient;
  signImage: (objectPath: string, expiresIn: number) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** A type's own step once Instagram has the post: mark its content row published (`nativeRef` = content_items.native_ref). */
export type FeedPublishHooks = {
  vertical: FeedVertical;
  onPublished: (query: Query, nativeRef: string, finishedAt: string) => Promise<void>;
};

/**
 * Carry one claimed attempt (status `creating`) to Instagram: the rejection
 * check (D41), the account gate, one image container per slide, the CAROUSEL
 * parent with the caption, the status poll, the publish, then the type's hook
 * and the slot. Any failure before Instagram returns a media id fails the
 * attempt and its slot, with the reason. Once it returns one the post is live:
 * a later failure never marks the attempt failed (that would let it post
 * again); the attempt is kept published with its media id, the error goes in
 * its status log, and the type's hook and the slot are still tried.
 */
export async function carryFeedAttempt(deps: PublishDeps, id: string, hooks: FeedPublishHooks): Promise<{ id: string; status: 'published' | 'failed' }> {
  const { query, meta } = deps;
  const noun = NOUN[hooks.vertical];
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const statusLog: Array<{ at: string; statusCode: string; status: string | null }> = [];
  let posted: { mediaId: string; permalink: string | null; nativeRef: string; hookDone: boolean } | null = null;
  try {
    const { rows } = await query(
      `SELECT ci.native_ref, a.caption, a.payload->'image_objects' AS image_objects, a.payload->>'location_id' AS location_id
         FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
        WHERE a.id = $1`,
      [id],
    );
    const attempt = rows[0] as { native_ref: string; caption: string; image_objects: string[]; location_id: string | null };

    // Rejected after its slot opened: never posts (D41).
    const { rows: rejected } = await query(
      `SELECT 1 FROM social_hub.publish_attempts a JOIN social_hub.approvals ap ON ap.content_item_id = a.content_item_id
        WHERE a.id = $1 AND ap.decision = 'rejected'`,
      [id],
    );
    if (rejected[0]) throw new Error(`This ${noun} was rejected after its slot opened; nothing was posted.`);

    // The account is shared by every content type (lib/instagram/account-gate.ts).
    const gate = await checkAccountQuota({ ops: meta, query });
    if (!gate.ok) throw new Error(gate.message);

    const children: string[] = [];
    for (const objectPath of attempt.image_objects) {
      children.push(await meta.createImageItem(await deps.signImage(objectPath, PUBLISH_IMAGE_URL_SECONDS)));
    }
    await update(query, id, { child_container_ids: JSON.stringify(children) });
    const containerId = await meta.createCarousel(children, attempt.caption, attempt.location_id ?? undefined);
    await update(query, id, { status: 'processing', container_id: containerId });

    const deadline = now() + PUBLISH_POLL_TIMEOUT_MINUTES * 60_000;
    for (;;) {
      const status = await meta.containerStatus(containerId);
      statusLog.push({ at: new Date(now()).toISOString(), ...status });
      if (status.statusCode === 'FINISHED') break;
      if (status.statusCode === 'ERROR' || status.statusCode === 'EXPIRED') {
        throw new Error(`Instagram could not process the ${noun} (${status.statusCode}): ${status.status ?? 'no detail'}`);
      }
      if (now() >= deadline) throw new Error(`The container was still ${status.statusCode} after ${PUBLISH_POLL_TIMEOUT_MINUTES} minutes.`);
      await sleep(PUBLISH_POLL_SECONDS * 1000);
    }

    await update(query, id, { status: 'publishing', status_log: JSON.stringify(statusLog) });
    const mediaId = await meta.publishContainer(containerId);
    // Instagram has the post from here on: nothing below may mark it failed.
    posted = { mediaId, permalink: null, nativeRef: attempt.native_ref, hookDone: false };
    const permalink = await meta.permalink(mediaId).catch(() => null);
    posted.permalink = permalink;
    const finishedAt = new Date(now()).toISOString();
    await update(query, id, { status: 'published', media_id: mediaId, permalink, finished_at: finishedAt, status_log: JSON.stringify(statusLog) });
    await hooks.onPublished(query, attempt.native_ref, finishedAt);
    posted.hookDone = true;
    await markScheduleForAttempt(query, id, 'published', null).catch(() => undefined);
    return { id, status: 'published' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (posted) {
      // Posted, then the bookkeeping failed. Keep it published (publish_once then refuses a second post).
      const finishedAt = new Date(now()).toISOString();
      statusLog.push({ at: finishedAt, statusCode: 'POSTED_BOOKKEEPING_ERROR', status: message });
      console.warn(`[publish] ${noun} attempt ${id} posted as ${posted.mediaId}, then failed to record: ${message}`);
      await update(query, id, { status: 'published', media_id: posted.mediaId, permalink: posted.permalink, finished_at: finishedAt, status_log: JSON.stringify(statusLog) })
        .catch((e) => console.warn(`[publish] could not record attempt ${id} as published: ${e instanceof Error ? e.message : String(e)}`));
      if (!posted.hookDone) {
        await hooks.onPublished(query, posted.nativeRef, finishedAt)
          .catch((e) => console.warn(`[publish] could not mark ${noun} ${posted?.nativeRef} published: ${e instanceof Error ? e.message : String(e)}`));
      }
      await markScheduleForAttempt(query, id, 'published', null).catch(() => undefined);
      return { id, status: 'published' };
    }
    await update(query, id, { status: 'failed', error: message, finished_at: new Date(now()).toISOString(), status_log: JSON.stringify(statusLog) }).catch(() => undefined);
    await markScheduleForAttempt(query, id, 'failed', message).catch(() => undefined);
    return { id, status: 'failed' };
  }
}

/** Carry one claimed carousel attempt; on success the social.posts row is marked published. */
export async function carryAttempt(deps: PublishDeps, id: string): Promise<{ id: string; status: 'published' | 'failed' }> {
  return carryFeedAttempt(deps, id, {
    vertical: 'carousels',
    onPublished: async (query, postId, finishedAt) => {
      await query(`UPDATE social.posts SET status = 'published', published_at = $2::timestamptz WHERE id = $1`, [postId, finishedAt]);
    },
  });
}

/** Claim one queued carousel and carry it to Instagram. */
export async function claimAndPublish(deps: PublishDeps): Promise<{ id: string; status: 'published' | 'failed' } | null> {
  const id = await claimFeedAttempt(deps.query, 'carousels');
  if (!id) return null;
  return carryAttempt(deps, id);
}
