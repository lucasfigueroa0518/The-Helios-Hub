import type { Queryable } from '@/lib/explainers/db';
import {
  CAPTION_MAX_CHARS,
  PUBLISH_POLL_SECONDS,
  PUBLISH_POLL_TIMEOUT_MINUTES,
  PUBLISH_STALE_MINUTES,
  PUBLISH_VIDEO_URL_SECONDS,
} from '@/lib/explainers/publish/config';
import type { ReelMetaClient } from '@/lib/explainers/publish/meta';
import { explainerPayloadFlags } from '@/lib/explainers/publish/publish';
import { checkAccountQuota } from '@/lib/instagram/account-gate';
import type { PostText } from '@/lib/reel-ai-drama/types';

import { dramaItemId, isUuid, syncDramaApproval } from './items';

/**
 * AI Drama publish attempts on the lifecycle spine (social_hub.publish_attempts, vertical 'reel_ai_drama'), mirroring
 * lib/explainers/publish/publish.ts. Only the shared publisher carries them (scripts/publisher_worker.ts); there is no
 * episode stamp. One publish at a time across every type: they share one account.
 */

export type DramaQueued =
  | { queued: true; id: string }
  | { queued: false; note: string; terminal?: boolean; alreadyPublished?: boolean; status?: number };

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/** caption, a blank line, question, a blank line, then the credits one per line; trimmed to fit Instagram's limit (credits go first). */
export function composeDramaCaption(post: Partial<PostText> | null | undefined, max = CAPTION_MAX_CHARS): string | null {
  if (!post) return null;
  const caption = typeof post.caption === 'string' ? post.caption.trim() : '';
  const question = typeof post.question === 'string' ? post.question.trim() : '';
  const credits = Array.isArray(post.credits) ? post.credits.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map((c) => c.trim()) : [];
  if (!caption && !question) return null;
  const build = (cr: readonly string[]) => [caption, question, cr.join('\n')].filter((part) => part !== '').join('\n\n');
  let kept = credits;
  let text = build(kept);
  while (text.length > max && kept.length) {
    kept = kept.slice(0, -1);
    text = build(kept);
  }
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

/** The caption that posts: the newest 'post_caption' artifact (a revision), else composed from the newest 'post_text'. */
export async function dramaCaption(db: Queryable, jobId: string): Promise<string | null> {
  if (!isUuid(jobId)) return null;
  const { rows } = await db.query<{ kind: string; content: string | null }>(
    `SELECT DISTINCT ON (kind) kind, content FROM reel_ai_drama.artifacts
      WHERE job_id = $1 AND kind IN ('post_caption', 'post_text') ORDER BY kind, seq DESC`,
    [jobId],
  );
  const stored = rows.find((r) => r.kind === 'post_caption')?.content?.trim();
  if (stored) return stored;
  const text = rows.find((r) => r.kind === 'post_text')?.content;
  if (!text) return null;
  try {
    return composeDramaCaption(JSON.parse(text) as PostText);
  } catch {
    return null;
  }
}

/** Write the posting caption from the job's post text (done when a job finishes ok). Null when there is no post text. */
export async function writeDramaPostCaption(db: Queryable, jobId: string): Promise<string | null> {
  const { rows } = await db.query<{ content: string | null }>(
    `SELECT content FROM reel_ai_drama.artifacts WHERE job_id = $1 AND kind = 'post_text' ORDER BY seq DESC LIMIT 1`,
    [jobId],
  );
  let caption: string | null = null;
  try {
    caption = rows[0]?.content ? composeDramaCaption(JSON.parse(rows[0].content) as PostText) : null;
  } catch {
    caption = null;
  }
  if (!caption) return null;
  await db.query(`INSERT INTO reel_ai_drama.artifacts (job_id, kind, content) VALUES ($1, 'post_caption', $2)`, [jobId, caption]);
  return caption;
}

/** The waiting or posting booking's Trial / Main; Main when there is none (a hard publish), as Explainers. */
export async function dramaFeedMode(db: Queryable, itemId: string): Promise<'trial' | 'main'> {
  try {
    const { rows } = await db.query<{ feed_mode: string | null }>(
      `SELECT feed_mode FROM social_hub.schedule
        WHERE vertical = 'reel_ai_drama' AND content_item_id = $1 AND status IN ('scheduled', 'publishing') AND feed_mode IS NOT NULL
        ORDER BY (status = 'publishing') DESC, publish_at LIMIT 1`,
      [itemId],
    );
    return rows[0]?.feed_mode === 'trial' ? 'trial' : 'main';
  } catch {
    return 'main';
  }
}

/** What a reel needs before it can go: finished, not rejected, approved (or approval off, or forced), video in the bucket, a caption that fits. */
export async function dramaPublishReadiness(
  db: Queryable,
  jobId: string,
  trigger: 'approve' | 'auto' | 'force',
): Promise<{ ok: true; videoObject: string; caption: string } | { ok: false; note: string; alreadyPublished?: true }> {
  if (!isUuid(jobId)) return { ok: false, note: 'The reel is gone.' };
  const { rows } = await db.query<{ status: string; verdict: string | null; published: boolean; video: string | null; location: string | null }>(
    `SELECT j.status,
            CASE WHEN f.verdict = 'rejected' OR ap.decision = 'rejected' THEN 'rejected' ELSE ap.decision END AS verdict,
            EXISTS (SELECT 1 FROM social_hub.publish_attempts p WHERE p.content_item_id = ci.id AND p.status = 'published') AS published,
            v.storage_path AS video, v.storage_location AS location
       FROM reel_ai_drama.jobs j
       LEFT JOIN reel_ai_drama.feedback f ON f.job_id = j.id
       LEFT JOIN social_hub.content_items ci ON ci.vertical = 'reel_ai_drama' AND ci.native_ref = j.id::text
       LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
       LEFT JOIN LATERAL (SELECT storage_path, storage_location FROM reel_ai_drama.artifacts
                           WHERE job_id = j.id AND kind = 'video' ORDER BY seq DESC LIMIT 1) v ON true
      WHERE j.id = $1`,
    [jobId],
  );
  const job = rows[0];
  if (!job) return { ok: false, note: 'The reel is gone.' };
  if (job.published) return { ok: false, note: 'This AI Drama reel is already published.', alreadyPublished: true };
  if (job.status !== 'ok') return { ok: false, note: `The reel is ${job.status}, not finished.` };
  if (job.verdict === 'rejected') return { ok: false, note: 'This reel was rejected.' };
  if (job.verdict !== 'approved' && trigger !== 'force') {
    const { rows: setting } = await db.query<{ value: unknown }>(`SELECT value FROM reel_ai_drama.settings WHERE key = 'require_approval'`);
    if (setting[0]?.value !== false) return { ok: false, note: 'Only a reel a person approved can be published.' };
  }
  if (!job.video) return { ok: false, note: 'The reel has no video.' };
  if (job.location !== 'bucket') return { ok: false, note: 'The video is only on the machine that rendered it, not in Storage.' };
  const caption = await dramaCaption(db, jobId);
  if (!caption) return { ok: false, note: 'The reel has no post caption.' };
  if (caption.length > CAPTION_MAX_CHARS) return { ok: false, note: `The caption is ${caption.length} characters; Instagram takes ${CAPTION_MAX_CHARS}.` };
  return { ok: true, videoObject: job.video, caption };
}

export async function dramaQueuePublish(db: Queryable, jobId: string, trigger: 'approve' | 'auto' | 'force'): Promise<DramaQueued> {
  const ready = await dramaPublishReadiness(db, jobId, trigger);
  if (!ready.ok) return { queued: false, note: ready.note, terminal: true, ...(ready.alreadyPublished ? { alreadyPublished: true } : {}) };
  const itemId = await dramaItemId(db, jobId);
  if (!itemId) return { queued: false, note: 'The reel is gone.', terminal: true };
  try {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, payload)
       VALUES ($1, 'reel_ai_drama', $2, 'requested', $3, $4::jsonb) RETURNING id`,
      [itemId, trigger, ready.caption, JSON.stringify({ video_object: ready.videoObject, ...explainerPayloadFlags(await dramaFeedMode(db, itemId)) })],
    );
    return { queued: true, id: rows[0]!.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { queued: false, note: 'This AI Drama reel is already publishing.', terminal: false, status: 409 };
    throw error;
  }
}

/** Fail this type's attempts a dead publisher left mid-publish. */
export async function dramaFailStaleAttempts(db: Queryable): Promise<void> {
  await db.query(
    `UPDATE social_hub.publish_attempts
        SET status = 'failed', finished_at = now(),
            error = 'The publisher stopped while this reel was publishing. Check Instagram before trying again.'
      WHERE vertical = 'reel_ai_drama' AND status IN ('creating', 'processing', 'publishing')
        AND started_at < now() - make_interval(mins => $1)`,
    [PUBLISH_STALE_MINUTES],
  );
}

async function update(db: Queryable, id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  const sets = keys.map((key, index) => `${key} = $${index + 2}`);
  await db.query(`UPDATE social_hub.publish_attempts SET ${sets.join(', ')} WHERE id = $1`, [id, ...keys.map((key) => fields[key])]);
}

async function markScheduleForAttempt(db: Queryable, attemptId: string, status: 'published' | 'failed', error: string | null): Promise<void> {
  await db.query(`UPDATE social_hub.schedule SET status = $2, error = $3 WHERE publish_attempt_id = $1 AND status = 'publishing'`, [attemptId, status, error]);
}

export type DramaPublishDeps = {
  db: Queryable;
  meta: ReelMetaClient;
  signVideo: (objectPath: string, expiresIn: number) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * The drama worker's own posting while the shared publisher does not drive AI Drama (publisher_mode off or shadow, as
 * explainers do): fail stale attempts, claim the oldest requested AI Drama attempt while nothing is in flight on the
 * account, and carry it. Null when there is nothing to claim.
 */
export async function claimAndCarryDrama(deps: DramaPublishDeps): Promise<{ id: string; status: 'published' | 'failed' } | null> {
  await dramaFailStaleAttempts(deps.db);
  const { rows } = await deps.db.query<{ id: string }>(
    `UPDATE social_hub.publish_attempts SET status = 'creating', started_at = now()
      WHERE id = (
        SELECT id FROM social_hub.publish_attempts
         WHERE vertical = 'reel_ai_drama' AND status = 'requested'
           AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts a WHERE a.status IN ('creating', 'processing', 'publishing') AND a.started_at > now() - interval '30 minutes')
         ORDER BY requested_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id`,
  );
  const id = rows[0]?.id;
  return id ? dramaCarryAttempt(deps, id) : null;
}

/** Carry one claimed attempt (status `creating`) to Instagram: rejected-after-slot check, the account gate, the container, the poll, the publish. */
export async function dramaCarryAttempt(deps: DramaPublishDeps, id: string): Promise<{ id: string; status: 'published' | 'failed' }> {
  const { db, meta } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const statusLog: Array<{ at: string; statusCode: string; status: string | null }> = [];
  try {
    const { rows } = await db.query<{ caption: string; video_object: string | null; share_to_feed: boolean | null; graduation_strategy: string | null }>(
      `SELECT caption, payload->>'video_object' AS video_object,
              CASE WHEN payload->>'graduation_strategy' IS NOT NULL THEN (payload->>'share_to_feed')::boolean
                   ELSE coalesce((payload->>'share_to_feed')::boolean, true) END AS share_to_feed,
              payload->>'graduation_strategy' AS graduation_strategy
         FROM social_hub.publish_attempts WHERE id = $1 AND vertical = 'reel_ai_drama'`,
      [id],
    );
    const attempt = rows[0];
    if (!attempt) throw new Error('That publish attempt is gone.');
    if (!attempt.video_object) throw new Error('The attempt names no video.');

    // Rejected after its slot opened: never posts (D41).
    const { rows: rejected } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM social_hub.publish_attempts a
         JOIN social_hub.content_items ci ON ci.id = a.content_item_id
         LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
         LEFT JOIN reel_ai_drama.feedback f ON f.job_id::text = ci.native_ref
        WHERE a.id = $1 AND (ap.decision = 'rejected' OR f.verdict = 'rejected')`,
      [id],
    );
    if (Number(rejected[0]?.n ?? 0) > 0) throw new Error('This reel was rejected after its slot opened; nothing was posted.');

    const gate = await checkAccountQuota({ ops: meta, query: (text, params) => db.query(text, params) as never });
    if (!gate.ok) throw new Error(gate.message);

    const videoUrl = await deps.signVideo(attempt.video_object, PUBLISH_VIDEO_URL_SECONDS);
    const caption = attempt.caption ?? '';
    if (!caption.trim()) throw new Error('The attempt has no caption.');
    if (caption.length > CAPTION_MAX_CHARS) throw new Error(`The caption is ${caption.length} characters; Instagram takes ${CAPTION_MAX_CHARS}.`);
    const containerId = await meta.createReel({ videoUrl, caption, shareToFeed: attempt.share_to_feed, graduationStrategy: attempt.graduation_strategy ?? null });
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
 * Hard publish: post now, only while publishing is on and the reel is ready (checked first). A click counts as approval (an unreviewed reel is recorded approved, note says so); a
 * rejected reel is refused (terminal). Its waiting slot is cancelled so it can't post twice. Queues trigger 'force'.
 */
export async function hardPublishDramaJob(db: Queryable, jobId: string, by: string): Promise<DramaQueued> {
  if (!isUuid(jobId)) return { queued: false, note: 'The reel is gone.', terminal: true, status: 404 };
  const { rows: job } = await db.query(`SELECT 1 FROM reel_ai_drama.jobs WHERE id = $1`, [jobId]);
  if (!job.length) return { queued: false, note: 'The reel is gone.', terminal: true, status: 404 };
  const { rows } = await db.query<{ verdict: string | null }>(`SELECT verdict FROM reel_ai_drama.feedback WHERE job_id = $1`, [jobId]);
  const verdict = rows[0]?.verdict ?? null;
  if (verdict === 'rejected') return { queued: false, note: 'This reel was rejected in review.', terminal: true, status: 409 };
  // Refuse before anything is recorded: a refusal must not leave the reel approved with its slot cancelled.
  const { rows: live } = await db.query<{ value: unknown }>(`SELECT value FROM reel_ai_drama.settings WHERE key = 'publishing_live'`);
  if (live[0]?.value !== true) {
    return { queued: false, note: 'Publishing is switched off for AI Drama Reels. Turn on Live at the top of the AI Drama Reels page, then post it.', terminal: false, status: 409 };
  }
  const ready = await dramaPublishReadiness(db, jobId, 'force');
  if (!ready.ok) return { queued: false, note: ready.note, terminal: true, status: 409, ...(ready.alreadyPublished ? { alreadyPublished: true } : {}) };
  if (verdict == null) {
    await db.query(
      `INSERT INTO reel_ai_drama.feedback (job_id, verdict, tags, note, created_by)
       VALUES ($1, 'approved', ARRAY[]::text[], 'Approved by Hard publish from the Social Hub', $2)
       ON CONFLICT (job_id) DO NOTHING`,
      [jobId, by],
    );
  }
  await syncDramaApproval(db, jobId, verdict == null ? 'force' : 'user');
  const itemId = await dramaItemId(db, jobId);
  if (itemId) {
    await db.query(
      `UPDATE social_hub.schedule SET status = 'cancelled', error = 'Hard published from the Social Hub'
        WHERE content_item_id = $1 AND status = 'scheduled'`,
      [itemId],
    );
  }
  return dramaQueuePublish(db, jobId, 'force');
}
