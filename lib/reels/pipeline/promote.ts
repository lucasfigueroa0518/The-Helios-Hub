import { dbQuery } from '@/lib/db';
import type { HeldOutReason } from '@/lib/reels/copy/held-out';
import type { MovesQuery } from '@/lib/social-hub/moves-store';

/**
 * Trial Reels' side of the shared queue (spec 2026-10-14 §2): the night's
 * moves through the shared pool, an older promoted idea onto tonight's slate,
 * and the words the page shows when the night can't make it.
 */

export const reelsMovesQuery: MovesQuery = (text, params) => dbQuery(text, params);

/** Why tonight's promoted reel wasn't made (shown on the page as “Can’t be made: …”). */
export const REEL_SKIP: Record<HeldOutReason | 'gone' | 'placed' | 'missed' | 'full', string> = {
  gone: 'It isn’t in the reels pool any more.',
  placed: 'A person already put it on the calendar.',
  missed: 'Its copy missed the bar tonight.',
  full: 'Tonight’s reels were already locked.',
  already_published: 'This story already posted.',
  published_url: 'This story already posted.',
  teaser_only: 'Its sources are only teasers.',
  copy_wide_miss: 'Its last copy missed the bar by a lot.',
};

/**
 * Put an idea on tonight's slate by copying its latest stored score row from
 * an earlier slate: no re-scoring, no Jev. Origin `carryover`, the slate's
 * next rank (loadCopyTargets reads ranked rows), not selected. True when the
 * idea is on the slate with scores (already, or now); false when it has none
 * to copy or the copy fails.
 */
export async function putOnSlate(slateId: string, postIdeaId: string): Promise<boolean> {
  try {
    const on = await dbQuery(
      `SELECT 1 FROM reels.idea_scores
        WHERE slate_id = $1::uuid AND post_idea_id = $2::uuid
          AND net IS NOT NULL AND chosen_bucket IS NOT NULL AND chosen_framework IS NOT NULL`,
      [slateId, postIdeaId],
    );
    if (on.rows.length > 0) return true;
    const { rows } = await dbQuery(
      `INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework,
                                      psychology, bucket_score, value_score, blockbuster, confidence, components)
       SELECT $1::uuid, s.post_idea_id, 'carryover', s.net,
              (SELECT COALESCE(max(rank), 0) + 1 FROM reels.idea_scores WHERE slate_id = $1::uuid), false,
              s.chosen_bucket, s.chosen_framework, s.psychology, s.bucket_score, s.value_score, s.blockbuster, s.confidence, s.components
         FROM reels.idea_scores s
         JOIN reels.score_slates ss ON ss.id = s.slate_id
        WHERE s.post_idea_id = $2::uuid AND s.slate_id <> $1::uuid
          AND s.net IS NOT NULL AND s.chosen_bucket IS NOT NULL AND s.chosen_framework IS NOT NULL
        ORDER BY ss.ny_date DESC, ss.scored_at DESC
        LIMIT 1
       ON CONFLICT (slate_id, post_idea_id) DO NOTHING
       RETURNING post_idea_id::text`,
      [slateId, postIdeaId],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}
