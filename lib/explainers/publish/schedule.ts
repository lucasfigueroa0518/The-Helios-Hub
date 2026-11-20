import type { Queryable } from '@/lib/explainers/db';
import { holdsSlots, postsToInstagram, stateOf, type TypeState } from '@/lib/content-type/state';
import { holdApprovedWhilePaused, unslottedSql } from '@/lib/content-type/unslot';
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { chooseFromWindows, slotTakenKey, uniformIndex } from '@/lib/instagram/window';
import { explainerJobTarget } from '@/lib/explainers/lead';
import { POOL_ORDER_BY, REJECTED_SLOT_NOTE } from '@/lib/explainers/repository';
import { queueOrder } from '@/lib/social-hub/queue';
import type { IdeaAdjustment } from '@/lib/social-hub/views/moves';
import { slotPlan } from '@/lib/social-hub/slots';
import { chooseTemplateSlot } from '@/lib/social-hub/slots/scheduler';
import { bookSlot } from '@/lib/social-hub/spine';

import { DEFAULT_POSTS_PER_DAY, EXPLAINER_WINDOWS } from './config';
import { explainerItemId, spineOf, syncExplainerApproval } from './items';
import { queuePublish } from './publish';

/**
 * Up to `posts_per_day` explainers per Eastern day (default 2), one per
 * window (1:00–2:30 PM, 3:30–5:00 PM), each ≥ 30 minutes from any other
 * feed post (SH-46 – SH-48), on the lifecycle spine (D38). While
 * Explainers hold slots (Approval or Live, contract §4.3), every approved,
 * unposted render gets the next free window; a due slot becomes a publish
 * attempt only while Live (D16). Slots live on the lifecycle
 * spine (social_hub.schedule, vertical 'explainers', D36).
 */

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/**
 * Whether Explainers are Live (D16): approved reels go to Instagram only in the Live state. Read from the
 * `auto_render` and `publishing_live` rows; Generate off with Live on reads as paused (stateOf), so nothing is placed.
 */
export async function publishingLive(db: Queryable): Promise<boolean> {
  return postsToInstagram(await explainersState(db));
}

/** Explainers' state (D16): stateOf(auto_render, publishing_live). */
export async function explainersState(db: Queryable): Promise<TypeState> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM explainers.settings WHERE key IN ('auto_render', 'publishing_live')`,
  );
  const on = (key: string) => rows.some((row) => row.key === key && row.value === true);
  return stateOf(on('auto_render'), on('publishing_live')).state;
}

/** Whether Explainers book slots (contract §4.3): Approval and Live. A paused type holds none (D17). */
export async function explainersHoldsSlots(db: Queryable): Promise<boolean> {
  return holdsSlots(await explainersState(db));
}

/**
 * An approve while Explainers are Paused (D18, 2026-11-20): the render is held out of automatic placement
 * (scheduleApproved, the night fill), so it goes into a slot only when a person places it. Nothing while Explainers
 * hold slots: there Approve books as before. Used by the hub's Approve and the review page's (E-08).
 */
export async function holdApprovedRender(db: Queryable, jobId: string, now = new Date()): Promise<boolean> {
  if (await explainersHoldsSlots(db)) return false;
  return holdApprovedWhilePaused(spineOf(db), { vertical: 'explainers', itemId: await explainerItemId(db, jobId), now });
}

/**
 * Every post needs a person's approval (settings standard D16): `require_approval` is always true and is never read
 * as false. Kept async with its db argument for its callers.
 */
export async function requireApproval(_db: Queryable): Promise<boolean> {
  return true;
}

/** `posts_per_day` from explainers.settings (SH-48), else the default. */
export async function postsPerDay(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ value: unknown }>(`SELECT value FROM explainers.settings WHERE key = 'posts_per_day'`);
  const value = Number(rows[0]?.value);
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_POSTS_PER_DAY;
}

export type ScheduleOutcome = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string };

/**
 * The days a booking may use (Bald-Eagle D4, lib/social-hub/lead.ts). An explicit `fromDate` wins (the night placing a
 * surviving render on the date it fills). Otherwise a render made for a date still ahead books from that date, never
 * before it: a bounded booking (Approve, the finish booking: `throughDate` today) takes the target date only, an
 * unbounded one (scheduleApproved) the target date or later. A render with no target, or whose date has passed,
 * books as before: from today, through `throughDate`.
 */
export async function bookingDays(
  db: Queryable,
  jobId: string,
  now: Date,
  throughDate?: string,
  fromDate?: string,
): Promise<{ fromDate?: string; throughDate?: string }> {
  if (fromDate) return { fromDate, throughDate };
  const target = await explainerJobTarget(db, jobId);
  if (!target || target <= calendarDateKey(now, SOCIAL_TIMEZONE)) return { throughDate };
  return { fromDate: target, throughDate: throughDate === undefined ? undefined : throughDate > target ? throughDate : target };
}

/**
 * Book a render into the next free explainer window, or return its waiting
 * slot. `throughDate` (a New York day, YYYY-MM-DD) is the last day it may
 * book: Approve and the finish booking pass today (B1, B2); without it the
 * search runs two weeks ahead (the worker's scheduleApproved). `fromDate` is
 * the first (the 2 AM fill passes the date it fills). A render the night made
 * ahead books on its target date (bookingDays), never today's leftover window.
 */
export async function scheduleJob(
  db: Queryable,
  jobId: string,
  source: 'auto' | 'user',
  now = new Date(),
  throughDateIn?: string,
  rng: (count: number) => number = uniformIndex,
  fromDateIn?: string,
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
  const { fromDate, throughDate } = await bookingDays(db, jobId, now, throughDateIn, fromDateIn);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const spacing = (text: string, params?: unknown[]) => db.query<Record<string, unknown>>(text, params);
    const busy = [...(await busyFeedTimes(spacing, now, 'explainers')), ...(await ownFeedTimes(spacing, 'explainers', now))];
    // A failed slot read throws: it must not silently book by the old rules (ruling P2).
    const plan = await slotPlan(spacing, calendarDateKey(now));
    let choice: { nyDate: string; slot: string; publishAt: Date } | null;
    // Legacy books exactly as before (no feed_mode written; it reads as main).
    // Template: the mode of the slot chosen, from the plan in hand (no second read).
    let feedMode: 'trial' | 'main' | null = null;
    if (!plan) {
      const { rows: takenRows } = await db.query<{ d: string; slot: string }>(
        `SELECT ny_date::text AS d, slot FROM social_hub.schedule
          WHERE vertical = 'explainers' AND status IN ('scheduled', 'publishing', 'published') AND ny_date >= $1::date`,
        [calendarDateKey(now)],
      );
      const takenKeys = new Set(takenRows.map((r) => slotTakenKey(r.d, r.slot)));
      const windows = EXPLAINER_WINDOWS.slice(0, Math.max(1, Math.min(await postsPerDay(db), EXPLAINER_WINDOWS.length)));
      choice = chooseFromWindows(windows, now, takenKeys, busy, rng, throughDate, fromDate);
    } else {
      // The calendar: its slots within the daily cap (not posts_per_day), at [slot, slot + 15]; Main slots spaced from feed posts.
      const picked = await chooseTemplateSlot(spacing, plan, 'explainers', { now, busy, rng, throughDate, fromDate });
      choice = picked;
      feedMode = picked?.feedMode ?? null;
    }
    if (!choice) {
      const note = fromDate && throughDate === fromDate
        ? `No explainer window is open on ${fromDate}.`
        : throughDate ? `No explainer window is open through ${throughDate}.` : 'No explainer window is open in the next two weeks.';
      return { scheduled: false, note };
    }
    try {
      const booked = await bookSlot(spineOf(db), { vertical: 'explainers', itemId, nyDate: choice.nyDate, slot: choice.slot, publishAt: choice.publishAt, source, ...(feedMode ? { feedMode } : {}) });
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
 * B2: when the 2 AM run (trigger 'auto') finishes a render, it takes a window
 * on the date it was made for (Bald-Eagle D4: two days ahead; scheduleJob reads
 * its target date) as a system slot (source 'auto'), unapproved: it still
 * needs Approve, and without one releaseDueSchedules cancels it at its time.
 * That date only (a render with no target date: today only); nothing left
 * there books nothing. A person's render
 * (Regenerate, Make it) waits for Approve, which books it. Only in Approval
 * or Live (holdsSlots), like every other booking. Booking only, never
 * queuePublish. Null: not booked by rule.
 */
export async function bookFinishedRender(
  db: Queryable,
  job: { id: string; trigger: string },
  now = new Date(),
  rng?: (count: number) => number,
): Promise<ScheduleOutcome | null> {
  if (job.trigger !== 'auto') return null;
  if (!(await explainersHoldsSlots(db))) return null;
  return scheduleJob(db, job.id, 'auto', now, calendarDateKey(now, SOCIAL_TIMEZONE), rng);
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
   AND NOT EXISTS (SELECT 1 FROM explainers.topics ta WHERE ta.id = j.topic_id AND ta.status = 'archived')
   AND (ap.decision = 'approved' OR (NOT $1::boolean AND ap.decision IS NULL))
   AND f.verdict IS DISTINCT FROM 'rejected'
   AND EXISTS (SELECT 1 FROM explainers.artifacts a WHERE a.job_id = j.id AND a.kind = 'video' AND a.storage_location = 'bucket')
   AND NOT EXISTS (SELECT 1 FROM social_hub.schedule s WHERE s.content_item_id = ci.id AND s.status IN ('scheduled', 'publishing', 'published'))
   AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts p WHERE p.content_item_id = ci.id AND p.status IN ('requested', 'creating', 'processing', 'publishing', 'published'))
   -- Back in Made (D17, D18): a render unslotted by Pause or a passed slot stays approved but is never re-slotted here.
   AND NOT ${unslottedSql('ci.id')}`;

/**
 * Finished, unposted, unscheduled renders with their video in Storage: the
 * approved ones, oldest approval first; with require_approval off, also the
 * ones nobody reviewed (never a rejected one). A render made for a date still
 * ahead books on that date or later (bookingDays).
 */
export async function scheduleApproved(db: Queryable, now = new Date(), rng?: (count: number) => number): Promise<number> {
  const approvalNeeded = await requireApproval(db);
  const { rows } = await db.query<{ id: string }>(
    `SELECT r.id FROM (${PLACEABLE_RENDERS}) r ORDER BY r.reviewed_at NULLS LAST, r.finished_at`,
    [approvalNeeded],
  );
  let scheduled = 0;
  for (const row of rows) {
    const result = await scheduleJob(db, row.id, 'auto', now, undefined, rng);
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
export async function fillCandidates(db: Queryable, approvalNeeded: boolean, moves: readonly IdeaAdjustment[] = []): Promise<FillCandidate[]> {
  const { rows } = await db.query<{ topic_id: string; title: string; job_id: string | null; score: string | null; below_gate: boolean }>(
    `WITH placeable AS (${PLACEABLE_RENDERS}),
     newest AS (
       SELECT DISTINCT ON (topic_id) id, topic_id FROM explainers.jobs
        WHERE status = 'ok'
        ORDER BY topic_id, finished_at DESC NULLS LAST, seq DESC)
     SELECT c.id::text AS topic_id, c.title, c.job_id, c.weighted_score::text AS score,
            COALESCE(c.jev_notes->'seed_flags' @> '"below_gate"'::jsonb, false) AS below_gate FROM (
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
  // The queue decides (pool standard, 2026-10-21): pinned topics first, then by score or where a drag left them,
  // archived ones gone. The query's order (POOL_ORDER_BY) breaks ties.
  const items = rows.map((r) => ({ id: `explainers:topic:${r.topic_id}`, score: r.score == null ? null : Number(r.score), row: r }));
  // A seed that fell below a quality gate is the person's to make (Make it, or a pin): the night skips it unless it is pinned.
  return queueOrder(items, moves.filter((m) => m.vertical === 'explainers'))
    .filter((q) => !q.item.row.below_gate || q.pinned)
    .map((q) => ({ topicId: q.item.row.topic_id, title: q.item.row.title, jobId: q.item.row.job_id }));
}

/** The note on a slot cancelled because nobody approved its render in time (B3; carousels and reels say the same). */
export const NOT_APPROVED_NOTE = 'Nobody approved this explainer before its slot, so it was not posted.';

/**
 * Due slots become publish attempts (B3, like carousels and reels): a
 * rejected render's slot is cancelled (a rejection in either place wins,
 * D41); with require_approval on (the default), so is one nobody approved.
 * Only the rest reach queuePublish, whose readiness check stays as a second
 * guard and fails the slot, with the reason.
 */
export async function releaseDueSchedules(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string; job_id: string; source: string; decision: string | null }>(
    `SELECT s.id, ci.native_ref AS job_id, s.source,
            CASE WHEN f.verdict = 'rejected' OR ap.decision = 'rejected' THEN 'rejected' ELSE ap.decision END AS decision
       FROM social_hub.schedule s
       JOIN social_hub.content_items ci ON ci.id = s.content_item_id
       LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
       LEFT JOIN explainers.feedback f ON f.job_id::text = ci.native_ref
      WHERE s.vertical = 'explainers' AND s.status = 'scheduled' AND s.publish_at <= now()
      ORDER BY s.publish_at`,
  );
  const cancel = (id: string, note: string) =>
    db.query(`UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE id = $1 AND status = 'scheduled'`, [id, note]);
  const approvalNeeded = rows.some((row) => row.decision !== 'approved') && (await requireApproval(db));
  let released = 0;
  for (const row of rows) {
    if (row.decision === 'rejected') {
      await cancel(row.id, REJECTED_SLOT_NOTE);
      continue;
    }
    if (approvalNeeded && row.decision !== 'approved') {
      await cancel(row.id, NOT_APPROVED_NOTE);
      continue;
    }
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

export const UNSCHEDULED_NOTE = 'Taken off the calendar by a person (unscheduled). It is not approved any more.';

/**
 * Take a render off the calendar (the hub's Unschedule): its waiting slot is
 * cancelled and its approval withdrawn, so it is "made, waiting for a person"
 * again. Both matter: an approved render with no slot is booked again by the
 * worker (`scheduleApproved`), so cancelling the slot alone would not hold.
 * A rejection stays a rejection. A render that is posting, or posted, cannot
 * be unscheduled.
 */
export async function unscheduleJob(db: Queryable, jobId: string): Promise<{ ok: boolean; note: string }> {
  const itemId = await explainerItemId(db, jobId);
  if (!itemId) return { ok: false, note: 'The render is gone.' };
  const { rows: busy } = await db.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM social_hub.schedule WHERE content_item_id = $1 AND status = 'publishing')
          + (SELECT count(*) FROM social_hub.publish_attempts WHERE content_item_id = $1 AND status IN ('requested', 'creating', 'processing', 'publishing', 'published')) AS n`,
    [itemId],
  );
  if (Number(busy[0]?.n ?? 0) > 0) return { ok: false, note: 'It is posting, or has already posted, so it can’t be unscheduled.' };
  const cancelled = await db.query<{ id: string }>(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE content_item_id = $1 AND status = 'scheduled' RETURNING id`,
    [itemId, UNSCHEDULED_NOTE],
  );
  // Withdraw an approval (the review verdict and the spine's copy of it); a rejection is left alone.
  await db.query(`DELETE FROM explainers.feedback WHERE job_id = $1 AND verdict = 'approved'`, [jobId]);
  await syncExplainerApproval(db, jobId);
  return cancelled.rows.length
    ? { ok: true, note: 'Unscheduled. It is not approved any more, so it will not be booked again until you approve it.' }
    : { ok: true, note: 'It had no slot. Its approval is withdrawn.' };
}
