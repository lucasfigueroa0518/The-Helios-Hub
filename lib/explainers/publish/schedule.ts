import type { Queryable } from '@/lib/explainers/db';
import { calendarDateKey } from '@/lib/instagram/clock';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { chooseFromWindows, slotTakenKey, uniformIndex } from '@/lib/instagram/window';
import { POOL_ORDER_BY } from '@/lib/explainers/repository';
import { bookSlot } from '@/lib/social-hub/spine';

import { DEFAULT_POSTS_PER_DAY, EXPLAINER_WINDOWS } from './config';
import { explainerItemId, spineOf } from './items';
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
      const booked = await bookSlot(spineOf(db), { vertical: 'explainers', itemId, nyDate: choice.nyDate, slot: choice.slot, publishAt: choice.publishAt, source });
      return { scheduled: true, id: booked.id, publishAt: booked.publishAt };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await active();
      if (raced) return { scheduled: true, id: raced.id, publishAt: new Date(raced.publish_at).toISOString() };
    }
  }
  return { scheduled: false, note: 'That window was just taken.' };
}

/**
 * Finished, unposted, unscheduled renders with their video in Storage that
 * may go on the calendar: the approved ones; with require_approval off
 * (`$1` false), also the ones nobody reviewed (never a rejected one).
 * Shared by `scheduleApproved` and the 2 AM daily fill (`fillCandidates`).
 */
const PLACEABLE_RENDERS = `
SELECT j.id, j.topic_id, f.created_at AS reviewed_at, j.finished_at
  FROM explainers.jobs j
  LEFT JOIN explainers.feedback f ON f.job_id = j.id
  LEFT JOIN social_hub.content_items ci ON ci.vertical = 'explainers' AND ci.native_ref = j.id::text
  LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
 WHERE j.status = 'ok'
   AND (ap.decision = 'approved' OR (NOT $1::boolean AND ap.decision IS NULL))
   AND f.verdict IS DISTINCT FROM 'rejected'
   AND EXISTS (SELECT 1 FROM explainers.artifacts a WHERE a.job_id = j.id AND a.kind = 'video' AND a.storage_location = 'bucket')
   AND NOT EXISTS (SELECT 1 FROM social_hub.schedule s WHERE s.content_item_id = ci.id AND s.status IN ('scheduled', 'publishing', 'published'))
   AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts p WHERE p.content_item_id = ci.id AND p.status IN ('requested', 'creating', 'processing', 'publishing', 'published'))`;

/**
 * Finished, unposted, unscheduled renders with their video in Storage: the
 * approved ones, oldest approval first; with require_approval off, also the
 * ones nobody reviewed (never a rejected one).
 */
export async function scheduleApproved(db: Queryable, now = new Date(), rng?: (count: number) => number): Promise<number> {
  const approvalNeeded = await requireApproval(db);
  const { rows } = await db.query<{ id: string }>(
    `SELECT r.id FROM (${PLACEABLE_RENDERS}) r ORDER BY r.reviewed_at NULLS LAST, r.finished_at`,
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

/** One candidate for the night's slots (daily fill, D54): a pool topic, or a topic whose render survives. */
export type FillCandidate = { topicId: string; title: string; /** The surviving render; null for a fresh pool topic. */ jobId: string | null };

/**
 * The 2 AM daily fill's candidates (D54), best first by the pool's own order
 * (POOL_ORDER_BY): every pool topic, and every rendered topic whose newest
 * finished render is placeable (approved, or unreviewed with require_approval
 * off; video in Storage; no slot, no try) and none of whose renders has
 * posted. The cycle renders a pool topic it picks; it places a surviving
 * render instead of rendering its topic again.
 */
export async function fillCandidates(db: Queryable, approvalNeeded: boolean): Promise<FillCandidate[]> {
  const { rows } = await db.query<{ topic_id: string; title: string; job_id: string | null }>(
    `WITH placeable AS (${PLACEABLE_RENDERS}),
     newest AS (
       SELECT DISTINCT ON (topic_id) id, topic_id FROM explainers.jobs
        WHERE status = 'ok'
        ORDER BY topic_id, finished_at DESC NULLS LAST, seq DESC)
     SELECT c.id::text AS topic_id, c.title, c.job_id FROM (
       SELECT t.*, n.id::text AS job_id
         FROM explainers.topics t
         LEFT JOIN newest n ON n.topic_id = t.id AND t.status = 'rendered' AND n.id IN (SELECT id FROM placeable)
        WHERE t.status = 'pool'
           OR (n.id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM explainers.jobs j2
                                 JOIN social_hub.content_items ci2 ON ci2.vertical = 'explainers' AND ci2.native_ref = j2.id::text
                                 JOIN social_hub.publish_attempts pa ON pa.content_item_id = ci2.id
                                WHERE j2.topic_id = t.id AND pa.status = 'published'))
     ) c
     ORDER BY ${POOL_ORDER_BY}`,
    [approvalNeeded],
  );
  return rows.map((r) => ({ topicId: r.topic_id, title: r.title, jobId: r.job_id }));
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
