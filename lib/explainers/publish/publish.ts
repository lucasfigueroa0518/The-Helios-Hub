import type { Queryable } from '@/lib/explainers/db';

import {
  CAPTION_MAX_CHARS,
  PUBLISH_POLL_SECONDS,
  PUBLISH_POLL_TIMEOUT_MINUTES,
  PUBLISH_QUOTA_HEADROOM,
  PUBLISH_STALE_MINUTES,
  PUBLISH_VIDEO_URL_SECONDS,
} from './config';
import type { ReelMetaClient } from './meta';

/**
 * Explainer publish attempts, the reels.publish_attempts lifecycle:
 * requested → creating → processing → publishing → published | failed.
 * Only a finished render a person approved (explainers.feedback) can be
 * queued, and only one whose video is in the `explainers` bucket.
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
            f.verdict,
            EXISTS (SELECT 1 FROM explainers.publish_attempts p WHERE p.job_id = j.id AND p.status = 'published') AS published,
            v.storage_path AS video, v.storage_location AS location,
            c.content AS caption
       FROM explainers.jobs j
       LEFT JOIN explainers.feedback f ON f.job_id = j.id
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
  try {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO explainers.publish_attempts (job_id, trigger, status, caption, video_object)
       VALUES ($1, $2, 'requested', $3, $4) RETURNING id`,
      [jobId, trigger, ready.caption, ready.videoObject],
    );
    return { queued: true, id: rows[0]!.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { queued: false, note: 'This explainer is already publishing.', terminal: false };
    throw error;
  }
}

async function claimPublish(db: Queryable): Promise<string | null> {
  await db.query(
    `UPDATE explainers.publish_attempts
        SET status = 'failed', finished_at = now(),
            error = 'The worker stopped while this reel was publishing. Check Instagram before trying again.'
      WHERE status IN ('creating', 'processing', 'publishing')
        AND started_at < now() - make_interval(mins => $1)`,
    [PUBLISH_STALE_MINUTES],
  );
  const { rows } = await db.query<{ id: string }>(
    `UPDATE explainers.publish_attempts SET status = 'creating', started_at = now()
      WHERE id = (
        SELECT id FROM explainers.publish_attempts
         WHERE status = 'requested'
           AND NOT EXISTS (SELECT 1 FROM explainers.publish_attempts a WHERE a.status IN ('creating', 'processing', 'publishing'))
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
  await db.query(`UPDATE explainers.publish_attempts SET ${sets.join(', ')} WHERE id = $1`, [id, ...keys.map((key) => fields[key])]);
}

export async function markScheduleForAttempt(db: Queryable, attemptId: string, status: 'published' | 'failed', error: string | null): Promise<void> {
  await db.query(
    `UPDATE explainers.posting_schedule SET status = $2, error = $3 WHERE publish_attempt_id = $1 AND status = 'publishing'`,
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
  const { db, meta } = deps;
  const id = await claimPublish(db);
  if (!id) return null;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const statusLog: Array<{ at: string; statusCode: string; status: string | null }> = [];
  try {
    const { rows } = await db.query<{ caption: string; video_object: string; share_to_feed: boolean }>(
      `SELECT caption, video_object, share_to_feed FROM explainers.publish_attempts WHERE id = $1`,
      [id],
    );
    const attempt = rows[0]!;

    // The account is shared by every content type (docs/social-overnight.md).
    const limit = await meta.publishingLimit();
    if (limit.quotaTotal != null && limit.quotaTotal - limit.quotaUsage < PUBLISH_QUOTA_HEADROOM) {
      throw new Error(`The Instagram account has ${limit.quotaTotal - limit.quotaUsage} of ${limit.quotaTotal} posts left in its 24-hour quota.`);
    }

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
