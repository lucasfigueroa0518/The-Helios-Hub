import type { Queryable } from '@/lib/explainers/db';
import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import { JEV_USD_PER_MTOK } from '@/lib/reels/config';

import { pooledPitches, rankScore } from './pool';
import { DRAMA_SET, scoreDrama } from './scores';

/**
 * MD-82: the pitch gate. The pitches already pooled were scored before the drama set asked for an
 * opposition with agency and a bounded episode; this re-scores each one with the current set (one Jev call,
 * priced into the ledger by the runner like any drama score). A pitch now under the drama bar leaves the
 * pool as `rejected`, with what would revive it; the rest keep their place with a fresh rank.
 * `scripts/reel_ai_drama_rescore_pool.ts` runs it (only with --yes).
 */

/** Input tokens per drama call (the pitch state plus the question set), a generous estimate. */
export const EST_DRAMA_TOKENS = 4_000;

export function estimateRescore(pitches: number): number {
  return (pitches * EST_DRAMA_TOKENS * JEV_USD_PER_MTOK) / 1_000_000;
}

export const REVIVE_GATE = 'new reporting shows a named opponent acting on a recorded motive, inside one bounded episode';

export type Rescored = { id: string; title: string; before: number | null; after: number; status: 'pooled' | 'rejected'; cap: string | null };

export async function rescorePool(db: Queryable, jev: DramaJevRunner, settings: ReelAiDramaSettings, now: Date): Promise<{ rescored: Rescored[]; errors: string[] }> {
  const rescored: Rescored[] = [];
  const errors: string[] = [];
  for (const row of await pooledPitches(db)) {
    try {
      const drama = await scoreDrama(jev, { id: row.id, pitch: row.pitch });
      const under = drama.score < settings.drama_bar;
      const rank = under ? 0 : rankScore({ ...row, drama, drama_score: drama.score }, settings, now);
      await db.query(
        `UPDATE reel_ai_drama.pitches SET drama = $2::jsonb, drama_score = $3, rank_score = $4, status = $5, reject_reason = $6, revive_when = $7, updated_at = $8 WHERE id = $1`,
        [
          row.id,
          JSON.stringify(drama),
          drama.score,
          rank,
          under ? 'rejected' : 'pooled',
          under ? `drama ${drama.score} under the bar ${settings.drama_bar} when re-scored with ${DRAMA_SET.id} (MD-82)${drama.notes.cap ? `: ${drama.notes.cap}` : ''}` : row.reject_reason,
          under ? REVIVE_GATE : row.revive_when,
          now.toISOString(),
        ],
      );
      rescored.push({ id: row.id, title: row.title, before: row.drama_score, after: drama.score, status: under ? 'rejected' : 'pooled', cap: drama.notes.cap ?? null });
    } catch (error) {
      errors.push(`${row.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { rescored, errors };
}
