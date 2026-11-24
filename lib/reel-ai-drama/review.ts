import type { Queryable } from '@/lib/explainers/db';
import { isUuid, syncDramaApproval } from '@/lib/reel-ai-drama/publish/items';

/** The review verdict on a finished reel (mirrors explainers.feedback). One row per job; the spine's approval mirrors it. */

export type DramaReviewTag = 'hook' | 'story' | 'accuracy' | 'pacing' | 'visuals' | 'voice' | 'captions' | 'sound' | 'brand';
export const DRAMA_REVIEW_TAGS: readonly DramaReviewTag[] = ['hook', 'story', 'accuracy', 'pacing', 'visuals', 'voice', 'captions', 'sound', 'brand'];

export class ReviewError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** The pitch's newest finished job (status 'ok'), or null. */
export async function latestDramaJobId(db: Queryable, pitchId: string): Promise<string | null> {
  if (!isUuid(pitchId)) return null;
  const { rows } = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM reel_ai_drama.jobs WHERE pitch_id = $1 AND status = 'ok' ORDER BY finished_at DESC NULLS LAST, seq DESC LIMIT 1`,
    [pitchId],
  );
  return rows[0]?.id ?? null;
}

export async function dramaVerdictOf(db: Queryable, jobId: string): Promise<'approved' | 'rejected' | null> {
  if (!isUuid(jobId)) return null;
  const { rows } = await db.query<{ verdict: string }>(`SELECT verdict FROM reel_ai_drama.feedback WHERE job_id = $1`, [jobId]);
  const v = rows[0]?.verdict;
  return v === 'approved' || v === 'rejected' ? v : null;
}

/**
 * Record a verdict, then mirror it onto the spine. Without a review the earlier tags and note are kept.
 * An unknown tag, or a job that isn't there, is an Error with status 400 / 404.
 */
export async function setDramaVerdict(
  db: Queryable,
  jobId: string,
  verdict: 'approved' | 'rejected',
  by: string | null,
  review?: { tags?: readonly string[]; note?: string | null },
): Promise<void> {
  if (verdict !== 'approved' && verdict !== 'rejected') throw new ReviewError(`Unknown verdict ${String(verdict)}.`);
  const tags = review?.tags ? [...new Set(review.tags)] : null;
  const unknown = tags?.filter((t) => !(DRAMA_REVIEW_TAGS as readonly string[]).includes(t)) ?? [];
  if (unknown.length) throw new ReviewError(`Unknown review tag${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`);
  if (!isUuid(jobId)) throw new ReviewError('That reel is gone.', 404);
  const { rows } = await db.query(`SELECT 1 FROM reel_ai_drama.jobs WHERE id = $1`, [jobId]);
  if (!rows.length) throw new ReviewError('That reel is gone.', 404);
  const hasReview = review !== undefined;
  const note = review?.note === undefined ? null : review.note?.trim() || null;
  await db.query(
    `INSERT INTO reel_ai_drama.feedback (job_id, verdict, tags, note, created_by)
     VALUES ($1, $2, COALESCE($3::text[], ARRAY[]::text[]), $4, $5)
     ON CONFLICT (job_id) DO UPDATE SET
       verdict = EXCLUDED.verdict,
       tags = CASE WHEN $6::boolean AND $3::text[] IS NOT NULL THEN EXCLUDED.tags ELSE reel_ai_drama.feedback.tags END,
       note = CASE WHEN $6::boolean AND $7::boolean THEN EXCLUDED.note ELSE reel_ai_drama.feedback.note END,
       created_by = EXCLUDED.created_by,
       updated_at = now()`,
    [jobId, verdict, tags, note, by, hasReview, review?.note !== undefined],
  );
  await syncDramaApproval(db, jobId, 'user');
}
