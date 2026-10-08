import type { Query } from '@/lib/social/store/pg';

import { SOCIAL_STALE_RUN_MINUTES } from './config';

/**
 * social.runs as a queue, like reels.runs: a run is inserted `requested`
 * (by the 3:00 AM clock or a manual request), the worker claims it, and the
 * daily script (scripts/social_daily.ts --run-id) finishes it.
 */

export type RunTrigger = 'scheduled' | 'manual';

/** Queue a run. Null when one is already queued (the single-requested index). */
export async function requestRun(query: Query, trigger: RunTrigger, opts: { capUsd: number; hookPass: boolean }): Promise<string | null> {
  const { rows } = await query(
    `INSERT INTO social.runs (kind, trigger, status, hook_pass, cap_usd)
     VALUES ('daily', $1, 'requested', $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [trigger, opts.hookPass, opts.capUsd],
  );
  return (rows[0]?.id as string | undefined) ?? null;
}

/** A run that has been `running` longer than any real run is marked failed. */
export async function releaseStaleRuns(query: Query, now = new Date()): Promise<number> {
  const { rows } = await query(
    `UPDATE social.runs
        SET status = 'failed', finished_at = $1::timestamptz,
            error = coalesce(error, 'The worker stopped while this run was in progress.')
      WHERE status = 'running' AND started_at < $1::timestamptz - make_interval(mins => $2)
      RETURNING id`,
    [now.toISOString(), SOCIAL_STALE_RUN_MINUTES],
  );
  return rows.length;
}

/** Claim the queued run when nothing else is running. */
export async function claimRun(query: Query, now = new Date()): Promise<{ id: string; capUsd: number; hookPass: boolean } | null> {
  await releaseStaleRuns(query, now);
  try {
    const { rows } = await query(
      `UPDATE social.runs SET status = 'running', started_at = $1::timestamptz
        WHERE id = (
          SELECT id FROM social.runs
           WHERE status = 'requested'
             AND NOT EXISTS (SELECT 1 FROM social.runs r WHERE r.status = 'running')
           ORDER BY requested_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1)
        RETURNING id, cap_usd, hook_pass`,
      [now.toISOString()],
    );
    const r = rows[0];
    return r ? { id: r.id as string, capUsd: Number(r.cap_usd), hookPass: r.hook_pass as boolean } : null;
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return null;
    throw error;
  }
}

/** The worker's last word on a run whose script died before finishing it. */
export async function failRun(query: Query, id: string, error: string, now = new Date()): Promise<void> {
  await query(
    `UPDATE social.runs SET status = 'failed', finished_at = $2::timestamptz, error = $3
      WHERE id = $1 AND status = 'running'`,
    [id, now.toISOString(), error.slice(0, 2000)],
  );
}

/** The run's shipped posts that have no slide images in Storage yet. */
export async function postsMissingSlides(query: Query, runId: string): Promise<Array<{ id: string; slug: string }>> {
  const { rows } = await query(
    `SELECT id, slug FROM social.posts WHERE run_id = $1 AND slide_objects IS NULL ORDER BY slug`,
    [runId],
  );
  return rows.map((r) => ({ id: r.id as string, slug: r.slug as string }));
}

export async function saveSlideObjects(query: Query, postId: string, objects: string[]): Promise<void> {
  await query(`UPDATE social.posts SET slide_objects = $2::jsonb WHERE id = $1`, [postId, JSON.stringify(objects)]);
}
