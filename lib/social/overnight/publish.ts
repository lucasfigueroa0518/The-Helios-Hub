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
 * Carousel publish attempts on the lifecycle spine (social_hub.publish_attempts,
 * vertical 'carousels'): requested → creating (item + parent containers) →
 * processing (status poll) → publishing (media_publish) → published | failed.
 * A carousel posts once. One publish at a time across every type already on
 * the spine: they share one Instagram account (D36).
 */

export type PublishTrigger = 'approve' | 'auto' | 'force';

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
  if (objects.length < CAROUSEL_MIN_ITEMS || objects.length > CAROUSEL_MAX_ITEMS) {
    return { queued: false, note: `The post needs ${CAROUSEL_MIN_ITEMS}–${CAROUSEL_MAX_ITEMS} slide images in Storage (has ${objects.length}).`, terminal: true };
  }
  const caption = carouselCaption(post.render as RenderPost);
  if (!caption) return { queued: false, note: 'The post has no caption.', terminal: true };
  if (caption.length > CAPTION_MAX_CHARS) {
    return { queued: false, note: `The caption with credits is ${caption.length} characters; Instagram takes ${CAPTION_MAX_CHARS}.`, terminal: true };
  }
  const itemId = await carouselItemId(query, postId);
  if (!itemId) return { queued: false, note: 'The post is gone.', terminal: true };
  try {
    const inserted = await query(
      `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, payload)
       VALUES ($1, 'carousels', $2, 'requested', $3, $4::jsonb) RETURNING id`,
      [itemId, trigger, caption, JSON.stringify({ image_objects: objects })],
    );
    return { queued: true, id: inserted.rows[0].id as string };
  } catch (error) {
    if (isUniqueViolation(error)) return { queued: false, note: 'This carousel is already publishing or published.', terminal: false };
    throw error;
  }
}

/** Fail this type's attempts a dead worker left mid-publish. */
export async function failStaleAttempts(query: Query): Promise<void> {
  await query(
    `UPDATE social_hub.publish_attempts
        SET status = 'failed', finished_at = now(),
            error = 'The worker stopped while this carousel was publishing. Check Instagram before trying again.'
      WHERE vertical = 'carousels' AND status IN ('creating', 'processing', 'publishing')
        AND started_at < now() - make_interval(mins => $1)`,
    [PUBLISH_STALE_MINUTES],
  );
}

async function claimPublish(query: Query): Promise<string | null> {
  await failStaleAttempts(query);
  const { rows } = await query(
    `UPDATE social_hub.publish_attempts SET status = 'creating', started_at = now()
      WHERE id = (
        SELECT id FROM social_hub.publish_attempts
         WHERE vertical = 'carousels' AND status = 'requested'
           AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts a WHERE a.status IN ('creating', 'processing', 'publishing'))
         ORDER BY requested_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id`,
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

/** Claim one queued carousel and carry it to Instagram. */
export async function claimAndPublish(deps: PublishDeps): Promise<{ id: string; status: 'published' | 'failed' } | null> {
  const id = await claimPublish(deps.query);
  if (!id) return null;
  return carryAttempt(deps, id);
}

/** Carry one claimed attempt (status `creating`) to Instagram: the account gate, the containers, the poll, the publish. */
export async function carryAttempt(deps: PublishDeps, id: string): Promise<{ id: string; status: 'published' | 'failed' }> {
  const { query, meta } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const statusLog: Array<{ at: string; statusCode: string; status: string | null }> = [];
  try {
    const { rows } = await query(
      `SELECT ci.native_ref AS post_id, a.caption, a.payload->'image_objects' AS image_objects
         FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
        WHERE a.id = $1`,
      [id],
    );
    const attempt = rows[0] as { post_id: string; caption: string; image_objects: string[] };

    // The account is shared by every content type (lib/instagram/account-gate.ts).
    const gate = await checkAccountQuota({ ops: meta, query });
    if (!gate.ok) throw new Error(gate.message);

    const children: string[] = [];
    for (const objectPath of attempt.image_objects) {
      children.push(await meta.createImageItem(await deps.signImage(objectPath, PUBLISH_IMAGE_URL_SECONDS)));
    }
    await update(query, id, { child_container_ids: JSON.stringify(children) });
    const containerId = await meta.createCarousel(children, attempt.caption);
    await update(query, id, { status: 'processing', container_id: containerId });

    const deadline = now() + PUBLISH_POLL_TIMEOUT_MINUTES * 60_000;
    for (;;) {
      const status = await meta.containerStatus(containerId);
      statusLog.push({ at: new Date(now()).toISOString(), ...status });
      if (status.statusCode === 'FINISHED') break;
      if (status.statusCode === 'ERROR' || status.statusCode === 'EXPIRED') {
        throw new Error(`Instagram could not process the carousel (${status.statusCode}): ${status.status ?? 'no detail'}`);
      }
      if (now() >= deadline) throw new Error(`The container was still ${status.statusCode} after ${PUBLISH_POLL_TIMEOUT_MINUTES} minutes.`);
      await sleep(PUBLISH_POLL_SECONDS * 1000);
    }

    await update(query, id, { status: 'publishing', status_log: JSON.stringify(statusLog) });
    const mediaId = await meta.publishContainer(containerId);
    const permalink = await meta.permalink(mediaId).catch(() => null);
    const finishedAt = new Date(now()).toISOString();
    await update(query, id, { status: 'published', media_id: mediaId, permalink, finished_at: finishedAt, status_log: JSON.stringify(statusLog) });
    await query(`UPDATE social.posts SET status = 'published', published_at = $2::timestamptz WHERE id = $1`, [attempt.post_id, finishedAt]);
    await markScheduleForAttempt(query, id, 'published', null).catch(() => undefined);
    return { id, status: 'published' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await update(query, id, { status: 'failed', error: message, finished_at: new Date(now()).toISOString(), status_log: JSON.stringify(statusLog) }).catch(() => undefined);
    await markScheduleForAttempt(query, id, 'failed', message).catch(() => undefined);
    return { id, status: 'failed' };
  }
}
