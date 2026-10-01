import { dbQuery, dbTransaction } from '@/lib/db';
import { orderedForSlots, type SlotIdea, type SlotLock } from '@/lib/reels/copy/slots';

export type ReelLock = SlotLock & { nyDate: string; slateId: string };

/** A lock for this idea on the slate's New York date, if Lucas pinned that reel. */
export async function findReelLock(
  slateId: string,
  postIdeaId: string,
): Promise<{ nyDate: string; slot: number } | null> {
  const { rows } = await dbQuery<{ ny_date: string; slot: number }>(
    `SELECT l.ny_date::text AS ny_date, l.slot
       FROM reels.reel_locks l
       JOIN reels.score_slates s ON s.ny_date = l.ny_date
      WHERE s.id = $1::uuid AND l.post_idea_id = $2::uuid`,
    [slateId, postIdeaId],
  );
  const row = rows[0];
  return row ? { nyDate: row.ny_date, slot: row.slot } : null;
}

export async function locksForSlate(slateId: string): Promise<ReelLock[]> {
  const { rows } = await dbQuery<{ ny_date: string; slot: number; post_idea_id: string; slate_id: string }>(
    `SELECT l.ny_date::text AS ny_date, l.slot, l.post_idea_id::text, l.slate_id::text
       FROM reels.reel_locks l
       JOIN reels.score_slates s ON s.ny_date = l.ny_date
      WHERE s.id = $1::uuid
      ORDER BY l.slot`,
    [slateId],
  );
  return rows.map((row) => ({
    nyDate: row.ny_date,
    slot: row.slot,
    postIdeaId: row.post_idea_id,
    slateId: row.slate_id,
  }));
}

export async function loadDayPenalties(nyDate: string): Promise<Map<string, number>> {
  const { rows } = await dbQuery<{ post_idea_id: string; penalty: number }>(
    `SELECT post_idea_id::text, penalty FROM reels.copy_day_penalties WHERE ny_date = $1::date`,
    [nyDate],
  );
  return new Map(rows.map((row) => [row.post_idea_id, Number(row.penalty)]));
}

/** Remember the demotion, then reorder this slate so the idea drops in the list. The net column stays. */
export async function saveDayPenalty(slateId: string, nyDate: string, postIdeaId: string, penalty: number): Promise<void> {
  await dbQuery(
    `INSERT INTO reels.copy_day_penalties (ny_date, post_idea_id, penalty)
     VALUES ($1::date, $2::uuid, $3)
     ON CONFLICT (ny_date, post_idea_id) DO UPDATE
       SET penalty = GREATEST(reels.copy_day_penalties.penalty, EXCLUDED.penalty)`,
    [nyDate, postIdeaId, penalty],
  );
  await rerankSlate(slateId, nyDate);
}

/** The idea that filled the slot keeps its original score in the list. */
export async function clearDayPenalty(slateId: string, nyDate: string, postIdeaId: string): Promise<void> {
  await dbQuery(
    `DELETE FROM reels.copy_day_penalties WHERE ny_date = $1::date AND post_idea_id = $2::uuid`,
    [nyDate, postIdeaId],
  );
  await rerankSlate(slateId, nyDate);
}

export async function loadSlotIdeas(slateId: string): Promise<SlotIdea[]> {
  const { rows } = await dbQuery<{
    post_idea_id: string;
    net: number;
    bucket_score: number | null;
    psychology: number | null;
    confidence: number | null;
    last_joined: string;
  }>(
    `SELECT s.post_idea_id::text, s.net, s.bucket_score, s.psychology, s.confidence, i.last_joined
       FROM reels.idea_scores s
       JOIN reels.post_ideas i ON i.id = s.post_idea_id
      WHERE s.slate_id = $1::uuid
        AND s.net IS NOT NULL
        AND s.chosen_bucket IS NOT NULL
        AND s.chosen_framework IS NOT NULL`,
    [slateId],
  );
  return rows.map((row) => ({
    id: row.post_idea_id,
    net: Number(row.net),
    bucketScore: row.bucket_score ?? 0,
    psychologyScore: row.psychology ?? 0,
    lastJoinedMs: new Date(row.last_joined).getTime(),
    confidence: row.confidence ?? 0,
  }));
}

/** Rank by net minus today's penalty. Ideas with no net are left alone. */
export async function rerankSlate(slateId: string, nyDate: string): Promise<void> {
  const ideas = await loadSlotIdeas(slateId);
  const penalties = await loadDayPenalties(nyDate);
  const ordered = orderedForSlots(ideas, (id) => penalties.get(id) ?? 0);
  await dbTransaction(async (client) => {
    for (let index = 0; index < ordered.length; index += 1) {
      await client.query(
        `UPDATE reels.idea_scores SET rank = $3 WHERE slate_id = $1::uuid AND post_idea_id = $2::uuid`,
        [slateId, ordered[index].id, index + 1],
      );
    }
  });
}

/** The ideas that filled today's reels, including locks. Everyone else is unselected. */
export async function selectFilledIdeas(slateId: string, postIdeaIds: readonly string[]): Promise<void> {
  await dbQuery(
    `UPDATE reels.idea_scores
        SET selected = post_idea_id = ANY($2::uuid[])
      WHERE slate_id = $1::uuid`,
    [slateId, postIdeaIds],
  );
}
