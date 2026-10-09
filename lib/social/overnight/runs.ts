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

/**
 * A claimed run the worker doesn't carry out (daily fill, D54: people already
 * placed the day's quota): `skipped`, with why, and no script, so no spend.
 */
export async function skipRun(query: Query, id: string, note: string, now = new Date()): Promise<void> {
  await query(
    `UPDATE social.runs SET status = 'skipped', finished_at = $2::timestamptz, stop_reason = 'quota-filled', error = $3
      WHERE id = $1 AND status = 'running'`,
    [id, now.toISOString(), note.slice(0, 2000)],
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

// ── One-story reruns (Social Hub Regenerate, D51) ──────────────────────────
// The app inserts a `requested` row in social.rerun_requests; only the worker
// runs it. Claiming one opens a social.runs row (`running`, trigger
// `manual`) that the daily script carries out with --rerun-post, so a rerun
// never overlaps a run, never takes the nightly run's queued place, and its
// spend is recorded and capped like any run's.

export type RerunRequest = { queued: true; id: string } | { queued: false; note: string };

/** A person asks for this carousel's story to be made again (Regenerate). */
export async function requestRerun(query: Query, postId: string, by: string | null): Promise<RerunRequest> {
  const { rows } = await query(
    `SELECT p.id::text AS id, p.story_id, p.origin, p.brief IS NOT NULL AS has_brief,
            EXISTS (SELECT 1 FROM social_hub.publish_attempts t
                      JOIN social_hub.content_items ci ON ci.id = t.content_item_id
                     WHERE ci.vertical = 'carousels' AND ci.native_ref = p.id::text AND t.status = 'published') AS posted,
            EXISTS (SELECT 1 FROM social_hub.publish_attempts t
                      JOIN social_hub.content_items ci ON ci.id = t.content_item_id
                     WHERE ci.vertical = 'carousels' AND ci.native_ref = p.id::text
                       AND t.status IN ('requested', 'creating', 'processing', 'publishing')) AS posting
       FROM social.posts p WHERE p.id = $1`,
    [postId],
  );
  const post = rows[0];
  if (!post) return { queued: false, note: 'The post is gone.' };
  if (post.origin !== 'pipeline') return { queued: false, note: 'Only carousels from the daily run can be regenerated here.' };
  if (!post.story_id || !post.has_brief) return { queued: false, note: 'This carousel has no saved brief to rerun from.' };
  if (post.posted) return { queued: false, note: 'This carousel has already posted.' };
  if (post.posting) return { queued: false, note: 'It is posting right now.' };
  const { rows: queued } = await query(
    `INSERT INTO social.rerun_requests (post_id, story_id, requested_by) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING id`,
    [post.id, post.story_id, by],
  );
  return queued[0] ? { queued: true, id: queued[0].id as string } : { queued: false, note: 'A rerun of this story is already queued.' };
}

/**
 * A rerun whose run has ended is done: `ok` with the post it shipped, or
 * `failed` with why (the run's error, or the set-aside that stopped it). Also
 * closes a request whose run died (releaseStaleRuns fails the run first).
 */
export async function settleReruns(query: Query, now = new Date()): Promise<number> {
  const { rows } = await query(
    `UPDATE social.rerun_requests q
        SET status = CASE WHEN r.status = 'ok' AND jsonb_array_length(coalesce(r.ship_post_ids, '[]'::jsonb)) > 0 THEN 'ok' ELSE 'failed' END,
            finished_at = coalesce(r.finished_at, $1::timestamptz),
            new_post_id = CASE WHEN r.status = 'ok' THEN (r.ship_post_ids->>0)::uuid END,
            error = CASE WHEN r.status = 'ok' AND jsonb_array_length(coalesce(r.ship_post_ids, '[]'::jsonb)) > 0 THEN NULL
                         ELSE coalesce(r.error, 'The rerun shipped no post (' || coalesce(r.stop_reason, r.status) || ').') END
       FROM social.runs r
      WHERE q.run_id = r.id AND q.status = 'running' AND r.status <> 'running'
      RETURNING q.id`,
    [now.toISOString()],
  );
  return rows.length;
}

/**
 * Claim the oldest queued rerun when no run is in flight: open its run
 * (`running`) and mark it `running`, in one statement. Null when there is
 * none, or a run started first (the single-running index).
 */
export async function claimRerun(
  query: Query,
  opts: { capUsd: number; hookPass: boolean },
  now = new Date(),
): Promise<{ id: string; runId: string; postId: string; storyId: string; capUsd: number } | null> {
  await releaseStaleRuns(query, now);
  await settleReruns(query, now);
  try {
    const { rows } = await query(
      `WITH picked AS (
         SELECT id FROM social.rerun_requests
          WHERE status = 'requested'
            AND NOT EXISTS (SELECT 1 FROM social.runs r WHERE r.status = 'running')
          ORDER BY requested_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1),
       opened AS (
         INSERT INTO social.runs (kind, trigger, status, hook_pass, cap_usd, started_at)
         SELECT 'daily', 'manual', 'running', $2, $3, $1::timestamptz FROM picked
         RETURNING id)
       UPDATE social.rerun_requests q
          SET status = 'running', started_at = $1::timestamptz, run_id = (SELECT id FROM opened)
         FROM picked
        WHERE q.id = picked.id
       RETURNING q.id, q.run_id, q.post_id, q.story_id`,
      [now.toISOString(), opts.hookPass, opts.capUsd],
    );
    const r = rows[0];
    return r ? { id: r.id as string, runId: r.run_id as string, postId: r.post_id as string, storyId: r.story_id as string, capUsd: opts.capUsd } : null;
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return null;
    throw error;
  }
}
