import type { PoolClient } from 'pg';

import { dbTransaction } from '@/lib/db';
import { chooseRankedClaim, type RankedClaim, type SlateSongGate } from '@/lib/reels/pipeline/order';

/**
 * D-199. Claim the best ready idea, not the job that was queued first.
 * One running job per table still holds. A worse idea is left queued while a
 * better selected idea on the same slate is still being made without a song
 * for that slate's calendar day.
 */

const RANKED_JOB_TABLE = {
  copy_jobs: 'reels.copy_jobs',
  visual_jobs: 'reels.visual_jobs',
  video_jobs: 'reels.video_jobs',
  song_picks: 'reels.song_picks',
} as const;

export type RankedJobTable = keyof typeof RANKED_JOB_TABLE;

type CandidateRow = {
  id: string;
  slate_id: string | null;
  rank: number | null;
  requested_at: Date | string;
};

type GateRow = {
  slate_id: string;
  rank: number | null;
  selected: boolean;
  has_song_for_assignment: boolean;
  still_in_pipeline: boolean;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

function asInstant(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function toClaim(row: CandidateRow): RankedClaim {
  return {
    id: row.id,
    slateId: row.slate_id,
    rank: row.rank == null ? null : Number(row.rank),
    requestedAt: asInstant(row.requested_at),
  };
}

async function loadGates(client: PoolClient, slateIds: string[]): Promise<SlateSongGate[]> {
  if (slateIds.length === 0) return [];
  const { rows } = await client.query<GateRow>(
    `SELECT s.slate_id::text,
            s.rank,
            s.selected,
            EXISTS (
              SELECT 1
                FROM reels.song_picks done
                JOIN reels.video_jobs dv ON dv.id = done.video_job_id
                JOIN reels.score_slates assigned ON assigned.id = dv.slate_id
                JOIN reels.score_slates mine ON mine.id = s.slate_id
               WHERE done.post_idea_id = s.post_idea_id
                 AND done.status = 'ok'
                 AND done.picked_audio_id IS NOT NULL
                 AND assigned.ny_date = mine.ny_date
            ) AS has_song_for_assignment,
            (
              EXISTS (
                SELECT 1 FROM reels.finish_requests f
                 WHERE f.post_idea_id = s.post_idea_id
                   AND f.slate_id = s.slate_id
                   AND f.status = 'active'
              )
              OR EXISTS (
                SELECT 1 FROM reels.copy_jobs c
                 WHERE c.post_idea_id = s.post_idea_id
                   AND c.slate_id = s.slate_id
                   AND c.status IN ('requested', 'running')
              )
              OR EXISTS (
                SELECT 1 FROM reels.visual_jobs j
                 WHERE j.post_idea_id = s.post_idea_id
                   AND j.slate_id = s.slate_id
                   AND j.status IN ('requested', 'running')
              )
              OR EXISTS (
                SELECT 1 FROM reels.video_jobs j
                 WHERE j.post_idea_id = s.post_idea_id
                   AND j.slate_id = s.slate_id
                   AND j.status IN ('requested', 'running')
              )
              OR EXISTS (
                SELECT 1 FROM reels.song_picks sp
                JOIN reels.video_jobs v ON v.id = sp.video_job_id
                 WHERE sp.post_idea_id = s.post_idea_id
                   AND v.slate_id = s.slate_id
                   AND sp.status IN ('requested', 'running')
              )
            ) AS still_in_pipeline
       FROM reels.idea_scores s
      WHERE s.slate_id = ANY($1::uuid[])`,
    [slateIds],
  );
  return rows.map((row) => ({
    slateId: row.slate_id,
    rank: row.rank == null ? null : Number(row.rank),
    selected: row.selected,
    hasSongForAssignment: row.has_song_for_assignment,
    stillInPipeline: row.still_in_pipeline,
  }));
}

async function markRunning(client: PoolClient, table: (typeof RANKED_JOB_TABLE)[RankedJobTable], id: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `UPDATE ${table}
        SET status = 'running', started_at = now()
      WHERE id = $1::uuid
        AND status = 'requested'
      RETURNING id::text`,
    [id],
  );
  return rows[0]?.id ?? null;
}

async function chooseAndMark(
  client: PoolClient,
  table: (typeof RANKED_JOB_TABLE)[RankedJobTable],
  rows: CandidateRow[],
): Promise<string | null> {
  if (rows.length === 0) return null;
  const candidates = rows.map(toClaim);
  const slateIds = [...new Set(candidates.flatMap((candidate) => (candidate.slateId ? [candidate.slateId] : [])))];
  const ideas = await loadGates(client, slateIds);
  const id = chooseRankedClaim(candidates, ideas);
  if (!id) return null;
  return markRunning(client, table, id);
}

/** Next copy, frame, or video job. Best selected idea first. */
export async function claimNextRankedJob(table: Exclude<RankedJobTable, 'song_picks'>): Promise<string | null> {
  const qualified = RANKED_JOB_TABLE[table];
  try {
    return await dbTransaction(async (client) => {
      const { rows } = await client.query<CandidateRow>(
        `SELECT j.id::text AS id, j.slate_id::text AS slate_id, s.rank, j.requested_at
           FROM ${qualified} j
           LEFT JOIN reels.idea_scores s
             ON s.post_idea_id = j.post_idea_id AND s.slate_id = j.slate_id
          WHERE j.status = 'requested'
            AND NOT EXISTS (SELECT 1 FROM ${qualified} r WHERE r.status = 'running')
          FOR UPDATE OF j SKIP LOCKED`,
      );
      return chooseAndMark(client, qualified, rows);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** Next song pick. The slate comes from the video, because picks do not store it. */
export async function claimNextSongByRank(): Promise<string | null> {
  const qualified = RANKED_JOB_TABLE.song_picks;
  try {
    return await dbTransaction(async (client) => {
      const { rows } = await client.query<CandidateRow>(
        `SELECT p.id::text AS id, v.slate_id::text AS slate_id, s.rank, p.requested_at
           FROM reels.song_picks p
           JOIN reels.video_jobs v ON v.id = p.video_job_id
           LEFT JOIN reels.idea_scores s
             ON s.post_idea_id = p.post_idea_id AND s.slate_id = v.slate_id
          WHERE p.status = 'requested'
            AND NOT EXISTS (SELECT 1 FROM reels.song_picks r WHERE r.status = 'running')
          FOR UPDATE OF p SKIP LOCKED`,
      );
      return chooseAndMark(client, qualified, rows);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}
