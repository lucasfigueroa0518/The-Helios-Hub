import type { Vertical } from '@/lib/social-hub/types';
import { NO_MOVES, tonightMoves, type IdeaAdjustment, type TonightMoves } from '@/lib/social-hub/views/moves';

/**
 * The night workers' side of the shared queue (spec 2026-10-14 §6): read a
 * type's active moves, mark a promote used once the night made its idea, and
 * record why it couldn't. Every call degrades: a failed read is no moves (the
 * night runs as it did before the shared queue) and a failed write returns
 * false. Reading works without the skip columns. Light: no Next, no Jev, no
 * database client of its own; callers pass their query function.
 *
 * A worker that skips a promote re-picks in the same run: it keeps the moves
 * from readMoves, marks the skip in memory with withSkip, and asks
 * tonightMoves (views/moves) again.
 */

export type MovesQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

type Row = {
  id: string; vertical: Vertical; idea_id: string; ny_date: string; kind: 'promote' | 'demote'; created_at: string;
  skip_reason?: string | null; skipped_at?: string | null;
};

const COLS = `id::text AS id, vertical, idea_id, ny_date::text AS ny_date, kind,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at`;
const SKIP_COLS = `, skip_reason, to_char(skipped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS skipped_at`;

/** A type's active moves (not used yet, any day), oldest first, with any recorded skip. Failure: none. */
export async function readMoves(q: MovesQuery, vertical: Vertical): Promise<IdeaAdjustment[]> {
  const select = (cols: string) =>
    q(`SELECT ${cols} FROM social_hub.idea_adjustments WHERE vertical = $1 AND consumed_at IS NULL ORDER BY created_at, id`, [vertical]);
  let rows: Row[];
  try {
    rows = (await select(COLS + SKIP_COLS)).rows;
  } catch {
    try {
      rows = (await select(COLS)).rows; // the skip columns are not applied yet
    } catch {
      return [];
    }
  }
  return rows.map((r) => ({
    id: r.id, vertical: r.vertical, ideaId: r.idea_id, nyDate: String(r.ny_date).slice(0, 10), kind: r.kind, createdAt: r.created_at,
    skipReason: r.skip_reason ?? null, skippedAt: r.skipped_at ?? null,
  }));
}

/** A type's tonight: the one promote it makes first (a skipped promote steps aside) and the ideas that sink. */
export async function readTonightMoves(q: MovesQuery, vertical: Vertical): Promise<TonightMoves> {
  const moves = await readMoves(q, vertical);
  return moves.length ? tonightMoves(moves, vertical) : NO_MOVES;
}

/** The moves with a skip marked on an idea's promote, in memory, so a re-pick in the same run steps past it. */
export function withSkip(moves: readonly IdeaAdjustment[], ideaId: string, reason: string): IdeaAdjustment[] {
  return moves.map((m) => (m.ideaId === ideaId && m.kind === 'promote' ? { ...m, skipReason: reason, skippedAt: new Date().toISOString() } : m));
}

/** The night made the idea: every active move on it is used up (as the hub's consumeMoves does). */
export async function markPromoteUsed(q: MovesQuery, vertical: Vertical, ideaId: string): Promise<boolean> {
  try {
    await q(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE vertical = $1 AND idea_id = $2 AND consumed_at IS NULL`, [vertical, ideaId]);
    return true;
  } catch {
    return false;
  }
}

/** The night couldn't make the idea: why, on its active promote. The move stays active. */
export async function recordPromoteSkip(q: MovesQuery, vertical: Vertical, ideaId: string, reason: string): Promise<boolean> {
  try {
    await q(
      `UPDATE social_hub.idea_adjustments SET skip_reason = $3, skipped_at = now()
        WHERE vertical = $1 AND idea_id = $2 AND kind = 'promote' AND consumed_at IS NULL`,
      [vertical, ideaId, reason.slice(0, 500)],
    );
    return true;
  } catch {
    return false;
  }
}
