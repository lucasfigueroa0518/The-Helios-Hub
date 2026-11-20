/**
 * Back to Made (settings standard D17, D18; planning/settings-standard/CONTRACT.md §4.5).
 *
 * A paused type holds no slots: pausing cancels the type's future scheduled slots on the lifecycle spine
 * (social_hub.schedule) with reason `paused`. A slot that passes without posting is cancelled the same way with
 * reason `slot-passed` (the publisher's sweep, scripts/publisher_worker.ts). Nothing is deleted and the approval is
 * left alone, so the post stays approved; it is never re-slotted automatically and posts only after a person places
 * it in a slot while the type is Live (D18).
 *
 * The cancel is the spine's existing one (`status = 'cancelled'`, the reason in `error`), as deleteItem,
 * rejectItemAndSlot, releaseDueFor and unscheduleItem already write it. No new status or column. The reason is
 * stored as the bare word so schedulers can match it (`unslottedSql`); it has no "approv" in it, so the adapters'
 * cancelNote shows it as written instead of "Not approved before its slot".
 *
 * How the Made tab shows an unslotted approved post (checked by reading the code, not a live run):
 *  - Each adapter turns a cancelled spine row into a candidate post with status `cancelled`, its `generatedAt`, and
 *    `approval.approvedAt` from COALESCE(schedule.approved_at, approvals.decided_at)
 *    (lib/social-hub/queries/spine.ts:80, lib/social-hub/adapters/carousels.ts:202–215). The approvals row is kept.
 *  - foldLifecycle (lib/social-hub/lifecycle.ts) keeps one post per content; with no live slot, the cancelled
 *    candidate (or a `ready` content candidate, where the type has one) is the current state.
 *  - The Made tab (poolMade, lib/content-type/pool-view.ts:360) lists every post made in the last 30 days in any
 *    status; madeRowState (lib/content-type/pool-rules.ts:55) reads `cancelled` with an approval as `ready`, so the
 *    row shows "Ready", not "Needs you". The pool's source (components/content-type/pool/pool-data.ts:33) keeps
 *    posts by generatedAt, so a cancelled one is still in it.
 *  Caveat for the UI owner: whenText falls back to "For <old day>" for a cancelled post that kept its nyDate.
 *
 * Stories types: stories.sets is the source of truth and the spine is its projection (lib/stories/spine.ts), so a
 * paused Stories type's scheduled sets go back to `approved` with no minute, in the same statement that cancels
 * their spine slots. Pure plumbing over a query function, so tests can stub it.
 */
import type { UnslotReason } from '@/lib/content-type/state';
import { isStoryVertical, SERIES_OF_VERTICAL, STORY_VERTICALS } from '@/lib/social-hub/story-types';
import type { Vertical } from '@/lib/social-hub/types';

export type UnslotQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Every reason a slot goes back to Made (D17). Stored in social_hub.schedule.error as written. */
export const UNSLOT_REASONS: readonly UnslotReason[] = ['paused', 'slot-passed'];

/**
 * The WHERE clause for the type's slots on the spine, its parameters starting at `$first`. A Stories-format type
 * matches by its series, as slotOfType does in lib/content-type/posting.ts: the slot id is the series (legacy) or
 * `t<minute>:<series>` (template mode, lib/stories/spine.ts), on any Stories vertical.
 */
export function typeSlotWhere(type: Vertical, first = 1, alias = ''): { sql: string; params: unknown[] } {
  const col = (c: string) => (alias ? `${alias}.${c}` : c);
  if (!isStoryVertical(type)) return { sql: `${col('vertical')} = $${first}`, params: [type] };
  const series = SERIES_OF_VERTICAL[type];
  return {
    sql: `${col('vertical')} = ANY($${first}::text[]) AND (${col('slot')} = $${first + 1} OR split_part(${col('slot')}, ':', 2) = $${first + 1})`,
    params: [[...STORY_VERTICALS], series],
  };
}

/** How many of the type's slots are scheduled ahead: what Pause sends back to the Made tab (D17). SELECT only. */
export async function scheduledAhead(query: UnslotQuery, type: Vertical): Promise<number> {
  const where = typeSlotWhere(type);
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM social_hub.schedule WHERE status = 'scheduled' AND publish_at > now() AND ${where.sql}`,
    where.params,
  );
  const n = Number(rows[0]?.n ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Take the type's future scheduled slots off the calendar (D17): status `cancelled`, `error` = the reason.
 * Approvals are untouched (D18). A slot already posting is not `scheduled`, so it is never touched.
 * Returns how many spine slots were cancelled (and, for a Stories type, how many sets went back to approved).
 */
export async function unslotType(query: UnslotQuery, type: Vertical, reason: UnslotReason = 'paused'): Promise<{ slots: number; sets: number }> {
  if (!isStoryVertical(type)) {
    const where = typeSlotWhere(type, 2);
    const { rows } = await query(
      `UPDATE social_hub.schedule SET status = 'cancelled', error = $1
        WHERE status = 'scheduled' AND publish_at > now() AND ${where.sql}
        RETURNING id`,
      [reason, ...where.params],
    );
    return { slots: rows.length, sets: 0 };
  }
  // One statement, so the set and its projection can't disagree: both writes run to completion (Postgres runs
  // data-modifying CTEs once, read or not). The set keeps approved_at; with no publish_at, projectSet leaves the
  // cancelled slot as it is.
  const where = typeSlotWhere(type, 3);
  const { rows } = await query(
    `WITH sets AS (
       UPDATE stories.sets SET status = 'approved', publish_at = NULL, updated_at = now()
        WHERE series = $2 AND status = 'scheduled' AND publish_at > now()
        RETURNING id
     ), slots AS (
       UPDATE social_hub.schedule SET status = 'cancelled', error = $1
        WHERE status = 'scheduled' AND publish_at > now() AND ${where.sql}
        RETURNING id
     )
     SELECT (SELECT count(*) FROM sets)::int AS sets, (SELECT count(*) FROM slots)::int AS slots`,
    [reason, SERIES_OF_VERTICAL[type], ...where.params],
  );
  return { slots: Number(rows[0]?.slots ?? 0), sets: Number(rows[0]?.sets ?? 0) };
}

/**
 * The publisher's sweep (D17): due slots of types that are not Live are cancelled with reason `slot-passed`, so
 * they never post late when the type goes Live again. `verticals` are the not-Live types the caller drives.
 */
export async function cancelPassedSlots(query: UnslotQuery, verticals: readonly Vertical[]): Promise<Array<{ id: string; vertical: Vertical }>> {
  if (!verticals.length) return [];
  const { rows } = await query(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $1
      WHERE status = 'scheduled' AND publish_at <= now() AND vertical = ANY($2::text[])
      RETURNING id::text AS id, vertical`,
    ['slot-passed' satisfies UnslotReason, [...verticals]],
  );
  return rows as Array<{ id: string; vertical: Vertical }>;
}

/**
 * SQL that is true when the content item went back to Made (D18): it has a slot cancelled for an unslot reason and
 * no slot that is waiting, posting or posted. Schedulers that book approved posts on their own add
 * `AND NOT (<this>)` so they never re-slot one. `itemId` is the SQL expression for the item's id.
 */
export function unslottedSql(itemId: string): string {
  const reasons = UNSLOT_REASONS.map((r) => `'${r}'`).join(', ');
  return `(EXISTS (SELECT 1 FROM social_hub.schedule u WHERE u.content_item_id = ${itemId} AND u.status = 'cancelled' AND u.error IN (${reasons}))
    AND NOT EXISTS (SELECT 1 FROM social_hub.schedule w WHERE w.content_item_id = ${itemId} AND w.status IN ('scheduled', 'publishing', 'published')))`;
}
