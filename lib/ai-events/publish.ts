/**
 * Publishing an AI Events post (plan M4): the same Instagram feed-carousel calls and account
 * gate as Carousels and Last Few Days (lib/social/overnight/publish.ts carryFeedAttempt). Its own
 * steps: the queue rule (an ai_events.posts row in review with 2–10 slides), marking the post
 * published, and publishing the public calendar snapshot again so the website shows the week as
 * posted. A snapshot failure never fails a post that went out.
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

import { AI_EVENTS_VERTICAL, igLocationIdFor } from './config';
import { aiEventsItemId } from './items';

/** The public calendar snapshot (lib/networking/public-snapshot.ts publishSnapshot), injected so tests never reach Storage. */
export type SnapshotPublisher = (reason: string) => Promise<unknown>;

export async function queueAiEventsPublish(query: Query, postId: string, trigger: PublishTrigger): Promise<Queued> {
  const { rows } = await query(`SELECT id::text AS id, status, caption, slide_objects, metro FROM ai_events.posts WHERE id = $1`, [postId]);
  const post = rows[0];
  if (!post) return { queued: false, note: 'The post is gone.', terminal: true };
  if (post.status === 'published') return { queued: false, note: 'This AI Events post is already published.', terminal: true, alreadyPublished: true };
  if (post.status !== 'review') return { queued: false, note: `Only posts in review publish (this one is ${post.status}).`, terminal: true };
  const objects = (Array.isArray(post.slide_objects) ? post.slide_objects : []) as string[];
  // The caption is built by code and already within Instagram's limit (lib/ai-events/caption.ts).
  const caption = String(post.caption ?? '').trim();
  const problem = checkFeedPayload(objects, caption);
  if (problem) return { queued: false, note: problem, terminal: true };
  const itemId = await aiEventsItemId(query, postId);
  if (!itemId) return { queued: false, note: 'The post is gone.', terminal: true };
  return queueFeedAttempt(query, { vertical: AI_EVENTS_VERTICAL, itemId, trigger, caption, imageObjects: objects, locationId: igLocationIdFor(post.metro as string | null) });
}

export function failStaleAiEventsAttempts(query: Query): Promise<void> {
  return failStaleAttempts(query, AI_EVENTS_VERTICAL);
}

/** The type's step once Instagram has the post. */
export async function markAiEventsPublished(query: Query, postId: string, finishedAt: string): Promise<void> {
  await query(`UPDATE ai_events.posts SET status = 'published', published_at = $2::timestamptz, updated_at = now() WHERE id = $1`, [postId, finishedAt]);
}

/**
 * Carry one claimed attempt to Instagram; on success the post is marked published and, when
 * `snapshot` is given, the public calendar is published again once the attempt and its slot are
 * recorded (a snapshot failure is only logged).
 */
export async function carryAiEventsAttempt(
  deps: PublishDeps,
  id: string,
  o: { snapshot?: SnapshotPublisher; log?: (message: string, fields?: Record<string, unknown>) => void } = {},
): Promise<{ id: string; status: 'published' | 'failed' }> {
  const out = await carryFeedAttempt(deps, id, { vertical: AI_EVENTS_VERTICAL, onPublished: markAiEventsPublished });
  if (out.status === 'published' && o.snapshot) {
    await o.snapshot('ai_events published').catch((error) =>
      o.log?.('ai_events_snapshot_failed', { attemptId: id, error: error instanceof Error ? error.message : String(error) }),
    );
  }
  return out;
}

/** Claim one queued AI Events post and carry it to Instagram. */
export async function claimAndPublishAiEvents(
  deps: PublishDeps,
  o: Parameters<typeof carryAiEventsAttempt>[2] = {},
): Promise<{ id: string; status: 'published' | 'failed' } | null> {
  const id = await claimFeedAttempt(deps.query, AI_EVENTS_VERTICAL);
  if (!id) return null;
  return carryAiEventsAttempt(deps, id, o);
}
