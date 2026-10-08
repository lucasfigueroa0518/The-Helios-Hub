import type { Queryable } from '@/lib/explainers/db';
import { approveItem, clearDecision, ensureContentItem, rejectItem, type ApprovalVia, type SpineQuery } from '@/lib/social-hub/spine';

/**
 * An explainer on the lifecycle spine (D36): the content item is the render
 * (`explainers.jobs`, native_ref), its post idea the topic (idea_ref).
 * The review verdict stays in `explainers.feedback` with its tags; the
 * spine's approval mirrors it, so publishing reads one place for every type.
 */
export const spineOf = (db: Queryable): SpineQuery => (text, params) => db.query(text, params) as ReturnType<SpineQuery>;

export async function explainerItemId(db: Queryable, jobId: string): Promise<string | null> {
  const { rows } = await db.query<{ topic_id: string | null }>(`SELECT topic_id FROM explainers.jobs WHERE id = $1`, [jobId]);
  if (!rows[0]) return null;
  return ensureContentItem(spineOf(db), { vertical: 'explainers', format: 'reel', nativeRef: jobId, ideaRef: rows[0].topic_id ?? null });
}

/** Copy the render's verdict onto its item: approved, rejected, or (no verdict) undecided. */
export async function syncExplainerApproval(db: Queryable, jobId: string, via: ApprovalVia = 'user'): Promise<void> {
  const itemId = await explainerItemId(db, jobId);
  if (!itemId) return;
  const { rows } = await db.query<{ verdict: string; created_by: string | null }>(`SELECT verdict, created_by FROM explainers.feedback WHERE job_id = $1`, [jobId]);
  const spine = spineOf(db);
  if (rows[0]?.verdict === 'approved') await approveItem(spine, itemId, via, rows[0].created_by);
  else if (rows[0]?.verdict === 'rejected') await rejectItem(spine, itemId, rows[0].created_by);
  else await clearDecision(spine, itemId);
}
