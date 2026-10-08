import type { Queryable } from '@/lib/explainers/db';
import { checkAccountQuota } from '@/lib/instagram/account-gate';

import {
  CAPTION_MAX_CHARS,
  PUBLISH_POLL_SECONDS,
  PUBLISH_POLL_TIMEOUT_MINUTES,
  PUBLISH_STALE_MINUTES,
  PUBLISH_VIDEO_URL_SECONDS,
} from './config';
import { explainerItemId, syncExplainerApproval } from './items';
import type { ReelMetaClient } from './meta';

/**
 * Explainer publish attempts on the lifecycle spine (social_hub.publish_attempts,
 * vertical 'explainers', D36): requested → creating → processing → publishing
 * → published | failed. Only a finished render a person approved (the
 * explainers.feedback verdict, mirrored onto the item's approval) can be
 * queued, and only one whose video is in the `explainers` bucket. One publish
 * at a time across every type on the spine: they share one account.
 */

export type PublishTrigger = 'approve' | 'auto' | 'force';

export type Queued =
  | { queued: true; id: string }
  | { queued: false; note: string; terminal: boolean; alreadyPublished?: true };

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/** What a job needs before it can go: approved, rendered, video in the bucket, a caption that fits. */
export async function publishReadiness(
  db: Queryable,
  jobId: string,
): Promise<{ ok: true; videoObject: string; caption: string } | { ok: false; note: string; alreadyPublished?: true }> {
  const { rows } = await db.query<{
    status: string;
    verdict: string | null;
    published: boolean;
    video: string | null;
    location: string | null;
    caption: string | null;
  }>(
    `SELECT j.status,
            -- A rejection in either place wins: the review page writes feedback first (D41).
            CASE WHEN f.verdict = 'rejected' OR ap.decision = 'rejected' THEN 'rejected' ELSE ap.decision END AS verdict,
            EXISTS (SELECT 1 FROM social_hub.publish_attempts p WHERE p.content_item_id = ci.id AND p.status = 'published') AS published,
            v.storage_path AS video, v.storage_location AS location,
            c.content AS caption
       FROM explainers.jobs j
       LEFT JOIN explainers.feedback f ON f.job_id = j.id
       LEFT JOIN social_hub.content_items ci ON ci.vertical = 'explainers' AND ci.native_ref = j.id::text
       LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
       LEFT JOIN LATERAL (SELECT storage_path, storage_location FROM explainers.artifacts
                           WHERE job_id = j.id AND kind = 'video' ORDER BY seq DESC LIMIT 1) v ON true
       LEFT JOIN LATERAL (SELECT content FROM explainers.artifacts
                           WHERE job_id = j.id AND kind = 'post_caption' ORDER BY seq DESC LIMIT 1) c ON true
      WHERE j.id = $1`,
    [jobId],
  );
  const job = rows[0];
  if (!job) return { ok: false, note: 'The render is gone.' };
  if (job.published) return { ok: false, note: 'This explainer is already published.', alreadyPublished: true };
  if (job.status !== 'ok') return { ok: false, note: `The render is ${job.status}, not finished.` };
  if (job.verdict === 'rejected') return { ok: false, note: 'This reel was rejected.' };
  if (job.verdict !== 'approved') {
    const { rows: setting } = await db.query<{ value: unknown }>(`SELECT value FROM explainers.settings WHERE key = 'require_approval'`);
    if (setting[0]?.value !== false) return { ok: false, note: 'Only a reel a person approved can be published.' };
  }
  if (!job.video) return { ok: false, note: 'The render has no video.' };
  if (job.location !== 'bucket') return { ok: false, note: 'The video is only on the machine that rendered it, not in Storage.' };
  const caption = job.caption?.trim() ?? '';
  if (!caption) return { ok: false, note: 'The render has no post caption.' };
  if (caption.length > CAPTION_MAX_CHARS) return { ok: false, note: `The caption is ${caption.length} characters; Instagram takes ${CAPTION_MAX_CHARS}.` };
  return { ok: true, videoObject: job.video, caption };
}

export async function queuePublish(db: Queryable, jobId: string, trigger: PublishTrigger): Promise<Queued> {
  const ready = await publishReadiness(db, jobId);
  if (!ready.ok) return { queued: false, note: ready.note, terminal: true, ...(ready.alreadyPublished ? { alreadyPublished: true as const } : {}) };
  const itemId = await explainerItemId(db, jobId);
  if (!itemId) return { queued: false, note: 'The render is gone.', terminal: true };
  try {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, payload)
       VALUES ($1, 'explainers', $2, 'requested', $3, $4::jsonb) RETURNING id`,
      [itemId, trigger, ready.caption, JSON.stringify({ video_object: ready.videoObject, share_to_feed: true })],
    );
    return { queued: true, id: rows[0]!.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { queued: false, note: 'This explainer is already publishing.', terminal: false };
    throw error;
  }
}

/** Fail this type's attempts a dead worker left mid-publish. */
export async function failStaleAttempts(db: Queryable): Promise<void> {
  await db.query(
    `UPDATE social_hub.publish_attempts
        SET status = 'failed', finished_at = now(),
            error = 'The worker stopped while this reel was publishing. Check Instagram before trying again.'
      WHERE vertical = 'explainers' AND status IN ('creating', 'processing', 'publishing')
        AND started_at < now() - make_interval(mins => $1)`,
    [PUBLISH_STALE_MINUTES],
  );
}

async function claimPublish(db: Queryable): Promise<string | null> {
  await failStaleAttempts(db);
  const { rows } = await db.query<{ id: string }>(
    `UPDATE social_hub.publish_attempts SET status = 'creating', started_at = now()
      WHERE id = (
        SELECT id FROM social_hub.publish_attempts
         WHERE vertical = 'explainers' AND status = 'requested'
           AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts a WHERE a.status IN ('creating', 'processing', 'publishing') AND a.started_at > now() - interval '30 minutes')
         ORDER BY requested_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id`,
  );
  return rows[0]?.id ?? null;
}

async function update(db: Queryable, id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  const sets = keys.map((key, index) => `${key} = $${index + 2}`);
  await db.query(`UPDATE social_hub.publish_attempts SET ${sets.join(', ')} WHERE id = $1`, [id, ...keys.map((key) => fields[key])]);
}

export async function markScheduleForAttempt(db: Queryable, attemptId: string, status: 'published' | 'failed', error: string | null): Promise<void> {
  await db.query(
    `UPDATE social_hub.schedule SET status = $2, error = $3 WHERE publish_attempt_id = $1 AND status = 'publishing'`,
    [attemptId, status, error],
  );
}

export type PublishDeps = {
  db: Queryable;
  meta: ReelMetaClient;
  signVideo: (objectPath: string, expiresIn: number) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** Claim one queued explainer and carry it to Instagram. */
export async function claimAndPublish(deps: PublishDeps): Promise<{ id: string; status: 'published' | 'failed' } | null> {
  const id = await claimPublish(deps.db);
  if (!id) return null;
  return carryAttempt(deps, id);
}

/** Carry one claimed attempt (status `creating`) to Instagram: the account gate, the container, the poll, the publish. */
export async function carryAttempt(deps: PublishDeps, id: string): Promise<{ id: string; status: 'published' | 'failed' }> {
  const { db, meta } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const statusLog: Array<{ at: string; statusCode: string; status: string | null }> = [];
  try {
    const { rows } = await db.query<{ caption: string; video_object: string; share_to_feed: boolean }>(
      `SELECT caption, payload->>'video_object' AS video_object, coalesce((payload->>'share_to_feed')::boolean, true) AS share_to_feed
         FROM social_hub.publish_attempts WHERE id = $1`,
      [id],
    );
    const attempt = rows[0]!;

    // Rejected after its slot opened: never posts (D41).
    const { rows: rejected } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM social_hub.publish_attempts a
         JOIN social_hub.content_items ci ON ci.id = a.content_item_id
         LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
         LEFT JOIN explainers.feedback f ON f.job_id::text = ci.native_ref
        WHERE a.id = $1 AND (ap.decision = 'rejected' OR f.verdict = 'rejected')`,
      [id],
    );
    if (rejected[0]!.n > 0) throw new Error('This reel was rejected after its slot opened; nothing was posted.');

    // The account is shared by every content type (lib/instagram/account-gate.ts).
    const gate = await checkAccountQuota({ ops: meta, query: (text, params) => db.query(text, params) as never });
    if (!gate.ok) throw new Error(gate.message);

    const videoUrl = await deps.signVideo(attempt.video_object, PUBLISH_VIDEO_URL_SECONDS);
    const containerId = await meta.createReel({ videoUrl, caption: attempt.caption, shareToFeed: attempt.share_to_feed });
    await update(db, id, { status: 'processing', container_id: containerId });

    const deadline = now() + PUBLISH_POLL_TIMEOUT_MINUTES * 60_000;
    for (;;) {
      const status = await meta.containerStatus(containerId);
      statusLog.push({ at: new Date(now()).toISOString(), ...status });
      if (status.statusCode === 'FINISHED') break;
      if (status.statusCode === 'ERROR' || status.statusCode === 'EXPIRED') {
        throw new Error(`Instagram could not process the reel (${status.statusCode}): ${status.status ?? 'no detail'}`);
      }
      if (now() >= deadline) throw new Error(`The container was still ${status.statusCode} after ${PUBLISH_POLL_TIMEOUT_MINUTES} minutes.`);
      await sleep(PUBLISH_POLL_SECONDS * 1000);
    }

    await update(db, id, { status: 'publishing', status_log: JSON.stringify(statusLog) });
    const mediaId = await meta.publishContainer(containerId);
    const permalink = await meta.permalink(mediaId).catch(() => null);
    await update(db, id, { status: 'published', media_id: mediaId, permalink, finished_at: new Date(now()).toISOString(), status_log: JSON.stringify(statusLog) });
    await markScheduleForAttempt(db, id, 'published', null).catch(() => undefined);
    return { id, status: 'published' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await update(db, id, { status: 'failed', error: message, finished_at: new Date(now()).toISOString(), status_log: JSON.stringify(statusLog) }).catch(() => undefined);
    await markScheduleForAttempt(db, id, 'failed', message).catch(() => undefined);
    return { id, status: 'failed' };
  }
}

/**
 * Hard publish (Social Hub, SH-15/SH-17): post this render now. A person's
 * click counts as approval: an unreviewed render is recorded `approved`
 * (note says so); a rejected one is refused. Its waiting slot is closed so
 * it cannot post twice.
 */
export async function hardPublishJob(db: Queryable, jobId: string, by: string): Promise<Queued> {
  const { rows } = await db.query<{ verdict: string | null }>(`SELECT verdict FROM explainers.feedback WHERE job_id = $1`, [jobId]);
  const verdict = rows[0]?.verdict ?? null;
  if (verdict === 'rejected') return { queued: false, note: 'This render was rejected in review.', terminal: true };
  if (verdict == null) {
    await db.query(
      `INSERT INTO explainers.feedback (job_id, verdict, tags, note, created_by)
       VALUES ($1, 'approved', ARRAY[]::text[], 'Approved by Hard publish from the Social Hub', $2)
       ON CONFLICT (job_id) DO NOTHING`,
      [jobId, by],
    );
  }
  await syncExplainerApproval(db, jobId, verdict == null ? 'force' : 'user');
  const itemId = await explainerItemId(db, jobId);
  if (itemId) {
    await db.query(
      `UPDATE social_hub.schedule SET status = 'cancelled', error = 'Hard published from the Social Hub'
        WHERE content_item_id = $1 AND status = 'scheduled'`,
      [itemId],
    );
  }
  return queuePublish(db, jobId, 'force');
}
