import { dbQuery } from '@/lib/db';
import { approveItem, ensureContentItem, rejectItem, type ApprovalVia, type SpineQuery } from '@/lib/social-hub/spine';

/**
 * A trial reel on the lifecycle spine (D39): the content item is the video
 * (`reels.video_jobs`, native_ref), its post idea the idea (idea_ref).
 */
export const reelsSpine: SpineQuery = (text, params) => dbQuery(text, params) as ReturnType<SpineQuery>;

export async function reelItemId(videoJobId: string): Promise<string | null> {
  // native_ref is the database's own id text, never the caller's spelling of it (D41).
  const { rows } = await dbQuery<{ id: string; post_idea_id: string }>(`SELECT id::text AS id, post_idea_id::text AS post_idea_id FROM reels.video_jobs WHERE id = $1`, [videoJobId]);
  if (!rows[0]) return null;
  return ensureContentItem(reelsSpine, { vertical: 'reels', format: 'reel', nativeRef: rows[0].id, ideaRef: rows[0].post_idea_id });
}

/** Approve the video's item (Force post, or a slot's approval carried onto the video it posts). */
export async function approveReel(videoJobId: string, via: ApprovalVia): Promise<void> {
  const itemId = await reelItemId(videoJobId);
  if (itemId) await approveItem(reelsSpine, itemId, via);
}

/** Reject the video's item: it never posts (D36). */
export async function rejectReelItem(videoJobId: string, by: string | null): Promise<void> {
  const itemId = await reelItemId(videoJobId);
  if (itemId) await rejectItem(reelsSpine, itemId, by);
}
