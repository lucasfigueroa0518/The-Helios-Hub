import { ensureContentItem } from '@/lib/social-hub/spine';
import type { Query } from '@/lib/social/store/pg';

/**
 * A carousel on the lifecycle spine: the content item is the `social.posts`
 * row (native_ref), its post idea the news story (idea_ref = story_id).
 */
export async function carouselItemId(query: Query, postId: string): Promise<string | null> {
  const { rows } = await query(`SELECT story_id FROM social.posts WHERE id = $1`, [postId]);
  if (!rows[0]) return null;
  return ensureContentItem(query, { vertical: 'carousels', format: 'feed', nativeRef: postId, ideaRef: (rows[0].story_id as string | null) ?? null });
}
