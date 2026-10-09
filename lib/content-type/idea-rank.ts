import { dbQuery } from '@/lib/db';
import { nyDateOf } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * Promote / Demote (Lucas, 2026-10-09): a person's move on one type's idea
 * ranking for today, recorded in social_hub.idea_adjustments and applied in
 * order by lib/social-hub/views/day-rank.ts. Promote puts the idea at #1;
 * Demote moves it below the idea right under it. Moves expire with the day.
 */

const VERTICALS: readonly Vertical[] = ['reels', 'carousels', 'explainers', 'stories'];
/** A hub idea id: `<vertical>:<kind>:<ref>`, refs as the adapters make them. */
const IDEA_ID = /^(reels|carousels|explainers|stories):[A-Za-z_]+:[^\s]{1,2000}$/;

export type RankMove = { vertical: Vertical; ideaId: string; kind: 'promote' | 'demote' };

export function parseRankMove(body: unknown): RankMove {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!VERTICALS.includes(b.vertical as Vertical)) throw new Error('Unknown content type.');
  if (b.kind !== 'promote' && b.kind !== 'demote') throw new Error('kind must be promote or demote.');
  if (typeof b.ideaId !== 'string' || !IDEA_ID.test(b.ideaId) || !b.ideaId.startsWith(`${b.vertical}:`)) throw new Error('Unknown idea.');
  return { vertical: b.vertical as Vertical, ideaId: b.ideaId, kind: b.kind };
}

export async function recordRankMove(move: RankMove, by: string, now = new Date()): Promise<{ nyDate: string }> {
  const nyDate = nyDateOf(now)!;
  await dbQuery(
    `INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_by) VALUES ($1, $2, $3::date, $4, $5)`,
    [move.vertical, move.ideaId, nyDate, move.kind, by],
  );
  return { nyDate };
}
