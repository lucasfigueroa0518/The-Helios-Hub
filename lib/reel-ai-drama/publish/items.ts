import type { Queryable } from '@/lib/explainers/db';
import { approveItem, clearDecision, ensureContentItem, rejectItem, type ApprovalVia, type SpineQuery } from '@/lib/social-hub/spine';

/**
 * A Reel AI Drama reel on the lifecycle spine (D36), as explainers: the content item is the job
 * (`reel_ai_drama.jobs`, native_ref), its idea the pitch (idea_ref). The review verdict lives in
 * `reel_ai_drama.feedback`; the spine's approval mirrors it.
 */
export const spineOf = (db: Queryable): SpineQuery => (text, params) => db.query(text, params) as ReturnType<SpineQuery>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export async function dramaItemId(db: Queryable, jobId: string): Promise<string | null> {
  if (!isUuid(jobId)) return null;
  // native_ref is the database's own id text, never the caller's spelling of it (D41).
  const { rows } = await db.query<{ id: string; pitch_id: string | null }>(
    `SELECT id::text AS id, pitch_id::text AS pitch_id FROM reel_ai_drama.jobs WHERE id = $1`,
    [jobId],
  );
  if (!rows[0]) return null;
  return ensureContentItem(spineOf(db), { vertical: 'reel_ai_drama', format: 'reel', nativeRef: rows[0].id, ideaRef: rows[0].pitch_id ?? null });
}

/** Copy the reel's verdict onto its item: approved, rejected, or (no verdict) undecided. */
export async function syncDramaApproval(db: Queryable, jobId: string, via: ApprovalVia = 'user'): Promise<void> {
  const itemId = await dramaItemId(db, jobId);
  if (!itemId) return;
  const { rows } = await db.query<{ verdict: string; created_by: string | null }>(`SELECT verdict, created_by FROM reel_ai_drama.feedback WHERE job_id = $1`, [jobId]);
  const spine = spineOf(db);
  if (rows[0]?.verdict === 'approved') await approveItem(spine, itemId, via, rows[0].created_by);
  else if (rows[0]?.verdict === 'rejected') await rejectItem(spine, itemId, rows[0].created_by);
  else await clearDecision(spine, itemId);
}
