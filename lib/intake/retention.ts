/**
 * Intake retention (Phase 2, Owner A). Items live at least as long as the longest order reads them (the max order
 * lookback plus 2 days, never under 21 days: the Reels readers' window, reels.idea_sources_v). Items of a story that
 * has a `reels.published_status` or `reels.idea_copy` row (the story or one merged into it) are never dropped.
 *
 * Bounded deletes by age, run once after a main run: nothing is scored, nothing iterates the store (Rule 2).
 * Pair decisions, scores of kept stories, runs and cost rows stay.
 */
import { INTAKE_ORDERS } from './orders';
import type { IntakeOrder, IntakeQuery } from './types';

export const MIN_RETENTION_DAYS = 21;

export function retentionDays(orders: readonly Pick<IntakeOrder, 'lookbackDays'>[] = INTAKE_ORDERS): number {
  return Math.max(MIN_RETENTION_DAYS, ...orders.map((o) => o.lookbackDays + 2));
}

export type PruneResult = { cutoff: Date; protectedStories: number; items: number; stories: number };

/** Story ids Reels has published or written copy for, plus the stories they were merged into (followed to the end). */
async function protectedStories(q: IntakeQuery): Promise<string[]> {
  const { rows: present } = await q.query<{ published: string | null; copy: string | null }>(
    `SELECT to_regclass('reels.published_status')::text AS published, to_regclass('reels.idea_copy')::text AS copy`,
  );
  const refs: string[] = [];
  if (present[0]?.published) refs.push(`SELECT post_idea_id AS id FROM reels.published_status`);
  if (present[0]?.copy) refs.push(`SELECT post_idea_id AS id FROM reels.idea_copy`);
  if (refs.length === 0) return [];
  const { rows } = await q.query<{ id: string }>(
    `WITH RECURSIVE ref AS (${refs.join(' UNION ')}),
       up AS (SELECT s.id, s.merged_into FROM intake.stories s JOIN ref ON ref.id = s.id
              UNION
              SELECT s.id, s.merged_into FROM intake.stories s JOIN up ON s.id = up.merged_into)
     SELECT DISTINCT id::text AS id FROM up`,
  );
  return rows.map((r) => r.id);
}

/**
 * Drop items not seen since the cutoff (by any list: the shared `last_seen_at` and Field Notes' own
 * `field_notes_last_seen_at`) whose story (if any) is old too and unprotected, then the old, empty,
 * unprotected stories (and their scores) that no other story points at. Any read error skips the prune.
 */
export async function pruneIntake(q: IntakeQuery, now: Date, days = retentionDays()): Promise<PruneResult> {
  const cutoff = new Date(now.getTime() - Math.max(MIN_RETENTION_DAYS, days) * 86_400_000);
  const keep = await protectedStories(q);
  const { rows: items } = await q.query<{ key: string }>(
    `DELETE FROM intake.items i
      WHERE i.last_seen_at < $1
        AND (i.field_notes_last_seen_at IS NULL OR i.field_notes_last_seen_at < $1)
        AND (i.story_id IS NULL OR (
              NOT (i.story_id = ANY($2::uuid[]))
              AND EXISTS (SELECT 1 FROM intake.stories s WHERE s.id = i.story_id AND s.last_joined_at < $1)
              AND NOT EXISTS (SELECT 1 FROM intake.items o WHERE o.story_id = i.story_id
                                AND (o.last_seen_at >= $1 OR o.field_notes_last_seen_at >= $1))))
      RETURNING i.key`,
    [cutoff, keep],
  );
  const empty = `SELECT s.id FROM intake.stories s
      WHERE s.last_joined_at < $1 AND NOT (s.id = ANY($2::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM intake.items i WHERE i.story_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM intake.stories c WHERE c.merged_into = s.id)`;
  let stories = 0;
  // Merged-away stories first (they point at their target), then the targets they freed; a longer chain finishes on a later night.
  for (let pass = 0; pass < 2; pass += 1) {
    const { rows: ids } = await q.query<{ id: string }>(`SELECT id::text AS id FROM (${empty}) e`, [cutoff, keep]);
    if (ids.length === 0) break;
    const list = ids.map((r) => r.id);
    await q.query(`DELETE FROM intake.scores WHERE story_id = ANY($1::uuid[])`, [list]);
    const { rows: gone } = await q.query<{ id: string }>(`DELETE FROM intake.stories WHERE id = ANY($1::uuid[]) RETURNING id::text AS id`, [list]);
    stories += gone.length;
  }
  return { cutoff, protectedStories: keep.length, items: items.length, stories };
}
