import type { Queryable } from '@/lib/explainers/db';
import { calendarDateKey } from '@/lib/instagram/clock';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { chooseFromWindows, slotTakenKey, uniformIndex } from '@/lib/instagram/window';

import { DEFAULT_POSTS_PER_DAY, EXPLAINER_WINDOWS } from './config';
import { explainerItemId } from './items';
import { queuePublish } from './publish';

/**
 * Up to `posts_per_day` explainers per Eastern day (default 2), one per
 * window (1:00–2:30 PM, 3:30–5:00 PM), each ≥ 30 minutes from any other
 * feed post (SH-46 – SH-48), on the lifecycle spine (D38). While
 * publishing is live, every approved, unposted render gets the next free
 * window; a due slot becomes a publish attempt. Slots live on the lifecycle
 * spine (social_hub.schedule, vertical 'explainers', D36).
 */

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/** The `publishing_live` row of explainers.settings (the typed settings loader ignores it). */
export async function publishingLive(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ value: unknown }>(`SELECT value FROM explainers.settings WHERE key = 'publishing_live'`);
  return rows[0]?.value === true;
}

/** The `require_approval` row: on unless set to false (docs/social-overnight.md). */
export async function requireApproval(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ value: unknown }>(`SELECT value FROM explainers.settings WHERE key = 'require_approval'`);
  return rows[0]?.value !== false;
}

/** `posts_per_day` from explainers.settings (SH-48), else the default. */
export async function postsPerDay(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ value: unknown }>(`SELECT value FROM explainers.settings WHERE key = 'posts_per_day'`);
  const value = Number(rows[0]?.value);
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_POSTS_PER_DAY;
}

export type ScheduleOutcome = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string };

export async function scheduleJob(
  db: Queryable,
  jobId: string,
  source: 'auto' | 'user',
  now = new Date(),
  rng: (count: number) => number = uniformIndex,
): Promise<ScheduleOutcome> {
  const itemId = await explainerItemId(db, jobId);
  if (!itemId) return { scheduled: false, note: 'The render is gone.' };
  const active = async () =>
    (await db.query<{ id: string; publish_at: string }>(
      `SELECT id, publish_at FROM social_hub.schedule WHERE content_item_id = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`,
      [itemId],
    )).rows[0];
  const existing = await active();
  if (existing) return { scheduled: true, id: existing.id, publishAt: new Date(existing.publish_at).toISOString() };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { rows: takenRows } = await db.query<{ d: string; slot: string }>(
      `SELECT ny_date::text AS d, slot FROM social_hub.schedule
        WHERE vertical = 'explainers' AND status IN ('scheduled', 'publishing', 'published') AND ny_date >= $1::date`,
      [calendarDateKey(now)],
    );
    const spacing = (text: string, params?: unknown[]) => db.query<Record<string, unknown>>(text, params);
    const busy = [...(await busyFeedTimes(spacing, now, 'explainers')), ...(await ownFeedTimes(spacing, 'explainers', now))];
    const windows = EXPLAINER_WINDOWS.slice(0, Math.max(1, Math.min(await postsPerDay(db), EXPLAINER_WINDOWS.length)));
    const choice = chooseFromWindows(windows, now, new Set(takenRows.map((r) => slotTakenKey(r.d, r.slot))), busy, rng);
    if (!choice) return { scheduled: false, note: 'No explainer window is open in the next two weeks.' };
    try {
      const { rows } = await db.query<{ id: string; publish_at: string }>(
        `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source)
         VALUES ($1, 'explainers', $2::date, $3, $4::timestamptz, 'scheduled', $5) RETURNING id, publish_at`,
        [itemId, choice.nyDate, choice.slot, choice.publishAt.toISOString(), source],
      );
      return { scheduled: true, id: rows[0]!.id, publishAt: new Date(rows[0]!.publish_at).toISOString() };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await active();
      if (raced) return { scheduled: true, id: raced.id, publishAt: new Date(raced.publish_at).toISOString() };
    }
  }
  return { scheduled: false, note: 'That window was just taken.' };
}

/**
 * Finished, unposted, unscheduled renders with their video in Storage: the
 * approved ones, oldest approval first; with require_approval off, also the
 * ones nobody reviewed (never a rejected one).
 */
export async function scheduleApproved(db: Queryable, now = new Date(), rng?: (count: number) => number): Promise<number> {
  const approvalNeeded = await requireApproval(db);
  const { rows } = await db.query<{ id: string }>(
    `SELECT j.id
       FROM explainers.jobs j
       LEFT JOIN explainers.feedback f ON f.job_id = j.id
       LEFT JOIN social_hub.content_items ci ON ci.vertical = 'explainers' AND ci.native_ref = j.id::text
       LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
      WHERE j.status = 'ok'
        AND (ap.decision = 'approved' OR (NOT $1::boolean AND ap.decision IS NULL))
        AND f.verdict IS DISTINCT FROM 'rejected'
        AND EXISTS (SELECT 1 FROM explainers.artifacts a WHERE a.job_id = j.id AND a.kind = 'video' AND a.storage_location = 'bucket')
        AND NOT EXISTS (SELECT 1 FROM social_hub.schedule s WHERE s.content_item_id = ci.id AND s.status IN ('scheduled', 'publishing', 'published'))
        AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts p WHERE p.content_item_id = ci.id AND p.status IN ('requested', 'creating', 'processing', 'publishing', 'published'))
      ORDER BY f.created_at NULLS LAST, j.finished_at`,
    [approvalNeeded],
  );
  let scheduled = 0;
  for (const row of rows) {
    const result = await scheduleJob(db, row.id, 'auto', now, rng);
    if (!result.scheduled) break;
    scheduled += 1;
  }
  return scheduled;
}

/** Due slots become publish attempts. A failing readiness check fails the slot, with the reason. */
export async function releaseDueSchedules(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string; job_id: string; source: string }>(
    `SELECT s.id, ci.native_ref AS job_id, s.source
       FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id
      WHERE s.vertical = 'explainers' AND s.status = 'scheduled' AND s.publish_at <= now()
      ORDER BY s.publish_at`,
  );
  let released = 0;
  for (const row of rows) {
    const claimed = await db.query(
      `UPDATE social_hub.schedule SET status = 'publishing' WHERE id = $1 AND status = 'scheduled' RETURNING id`,
      [row.id],
    );
    if (!claimed.rows[0]) continue;
    const result = await queuePublish(db, row.job_id, row.source === 'user' ? 'approve' : 'auto');
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
