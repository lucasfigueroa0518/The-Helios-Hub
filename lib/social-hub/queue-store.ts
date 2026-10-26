import type { Vertical } from '@/lib/social-hub/types';
import type { MovesQuery } from '@/lib/social-hub/moves-store';

/**
 * The write side of the idea pool standard (spec 2026-10-21-idea-pool-standard-design):
 * Pin, Unpin, drag (place), Archive and the expiry of placements, all rows in
 * social_hub.idea_adjustments. Callers pass their query function (the hub's, or a
 * worker's), as moves-store.ts does. Every write is safe to repeat.
 */

/** A placement that no night has used expires after this many days. */
export const PLACEMENT_DAYS = 7;

const nyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const ACTIVE_PIN = `kind IN ('pin', 'promote') AND consumed_at IS NULL`;

/** Pin an idea to the top. Pinning a pinned idea changes nothing. A pin outranks any placement, so it is used up. */
export async function pinIdea(q: MovesQuery, vertical: Vertical, ideaId: string, by: string | null): Promise<void> {
  const { rows } = await q(`SELECT 1 FROM social_hub.idea_adjustments WHERE vertical = $1 AND idea_id = $2 AND ${ACTIVE_PIN}`, [vertical, ideaId]);
  if (rows.length) return;
  await q(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE vertical = $1 AND idea_id = $2 AND kind = 'place' AND consumed_at IS NULL`, [vertical, ideaId]);
  await q(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_by) VALUES ($1, $2, $3::date, 'pin', $4)`, [vertical, ideaId, nyToday(), by]);
}

/** Take an idea off the pins. */
export async function unpinIdea(q: MovesQuery, vertical: Vertical, ideaId: string): Promise<void> {
  await q(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE vertical = $1 AND idea_id = $2 AND ${ACTIVE_PIN}`, [vertical, ideaId]);
}

/** Put the pins in this order: the listed ideas' pin rows are rewritten oldest first. Ideas not currently pinned are skipped. */
export async function reorderPins(q: MovesQuery, vertical: Vertical, order: readonly string[], by: string | null): Promise<void> {
  // One statement, so a dropped connection never leaves pins taken off and not put back. The ideas that are pinned now, in the
  // order asked; a millisecond apart so their order is kept.
  await q(
    `WITH gone AS (
       UPDATE social_hub.idea_adjustments SET consumed_at = now()
        WHERE vertical = $1 AND idea_id = ANY($2::text[]) AND ${ACTIVE_PIN}
        RETURNING idea_id)
     INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_by, created_at)
     SELECT $1, t.id, $3::date, 'pin', $4, clock_timestamp() + t.ord * interval '1 millisecond'
       FROM unnest($2::text[]) WITH ORDINALITY AS t(id, ord)
      WHERE t.id IN (SELECT idea_id FROM gone)`,
    [vertical, [...order], nyToday(), by],
  );
}

/** Record a drag: the idea sorts at `sortKey` until its placement is used. Replaces its earlier placement. */
export async function placeIdea(q: MovesQuery, vertical: Vertical, ideaId: string, sortKey: number, by: string | null): Promise<void> {
  await unpinIdea(q, vertical, ideaId);
  await q(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE vertical = $1 AND idea_id = $2 AND kind = 'place' AND consumed_at IS NULL`, [vertical, ideaId]);
  await q(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, sort_key, created_by) VALUES ($1, $2, $3::date, 'place', $4, $5)`, [vertical, ideaId, nyToday(), sortKey, by]);
}

/** Archive an idea for good: a permanent row, so a refill that finds the idea again still hides it. Archiving twice writes once. */
export async function archiveIdea(q: MovesQuery, vertical: Vertical, ideaId: string, by: string | null): Promise<void> {
  const { rows } = await q(`SELECT 1 FROM social_hub.idea_adjustments WHERE vertical = $1 AND idea_id = $2 AND kind = 'archive'`, [vertical, ideaId]);
  if (rows.length) return;
  await unpinIdea(q, vertical, ideaId);
  await q(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE vertical = $1 AND idea_id = $2 AND kind = 'place' AND consumed_at IS NULL`, [vertical, ideaId]);
  await q(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_by) VALUES ($1, $2, $3::date, 'archive', $4)`, [vertical, ideaId, nyToday(), by]);
}

/**
 * A type's night ran with auto-render on and made its picks: every placement is
 * used up, and the ideas compete by score again. A failed run, or auto-render off,
 * must not call this, so a hand move is never undone by a night that did nothing for it.
 * `scope` limits it to a Stories series (idea ids start with `stories:pool:<series>:`).
 */
export async function finishPlacements(q: MovesQuery, vertical: Vertical, scope?: string, readAt?: Date): Promise<void> {
  // `readAt`: when the worker read its moves. A drag made after that (3:05 AM, during the run) was never seen, so it stays.
  await q(
    `UPDATE social_hub.idea_adjustments SET consumed_at = now()
      WHERE vertical = $1 AND kind = 'place' AND consumed_at IS NULL AND ($2::text IS NULL OR idea_id LIKE $2::text || '%')
        AND ($3::timestamptz IS NULL OR created_at <= $3::timestamptz)`,
    [vertical, scope ?? null, readAt?.toISOString() ?? null],
  );
}

/** Placements nobody used in a week expire. Safe to run any time. */
export async function expireOldPlacements(q: MovesQuery, vertical: Vertical, days = PLACEMENT_DAYS): Promise<void> {
  await q(
    `UPDATE social_hub.idea_adjustments SET consumed_at = now()
      WHERE vertical = $1 AND kind = 'place' AND consumed_at IS NULL AND created_at < now() - ($2::int * interval '1 day')`,
    [vertical, days],
  );
}

/**
 * What a night worker calls when it has run with auto-render on and made its picks: placements are used up, and any a
 * week old are dropped. It never throws (no moves table, a dropped connection): a hand move is cleaned up on a later
 * night, never at the cost of this one.
 */
export async function finishNightPlacements(q: MovesQuery, vertical: Vertical, scope?: string, readAt?: Date): Promise<void> {
  try {
    await finishPlacements(q, vertical, scope, readAt);
    await expireOldPlacements(q, vertical);
  } catch {
    // Degrade: the night's own result stands.
  }
}
