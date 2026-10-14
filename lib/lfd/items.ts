/**
 * A Last Few Days post on the lifecycle spine (spec §7.2): the content item is
 * the lfd.posts row (native_ref), format 'feed', no post idea (idea_ref NULL:
 * a post is a bundle of stories, not one idea).
 */
import { ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';

export async function lfdItemId(query: SpineQuery, postId: string): Promise<string | null> {
  // native_ref is the database's own id text, never the caller's spelling of it (D41).
  const { rows } = await query(`SELECT id::text AS id FROM lfd.posts WHERE id = $1`, [postId]);
  if (!rows[0]) return null;
  return ensureContentItem(query, { vertical: 'last_few_days', format: 'feed', nativeRef: rows[0].id as string, ideaRef: null });
}
