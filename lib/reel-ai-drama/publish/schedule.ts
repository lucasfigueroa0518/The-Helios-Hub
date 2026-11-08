import type { Queryable } from '@/lib/explainers/db';
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { chooseFromWindows, slotTakenKey, uniformIndex } from '@/lib/instagram/window';
import { slotPlan } from '@/lib/social-hub/slots';
import { chooseTemplateSlot } from '@/lib/social-hub/slots/scheduler';
import { bookSlot } from '@/lib/social-hub/spine';

import { DEFAULT_DRAMA_POSTS_PER_DAY, DRAMA_WINDOWS } from './config';
import { dramaItemId, spineOf, syncDramaApproval } from './items';
import { dramaQueuePublish } from './publish';

/**
 * AI Drama reels on the calendar (mirrors lib/explainers/publish/schedule.ts): the weekly slot template when
 * there is one, else the legacy evening window × posts_per_day. Slots live on the lifecycle spine
 * (social_hub.schedule, vertical 'reel_ai_drama'). Nothing is booked while publishing_live is off.
 */

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

async function settingValue(db: Queryable, key: string): Promise<unknown> {
  const { rows } = await db.query<{ value: unknown }>(`SELECT value FROM reel_ai_drama.settings WHERE key = $1`, [key]);
  return rows[0]?.value;
}

/** The master switch: true only when stored true. */
export async function dramaPublishingLive(db: Queryable): Promise<boolean> {
  return (await settingValue(db, 'publishing_live')) === true;
}

/** On unless stored false. */
export async function dramaRequireApproval(db: Queryable): Promise<boolean> {
  return (await settingValue(db, 'require_approval')) !== false;
}

/** posts_per_day within 1..DRAMA_WINDOWS.length; a bad row reads as the default. */
export async function dramaPostsPerDay(db: Queryable): Promise<number> {
  const value = Number(await settingValue(db, 'posts_per_day'));
  return Number.isInteger(value) && value >= 1 ? Math.min(value, DRAMA_WINDOWS.length) : DEFAULT_DRAMA_POSTS_PER_DAY;
}

export type DramaScheduleOutcome = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string };

export const DRAMA_REJECTED_SLOT_NOTE = 'This AI Drama reel was rejected, so it was not posted.';
export const DRAMA_NOT_APPROVED_NOTE = 'Nobody approved this AI Drama reel before its slot, so it was not posted.';
export const DRAMA_UNSCHEDULED_NOTE = 'Taken off the calendar by a person (unscheduled). It is not approved any more.';
export const DRAMA_NOT_IN_BUCKET_NOTE = 'The video is only on the machine that rendered it, not in Storage, so it can’t be booked.';

async function videoInBucket(db: Queryable, jobId: string): Promise<boolean> {
  const { rows } = await db.query<{ location: string | null }>(
    `SELECT storage_location AS location FROM reel_ai_drama.artifacts WHERE job_id = $1 AND kind = 'video' ORDER BY seq DESC LIMIT 1`,
    [jobId],
  );
  return rows[0]?.location === 'bucket';
}

/**
 * Book a reel into the next free AI Drama slot, or return its waiting slot. `throughDate` (NY YYYY-MM-DD) is the last
 * day it may book (Approve and the night's finish booking pass today); without it the search runs two weeks ahead.
 * A video that isn't in Storage is never booked: nothing could post it.
 */
export async function scheduleDramaJob(
  db: Queryable,
  jobId: string,
  source: 'auto' | 'user',
  now = new Date(),
  throughDate?: string,
  rng: (count: number) => number = uniformIndex,
): Promise<DramaScheduleOutcome> {
  const itemId = await dramaItemId(db, jobId);
  if (!itemId) return { scheduled: false, note: 'The reel is gone.' };
  const active = async () =>
    (await db.query<{ id: string; publish_at: string }>(
      `SELECT id, publish_at FROM social_hub.schedule WHERE content_item_id = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`,
      [itemId],
    )).rows[0];
  const existing = await active();
  if (existing) return { scheduled: true, id: existing.id, publishAt: new Date(existing.publish_at).toISOString() };
  if (!(await videoInBucket(db, jobId))) return { scheduled: false, note: DRAMA_NOT_IN_BUCKET_NOTE };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const spacing = (text: string, params?: unknown[]) => db.query<Record<string, unknown>>(text, params);
    const busy = [...(await busyFeedTimes(spacing, now, 'reel_ai_drama')), ...(await ownFeedTimes(spacing, 'reel_ai_drama', now))];
    // A failed slot read throws: it must not silently book by the old rules (ruling P2).
    const plan = await slotPlan(spacing, calendarDateKey(now));
    let choice: { nyDate: string; slot: string; publishAt: Date } | null;
    let feedMode: 'trial' | 'main' | null = null;
    if (!plan) {
      const { rows: takenRows } = await db.query<{ d: string; slot: string }>(
        `SELECT ny_date::text AS d, slot FROM social_hub.schedule
          WHERE vertical = 'reel_ai_drama' AND status IN ('scheduled', 'publishing', 'published') AND ny_date >= $1::date`,
        [calendarDateKey(now)],
      );
      const takenKeys = new Set(takenRows.map((r) => slotTakenKey(r.d, r.slot)));
      const windows = DRAMA_WINDOWS.slice(0, Math.max(1, Math.min(await dramaPostsPerDay(db), DRAMA_WINDOWS.length)));
      choice = chooseFromWindows(windows, now, takenKeys, busy, rng, throughDate);
    } else {
      const picked = await chooseTemplateSlot(spacing, plan, 'reel_ai_drama', { now, busy, rng, throughDate });
      choice = picked;
      feedMode = picked?.feedMode ?? null;
    }
    if (!choice) {
      return { scheduled: false, note: throughDate ? `No AI Drama slot is open through ${throughDate}.` : 'No AI Drama slot is open in the next two weeks.' };
    }
    try {
      const booked = await bookSlot(spineOf(db), { vertical: 'reel_ai_drama', itemId, nyDate: choice.nyDate, slot: choice.slot, publishAt: choice.publishAt, source, ...(feedMode ? { feedMode } : {}) });
      return { scheduled: true, id: booked.id, publishAt: booked.publishAt };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await active();
      if (raced) return { scheduled: true, id: raced.id, publishAt: new Date(raced.publish_at).toISOString() };
    }
  }
  return { scheduled: false, note: 'That slot was just taken.' };
}

/**
 * When the night's job (trigger 'auto') finishes, it takes today's next open slot unapproved (B2): it still needs
 * Approve, and without one dramaReleaseDue cancels it at its time. A person's job waits for Approve. Only while live.
 */
export async function bookFinishedDrama(
  db: Queryable,
  job: { id: string; trigger: string },
  now = new Date(),
  rng?: (count: number) => number,
): Promise<DramaScheduleOutcome | null> {
  if (job.trigger !== 'auto') return null;
  if (!(await dramaPublishingLive(db))) return null;
  return scheduleDramaJob(db, job.id, 'auto', now, calendarDateKey(now, SOCIAL_TIMEZONE), rng);
}

/**
 * Finished, unposted, unscheduled reels with their video in Storage that may go on the calendar: the approved ones;
 * with require_approval off (`$1` false), also the ones nobody reviewed and nobody unscheduled (never a rejected one).
 * Only the newest finished render of a live pitch.
 */
export const DRAMA_PLACEABLE_RENDERS = `
SELECT j.id, j.pitch_id, f.created_at AS reviewed_at, j.finished_at
  FROM reel_ai_drama.jobs j
  LEFT JOIN reel_ai_drama.feedback f ON f.job_id = j.id
  LEFT JOIN social_hub.content_items ci ON ci.vertical = 'reel_ai_drama' AND ci.native_ref = j.id::text
  LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
 WHERE j.status = 'ok'
   AND (ci.deleted_at IS NULL)
   AND (ap.decision = 'approved'
        -- Unreviewed, with approval off: only if nobody took it off the calendar (an Unschedule sticks until Approve).
        OR (NOT $1::boolean AND ap.decision IS NULL
            AND NOT EXISTS (SELECT 1 FROM social_hub.schedule c WHERE c.content_item_id = ci.id AND c.status = 'cancelled')))
   AND f.verdict IS DISTINCT FROM 'rejected'
   -- A live pitch only, and only its newest finished render (a Regenerate's older version never posts too).
   AND EXISTS (SELECT 1 FROM reel_ai_drama.pitches p WHERE p.id = j.pitch_id AND p.status IN ('pooled', 'picked', 'made'))
   AND NOT EXISTS (SELECT 1 FROM reel_ai_drama.jobs n WHERE n.pitch_id = j.pitch_id AND n.status = 'ok' AND n.seq > j.seq)
   AND (SELECT a.storage_location FROM reel_ai_drama.artifacts a WHERE a.job_id = j.id AND a.kind = 'video' ORDER BY a.seq DESC LIMIT 1) = 'bucket'
   AND NOT EXISTS (SELECT 1 FROM social_hub.schedule s WHERE s.content_item_id = ci.id AND s.status IN ('scheduled', 'publishing', 'published'))
   AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts p WHERE p.content_item_id = ci.id AND p.status IN ('requested', 'creating', 'processing', 'publishing', 'published'))`;

/** Approved (or, with approval off, unreviewed), unbooked reels with their video in Storage: booked, oldest approval first. Only while live. */
export async function scheduleApprovedDrama(db: Queryable, now = new Date(), rng?: (count: number) => number): Promise<number> {
  if (!(await dramaPublishingLive(db))) return 0;
  const approvalNeeded = await dramaRequireApproval(db);
  const { rows } = await db.query<{ id: string }>(
    `SELECT r.id FROM (${DRAMA_PLACEABLE_RENDERS}) r ORDER BY r.reviewed_at NULLS LAST, r.finished_at`,
    [approvalNeeded],
  );
  let scheduled = 0;
  for (const row of rows) {
    const result = await scheduleDramaJob(db, row.id, 'auto', now, undefined, rng);
    if (!result.scheduled) break;
    scheduled += 1;
  }
  return scheduled;
}

/**
 * Due slots become publish attempts: a rejected reel's slot is cancelled (a rejection in either place wins); with
 * require_approval on, so is one nobody approved. The rest reach dramaQueuePublish, whose readiness check is a second guard.
 */
export async function dramaReleaseDue(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string; job_id: string; source: string; decision: string | null }>(
    `SELECT s.id, ci.native_ref AS job_id, s.source,
            CASE WHEN f.verdict = 'rejected' OR ap.decision = 'rejected' THEN 'rejected' ELSE ap.decision END AS decision
       FROM social_hub.schedule s
       JOIN social_hub.content_items ci ON ci.id = s.content_item_id
       LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
       LEFT JOIN reel_ai_drama.feedback f ON f.job_id::text = ci.native_ref
      WHERE s.vertical = 'reel_ai_drama' AND s.status = 'scheduled' AND s.publish_at <= now()
      ORDER BY s.publish_at`,
  );
  const cancel = (id: string, note: string) =>
    db.query(`UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE id = $1 AND status = 'scheduled'`, [id, note]);
  const approvalNeeded = rows.some((row) => row.decision !== 'approved') && (await dramaRequireApproval(db));
  let released = 0;
  for (const row of rows) {
    if (row.decision === 'rejected') {
      await cancel(row.id, DRAMA_REJECTED_SLOT_NOTE);
      continue;
    }
    if (approvalNeeded && row.decision !== 'approved') {
      await cancel(row.id, DRAMA_NOT_APPROVED_NOTE);
      continue;
    }
    const claimed = await db.query(`UPDATE social_hub.schedule SET status = 'publishing' WHERE id = $1 AND status = 'scheduled' RETURNING id`, [row.id]);
    if (!claimed.rows[0]) continue;
    const result = await dramaQueuePublish(db, row.job_id, row.source === 'user' ? 'approve' : 'auto');
    if (result.queued) {
      await db.query(`UPDATE social_hub.schedule SET publish_attempt_id = $2 WHERE id = $1`, [row.id, result.id]);
      released += 1;
    } else if (result.alreadyPublished) {
      await db.query(`UPDATE social_hub.schedule SET status = 'published', error = NULL WHERE id = $1`, [row.id]);
    } else if (result.terminal) {
      await db.query(`UPDATE social_hub.schedule SET status = 'failed', error = $2 WHERE id = $1`, [row.id, result.note]);
    } else {
      await db.query(`UPDATE social_hub.schedule SET status = 'scheduled', error = $2 WHERE id = $1`, [row.id, result.note]);
    }
  }
  return released;
}

/**
 * Unschedule: the waiting slot is cancelled and the approval withdrawn (an approved reel with no slot would be booked
 * again). A rejection stays. A reel that is posting or posted can't be unscheduled.
 */
export async function unscheduleDramaJob(db: Queryable, jobId: string): Promise<{ ok: boolean; note: string }> {
  const itemId = await dramaItemId(db, jobId);
  if (!itemId) return { ok: false, note: 'The reel is gone.' };
  const { rows: busy } = await db.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM social_hub.schedule WHERE content_item_id = $1 AND status = 'publishing')
          + (SELECT count(*) FROM social_hub.publish_attempts WHERE content_item_id = $1 AND status IN ('requested', 'creating', 'processing', 'publishing', 'published')) AS n`,
    [itemId],
  );
  if (Number(busy[0]?.n ?? 0) > 0) return { ok: false, note: 'It is posting, or has already posted, so it can’t be unscheduled.' };
  const cancelled = await db.query<{ id: string }>(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE content_item_id = $1 AND status = 'scheduled' RETURNING id`,
    [itemId, DRAMA_UNSCHEDULED_NOTE],
  );
  await db.query(`DELETE FROM reel_ai_drama.feedback WHERE job_id = $1 AND verdict = 'approved'`, [jobId]);
  await syncDramaApproval(db, jobId);
  return cancelled.rows.length
    ? { ok: true, note: 'Unscheduled. It is not approved any more, so it will not be booked again until you approve it.' }
    : { ok: true, note: 'It had no slot. Its approval is withdrawn.' };
}
