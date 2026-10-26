/**
 * An AI Events post on the lifecycle spine (plan M4): the content item is the ai_events.posts
 * row (native_ref), format 'feed', no post idea (idea_ref NULL: a post is a bundle of events).
 * A rebuild re-renders the same row, so the item, its approval and its slot stay.
 */
import { ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';

import { AI_EVENTS_SPINE_VERTICAL } from './config';

export async function aiEventsItemId(query: SpineQuery, postId: string): Promise<string | null> {
  // native_ref is the database's own id text, never the caller's spelling of it (D41).
  const { rows } = await query(`SELECT id::text AS id FROM ai_events.posts WHERE id = $1`, [postId]);
  if (!rows[0]) return null;
  return ensureContentItem(query, { vertical: AI_EVENTS_SPINE_VERTICAL, format: 'feed', nativeRef: rows[0].id as string, ideaRef: null });
}
