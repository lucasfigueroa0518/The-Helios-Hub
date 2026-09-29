/**
 * Queue whole regeneration for the private review set: the September 29
 * new-scoring reels (top 5, plus Sonnet 5.5).
 *
 *   npx tsx --env-file=.env.local scripts/reels_regenerate_review_slate.ts
 */

import { reviewIdeaTargets } from '@/lib/reels/review';
import { requestFinish } from '@/lib/reels/visual/finish';

async function main() {
  const rows = await reviewIdeaTargets();
  if (rows.length === 0) {
    console.log('No finished reels on the review slate.');
    return;
  }

  console.log(`Queuing regeneration for ${rows.length} review reels…`);
  for (const row of rows) {
    const result = await requestFinish(row.postIdeaId, row.slateId);
    console.log(
      JSON.stringify({
        rank: row.rank,
        post_idea_id: row.postIdeaId,
        status: result.status,
        note: result.note,
      }),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
