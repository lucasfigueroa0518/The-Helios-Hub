/**
 * A Field Notes post on the lifecycle spine: the content item is the field_notes.posts row
 * (native_ref), format 'feed', no post idea (idea_ref NULL: the tip lives in field_notes.tips).
 */
import { ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';

import { FIELD_NOTES_SPINE_VERTICAL } from './config';

export async function fieldNotesItemId(query: SpineQuery, postId: string): Promise<string | null> {
  // native_ref is the database's own id text, never the caller's spelling of it (D41).
  const { rows } = await query(`SELECT id::text AS id FROM field_notes.posts WHERE id = $1`, [postId]);
  if (!rows[0]) return null;
  return ensureContentItem(query, { vertical: FIELD_NOTES_SPINE_VERTICAL, format: 'feed', nativeRef: rows[0].id as string, ideaRef: null });
}
