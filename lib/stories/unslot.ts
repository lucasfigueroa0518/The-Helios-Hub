/**
 * Back to Made for Stories sets (settings standard D17, D18; lib/content-type/unslot.ts).
 *
 * stories.sets is the source of truth and the spine its projection (lib/stories/spine.ts: the item's native_ref is the
 * set id, format 'story'), so the worker reads and writes both:
 *  - unslottedSetIds: approved sets whose spine slot was cancelled for an unslot reason ('paused', 'slot-passed'), or
 *    that were approved while their type was Paused (holdApprovedSet, D18), and that hold no live slot. The worker's
 *    step 3 never books them again (D18): they post only after a person places them in a slot while the type is Live.
 *  - returnPassedSets: a scheduled set whose minute passed while its type is not Live goes back to `approved` with no
 *    publish_at, and its spine slot is cancelled with reason 'slot-passed', in one statement (as unslotType does for a
 *    paused Stories type). The publisher's sweep (scripts/publisher_worker.ts) does not cover Stories sets, which the
 *    Stories worker publishes itself.
 * Nothing is deleted and the approval is kept.
 */
import { holdApprovedWhilePaused, unslottedSql } from '@/lib/content-type/unslot';
import { isStoryVertical } from '@/lib/social-hub/story-types';
import type { UnslotReason } from '@/lib/content-type/state';
import type { Queryable } from '@/lib/stories/db';
import type { Series } from '@/lib/stories/render/types';

/** The sets of `ids` that went back to Made (D18). A database without the spine reads as none. */
export async function unslottedSetIds(db: Queryable, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  try {
    const { rows } = await db.query<{ id: string }>(
      `SELECT ci.native_ref AS id FROM social_hub.content_items ci
        WHERE ci.format = 'story' AND ci.native_ref = ANY($1::text[]) AND ${unslottedSql('ci.id')}`,
      [[...ids]],
    );
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

/**
 * Scheduled sets of `series` (types that are not Live) whose minute is at or before `now`: back to approved with no
 * minute, their spine slots cancelled 'slot-passed' (D17). Returns the set ids moved.
 */
export async function returnPassedSets(db: Queryable, series: readonly Series[], now: Date): Promise<string[]> {
  if (!series.length) return [];
  const reason: UnslotReason = 'slot-passed';
  const { rows } = await db.query<{ id: string }>(
    `WITH sets AS (
       UPDATE stories.sets SET status = 'approved', publish_at = NULL, updated_at = now()
        WHERE series = ANY($2::text[]) AND status = 'scheduled' AND publish_at <= $3::timestamptz
        RETURNING id::text AS id
     ), slots AS (
       UPDATE social_hub.schedule s SET status = 'cancelled', error = $1
         FROM social_hub.content_items ci
        WHERE ci.id = s.content_item_id AND ci.format = 'story' AND ci.native_ref IN (SELECT id FROM sets) AND s.status = 'scheduled'
        RETURNING s.id
     )
     SELECT id FROM sets`,
    [reason, [...series], now.toISOString()],
  );
  return rows.map((r) => r.id);
}

/**
 * A set approved while its type is Paused (D18, 2026-11-20): held out of the worker's step 3, so once the type is in
 * Approval or Live it goes into a slot only when a person places it. The marker rides on the set's spine item
 * (projectSet made it on approve). Returns whether a marker was written.
 */
export async function holdApprovedSet(db: Queryable, setId: string, now = new Date()): Promise<boolean> {
  const { rows } = await db.query<{ id: string; vertical: string }>(
    `SELECT id::text AS id, vertical FROM social_hub.content_items WHERE format = 'story' AND native_ref = $1`,
    [setId],
  );
  const item = rows[0];
  if (!item || !isStoryVertical(item.vertical)) return false;
  return holdApprovedWhilePaused((text, params) => db.query(text, params), { vertical: item.vertical, itemId: item.id, now });
}
