/**
 * Publishing a Field Notes post: the same Instagram feed-carousel calls and account gate as the
 * other feed types (lib/social/overnight/publish.ts carryFeedAttempt). Its own steps: the queue
 * rule (a field_notes.posts row in review with 2 to 10 slides), and marking the post published.
 *
 * `publishing_live` is checked here as well as by the worker: while it is off, nothing is queued
 * and nothing is claimed, so `deps.meta` (Instagram) is never touched.
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

import { FIELD_NOTES_FEED_VERTICAL } from './config';
import { fieldNotesItemId } from './items';
import { readFieldNotesSettings } from './settings';
import { POST_TIP_IDS_SQL } from './store';

export const FIELD_NOTES_PUBLISHING_OFF_NOTE = 'Field Notes publishing is off. Turn it on before publishing.';

const publishingLive = (query: Query) => readFieldNotesSettings(query).then((s) => s.publishingLive).catch(() => false);

export async function queueFieldNotesPublish(query: Query, postId: string, trigger: PublishTrigger): Promise<Queued> {
  if (!(await publishingLive(query))) return { queued: false, note: FIELD_NOTES_PUBLISHING_OFF_NOTE, terminal: false };
  const { rows } = await query(`SELECT id::text AS id, status, caption, slide_objects FROM field_notes.posts WHERE id = $1`, [postId]);
  const post = rows[0];
  if (!post) return { queued: false, note: 'The post is gone.', terminal: true };
  if (post.status === 'published') return { queued: false, note: 'This Field Notes post is already published.', terminal: true, alreadyPublished: true };
  if (post.status !== 'review') return { queued: false, note: `Only posts in review publish (this one is ${post.status}).`, terminal: true };
  const objects = (Array.isArray(post.slide_objects) ? post.slide_objects : []) as string[];
  // The caption is built by code and already within Instagram's limit (lib/field-notes/caption.ts).
  const caption = String(post.caption ?? '').trim();
  const problem = checkFeedPayload(objects, caption);
  if (problem) return { queued: false, note: problem, terminal: true };
  const itemId = await fieldNotesItemId(query, postId);
  if (!itemId) return { queued: false, note: 'The post is gone.', terminal: true };
  return queueFeedAttempt(query, { vertical: FIELD_NOTES_FEED_VERTICAL, itemId, trigger, caption, imageObjects: objects });
}

export function failStaleFieldNotesAttempts(query: Query): Promise<void> {
  return failStaleAttempts(query, FIELD_NOTES_FEED_VERTICAL);
}

/** The type's step once Instagram has the post: the post is published and its tip is posted. */
export async function markFieldNotesPublished(query: Query, postId: string, finishedAt: string): Promise<void> {
  await query(`UPDATE field_notes.posts SET status = 'published', published_at = $2::timestamptz, updated_at = now() WHERE id = $1`, [postId, finishedAt]);
  await query(`UPDATE field_notes.tips SET status = 'posted', updated_at = now() WHERE id IN (${POST_TIP_IDS_SQL})`, [postId]);
}

/** Carry one claimed attempt to Instagram; on success the post is marked published. */
export function carryFieldNotesAttempt(deps: PublishDeps, id: string): Promise<{ id: string; status: 'published' | 'failed' }> {
  return carryFeedAttempt(deps, id, { vertical: FIELD_NOTES_FEED_VERTICAL, onPublished: markFieldNotesPublished });
}

/** Claim one queued Field Notes post and carry it to Instagram. Null while publishing is off, or when nothing is queued. */
export async function claimAndPublishFieldNotes(deps: PublishDeps): Promise<{ id: string; status: 'published' | 'failed' } | null> {
  if (!(await publishingLive(deps.query))) return null;
  const id = await claimFeedAttempt(deps.query, FIELD_NOTES_FEED_VERTICAL);
  if (!id) return null;
  return carryFieldNotesAttempt(deps, id);
}
