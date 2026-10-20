import { dbQuery } from '@/lib/db';
import { queuePublish, publishReadiness, type PublishTrigger } from '@/lib/reels/music/publish';
import { getSetting } from '@/lib/reels/music/store';
import { calendarDateKey } from '@/lib/reels/schedule';
import { REEL_SCHEDULE } from '@/lib/reels/spine-tables';
import { approveReel, reelItemId, reelsSpine } from '@/lib/reels/publish/items';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { slotTakenKey } from '@/lib/instagram/window';
import { bookingFeedMode, feedModeKeys, nonSlotKeys, slotPlan, slotsOn, type SlotPlan } from '@/lib/social-hub/slots';
import { chooseByFeedMode } from '@/lib/social-hub/slots/choose';
import type { FeedMode } from '@/lib/social-hub/slots/types';
import { bookSlot } from '@/lib/social-hub/spine';
import {
  chooseSlot,
  openMinuteRange,
  POSTING_SLOTS,
  POSTING_TIME_ZONE,
  slotKey,
  slotLabel,
  uniformIndex,
  type SlotId,
} from '@/lib/reels/publish/slots';

/**
 * One reel per posting slot per Eastern day. The nightly run fills the slots
 * only while publishing is live. A person can schedule a reel into the next
 * open slot either way. Force post does not use a slot.
 *
 * Slots live on the lifecycle spine (social_hub.schedule, vertical 'reels',
 * D39). A slot belongs to the post idea (idea_ref) and gets its video's item
 * when the video is attached. Its approval (approved_at) is the slot's; it is
 * carried onto the video's item when the slot posts it.
 */

export type ScheduleStatus = 'scheduled' | 'publishing' | 'published' | 'cancelled' | 'failed';
export type ScheduleSource = 'auto' | 'user';

export type StoredSchedule = {
  id: string;
  postIdeaId: string;
  videoJobId: string | null;
  nyDate: string;
  slot: SlotId;
  publishAt: string;
  status: ScheduleStatus;
  source: ScheduleSource;
  /** Trial or Main feed, from the booking (weekly slot calendar); set where a note is written. */
  feedMode?: FeedMode;
};

export type ScheduleOutcome =
  | { scheduled: true; schedule: StoredSchedule; note: string }
  | { scheduled: false; status: number; note: string };

type ScheduleRow = {
  id: string;
  post_idea_id: string;
  video_job_id: string | null;
  ny_date: string;
  slot: SlotId;
  publish_at: string;
  status: ScheduleStatus;
  source: ScheduleSource;
};

function toSchedule(row: ScheduleRow): StoredSchedule {
  return {
    id: row.id,
    postIdeaId: row.post_idea_id,
    videoJobId: row.video_job_id,
    nyDate: row.ny_date,
    slot: row.slot,
    publishAt: new Date(row.publish_at).toISOString(),
    status: row.status,
    source: row.source,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export function formatPublishAt(iso: string): string {
  const when = new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${when} ET`;
}

function scheduleNote(schedule: StoredSchedule): string {
  const feed = schedule.feedMode === 'main' ? ' It posts to the main feed.' : ' It posts as a trial reel.';
  return `Scheduled for ${formatPublishAt(schedule.publishAt)} (${slotLabel(schedule.slot)}).${feed}`;
}

/** The app pool as a slot / spacing query handle. */
const hubQ = (text: string, params?: unknown[]) => dbQuery(text, params) as Promise<{ rows: any[] }>;

/**
 * The booking's Trial / Main feed. Read on its own, not in SCHEDULE_COLUMNS:
 * bookingFeedMode falls back to trial on a database without the feed_mode
 * column, so the legacy path keeps working there.
 */
async function withFeedMode(schedule: StoredSchedule): Promise<StoredSchedule> {
  return { ...schedule, feedMode: await bookingFeedMode(hubQ, null, 'reels', schedule.postIdeaId) };
}

async function outcome(schedule: StoredSchedule): Promise<ScheduleOutcome> {
  const withMode = await withFeedMode(schedule);
  return { scheduled: true, schedule: withMode, note: scheduleNote(withMode) };
}

/** Live is the switch for the nightly auto-schedule. Off until it is turned on. */
export async function publishingLive(): Promise<boolean> {
  return (await getSetting<boolean>('publishing_live')) === true;
}

/**
 * Every content type needs a person's approval before it posts (docs/social-overnight.md).
 * On unless the setting says false. An auto-scheduled reel then posts only once approved.
 */
export async function requireApproval(): Promise<boolean> {
  return (await getSetting<boolean>('require_approval')) !== false;
}

export const NOT_APPROVED_NOTE = 'Nobody approved this reel before its slot, so it was not posted.';
export const REJECTED_NOTE = 'This reel was rejected, so it was not posted.';

const SCHEDULE_COLUMNS = `id, post_idea_id, video_job_id, ny_date::text AS ny_date, slot, publish_at, status, source`;

async function activeSchedule(postIdeaId: string): Promise<StoredSchedule | null> {
  const { rows } = await dbQuery<ScheduleRow>(
    `SELECT ${SCHEDULE_COLUMNS}
       FROM ${REEL_SCHEDULE} s
      WHERE post_idea_id = $1 AND status IN ('scheduled', 'publishing')
      ORDER BY created_at DESC
      LIMIT 1`,
    [postIdeaId],
  );
  return rows[0] ? toSchedule(rows[0]) : null;
}

async function scheduleById(id: string): Promise<StoredSchedule> {
  const { rows } = await dbQuery<ScheduleRow>(`SELECT ${SCHEDULE_COLUMNS} FROM ${REEL_SCHEDULE} s WHERE id = $1`, [id]);
  return toSchedule(rows[0]!);
}

async function takenSlots(fromDate: string): Promise<Set<string>> {
  const { rows } = await dbQuery<{ ny_date: string; slot: SlotId }>(
    `SELECT ny_date::text AS ny_date, slot
       FROM social_hub.schedule
      WHERE vertical = 'reels'
        AND status IN ('scheduled', 'publishing', 'published')
        AND ny_date >= $1::date`,
    [fromDate],
  );
  return new Set(rows.map((row) => slotKey(row.ny_date, row.slot)));
}

/** A reels `slotKey` (`date:slot`) in the shared window format (`slotTakenKey`, `date|slot`). Dates have no colon. */
export function toTakenKey(reelsKey: string): string {
  const at = reelsKey.indexOf(':');
  return slotTakenKey(reelsKey.slice(0, at), reelsKey.slice(at + 1));
}

/** Template mode: every reels window that is not a slot counts as taken, in the caller's key format. */
export function reelTaken(plan: SlotPlan, base: ReadonlySet<string>, key: (nyDate: string, slot: string) => string): Set<string> {
  return new Set([...base, ...nonSlotKeys(plan, 'reels', POSTING_SLOTS.map((s) => s.id), key)]);
}

/**
 * Reserve the earliest window that has not ended. `throughDate` limits the
 * search to that Eastern calendar day. A reel that already has a clock time
 * keeps it.
 */
export async function schedulePostIdea(
  postIdeaId: string,
  source: ScheduleSource,
  videoJobId: string | null,
  now = new Date(),
  throughDate?: string,
): Promise<ScheduleOutcome> {
  const existing = await activeSchedule(postIdeaId);
  if (existing) {
    // A person scheduling a reel the night already put on the clock approves that slot.
    if (source === 'user') {
      await dbQuery(`UPDATE social_hub.schedule SET approved_at = coalesce(approved_at, now()) WHERE id = $1`, [existing.id]);
      const video = videoJobId ?? existing.videoJobId;
      if (video) await approveReel(video, 'user');
    }
    return outcome(existing);
  }
  const itemId = videoJobId ? await reelItemId(videoJobId) : null;
  if (source === 'user' && videoJobId) await approveReel(videoJobId, 'user');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fromDate = calendarDateKey(now);
    // A failed slot read throws: it must not silently book by the old rules (ruling P2).
    const plan = await slotPlan(hubQ, fromDate);
    const takenNow = await takenSlots(fromDate);
    let choice: { nyDate: string; slot: SlotId; publishAt: Date } | null;
    if (!plan) {
      // Trial Reels are exempt from the cross-type feed spacing (D33 revises SH-47).
      choice = chooseSlot(now, takenNow, uniformIndex, POSTING_TIME_ZONE, throughDate);
    } else {
      // The calendar: only its slots, and Main slots space against feed posts.
      const taken = reelTaken(plan, new Set([...takenNow].map(toTakenKey)), slotTakenKey);
      const busy = [...(await busyFeedTimes(hubQ, now, 'reels')), ...(await ownFeedTimes(hubQ, 'reels', now))];
      const picked = chooseByFeedMode(POSTING_SLOTS, now, taken, feedModeKeys(plan, 'reels', slotTakenKey), busy, uniformIndex, throughDate);
      choice = picked ? { nyDate: picked.nyDate, slot: picked.slot as SlotId, publishAt: picked.publishAt } : null;
    }
    if (!choice) {
      const note = throughDate
        ? 'No posting window is still open today.'
        : 'No posting slot is open in the next two weeks.';
      return { scheduled: false, status: 409, note };
    }
    // Template: the mode of the slot chosen, from the plan in hand (no second read).
    const feedMode = plan ? (slotsOn(plan, 'reels', choice.nyDate).find((s) => s.windowId === choice.slot)?.feedMode ?? null) : null;
    try {
      const booked = await bookSlot(reelsSpine, {
        vertical: 'reels',
        itemId,
        ideaRef: postIdeaId,
        nyDate: choice.nyDate,
        slot: choice.slot,
        publishAt: choice.publishAt,
        source,
        approved: source === 'user',
        // Legacy books exactly as before (no feed_mode written; it reads as trial).
        ...(feedMode ? { feedMode } : {}),
      });
      return outcome(await scheduleById(booked.id));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await activeSchedule(postIdeaId);
      if (raced) return outcome(raced);
    }
  }
  return { scheduled: false, status: 409, note: 'That slot was just taken. Try again.' };
}

export const BENCH_SCHEDULE_NOTE =
  'Only the reels selected for today go on the clock. The rest stay on the bench.';

export const MISSED_TODAY_NOTE =
  'This reel missed today’s windows. It carries to tomorrow at its score, instead of being scheduled late.';

/** True when this idea was selected for today's reels. Rank alone leaves it on the bench. */
export function isPostingRank(selected: boolean): boolean {
  return selected;
}

async function selectedOnDate(postIdeaId: string, nyDate: string): Promise<boolean> {
  const { rows } = await dbQuery<{ selected: boolean }>(
    `SELECT s.selected
       FROM reels.idea_scores s
       JOIN reels.score_slates sl ON sl.id = s.slate_id
      WHERE s.post_idea_id = $1::uuid
        AND sl.ny_date = $2::date
      ORDER BY sl.scored_at DESC
      LIMIT 1`,
    [postIdeaId, nyDate],
  );
  return rows[0]?.selected === true;
}

/** How many of today's windows can still take a reel. A started window counts until it ends. */
export async function windowsStillOpen(now = new Date()): Promise<number> {
  const today = calendarDateKey(now);
  const taken = await takenSlots(today);
  // Template mode: only today's reels slots count.
  // A failed slot read throws: it must not silently book by the old rules (ruling P2).
  const plan = await slotPlan(hubQ, today, 1);
  const on = plan ? new Set(slotsOn(plan, 'reels', today).map((s) => s.windowId)) : null;
  const slots = on ? POSTING_SLOTS.filter((slot) => on.has(slot.id)) : POSTING_SLOTS;
  return slots.filter(
    (slot) => !taken.has(slotKey(today, slot.id)) && openMinuteRange(today, slot.id, now) != null,
  ).length;
}

/**
 * A person can put one of today's selected reels into a window still open
 * today. The bench is not scheduled. A day with no window left is a miss,
 * not a tomorrow slot.
 */
export async function scheduleVideo(videoJobId: string, now = new Date()): Promise<ScheduleOutcome> {
  const ready = await publishReadiness(videoJobId);
  if (!ready.ok) return { scheduled: false, status: ready.status, note: ready.note };
  const today = calendarDateKey(now);
  const selected = await selectedOnDate(ready.postIdeaId, today);
  if (!isPostingRank(selected)) {
    return { scheduled: false, status: 409, note: BENCH_SCHEDULE_NOTE };
  }
  const result = await schedulePostIdea(ready.postIdeaId, 'user', videoJobId, now, today);
  if (!result.scheduled && result.note === 'No posting window is still open today.') {
    return { scheduled: false, status: result.status, note: MISSED_TODAY_NOTE };
  }
  return result;
}

/**
 * The reels selected for this slate, best rank first, one per window still
 * open on that slate's Eastern day. A later reel is not scheduled once the
 * day has no window left. Does nothing while publishing is not live.
 */
export async function scheduleSelectedSlate(slateId: string, now = new Date()): Promise<{ scheduled: number }> {
  if (!(await publishingLive())) return { scheduled: 0 };
  const { rows } = await dbQuery<{ post_idea_id: string; ny_date: string }>(
    `SELECT s.post_idea_id, sl.ny_date::text AS ny_date
       FROM reels.idea_scores s
       JOIN reels.score_slates sl ON sl.id = s.slate_id
      WHERE s.slate_id = $1
        AND s.selected
        AND NOT EXISTS (
          SELECT 1 FROM reels.published_status p
           WHERE p.post_idea_id = s.post_idea_id AND p.published
        )
      ORDER BY s.rank NULLS LAST`,
    [slateId],
  );
  const nyDate = rows[0]?.ny_date;
  let scheduled = 0;
  for (const row of rows) {
    const result = await schedulePostIdea(row.post_idea_id, 'auto', null, now, nyDate);
    if (result.scheduled) scheduled += 1;
  }
  return { scheduled };
}

/** Today's latest slate, when Live is switched on after the night has already run. */
export async function scheduleLatestToday(now = new Date()): Promise<{ scheduled: number }> {
  const { rows } = await dbQuery<{ id: string }>(
    `SELECT id FROM reels.score_slates
      WHERE ny_date = $1::date
      ORDER BY scored_at DESC
      LIMIT 1`,
    [calendarDateKey(now)],
  );
  const id = rows[0]?.id;
  if (!id) return { scheduled: 0 };
  return scheduleSelectedSlate(id, now);
}

async function readyVideo(postIdeaId: string, videoJobId: string | null): Promise<string | null> {
  const { rows } = await dbQuery<{ id: string }>(
    `SELECT v.id
       FROM reels.video_jobs v
      WHERE v.status = 'ok'
        AND v.video_storage_path IS NOT NULL
        AND ($2::uuid IS NULL OR v.id = $2)
        AND v.post_idea_id = $1
        AND EXISTS (
          SELECT 1 FROM reels.song_picks p
           WHERE p.video_job_id = v.id AND p.status = 'ok'
        )
        AND EXISTS (
          SELECT 1 FROM reels.idea_copy c
           WHERE c.post_idea_id = v.post_idea_id AND c.slate_id = v.slate_id AND c.status = 'ok'
        )
      ORDER BY v.finished_at DESC NULLS LAST
      LIMIT 1`,
    [postIdeaId, videoJobId],
  );
  return rows[0]?.id ?? null;
}

/** A failed try waits this long before its one retry (Instagram or Storage hiccups usually pass). */
export const RETRY_AFTER_MINUTES = 4;

/**
 * Errors a retry cannot fix, or must not repeat: a rejection, a caption the
 * gate refuses, a missing video, and a worker that died mid-post (it may have
 * posted; a person checks Instagram first).
 */
const NO_RETRY_ERROR = /rejected|caption still has|video for this reel is gone|worker stopped|no finished video|no caption|already published/i;

export function retryableError(error: string | null): boolean {
  return !NO_RETRY_ERROR.test(error ?? '');
}

/**
 * One bounded retry for a slot whose post failed cleanly (D41's clean failure):
 * the attempt never reached Instagram (no container, no media id), it is the
 * item's only try, the failure is at least RETRY_AFTER_MINUTES old, and the
 * slot's window has not ended. The slot goes back to 'scheduled' (its time is
 * past, so the next release queues a new attempt). A slot taken again in the
 * meantime, or a second failure, stays failed. Returns how many were reopened.
 */
export async function retryFailedSlots(now = new Date()): Promise<number> {
  const { rows } = await dbQuery<{ id: string; ny_date: string; slot: SlotId; error: string | null }>(
    `SELECT s.id::text AS id, s.ny_date::text AS ny_date, s.slot, a.error
       FROM social_hub.schedule s
       JOIN social_hub.publish_attempts a ON a.id = s.publish_attempt_id
      WHERE s.vertical = 'reels' AND s.status = 'failed'
        AND a.status = 'failed' AND a.container_id IS NULL AND a.media_id IS NULL
        AND a.finished_at IS NOT NULL
        AND a.finished_at <= $1::timestamptz - ($2::int * interval '1 minute')
        AND (SELECT count(*) FROM social_hub.publish_attempts t
              WHERE t.content_item_id = a.content_item_id AND t.trigger <> 'mix_test') = 1`,
    [now.toISOString(), RETRY_AFTER_MINUTES],
  );
  let reopened = 0;
  for (const row of rows) {
    if (!retryableError(row.error)) continue;
    if (openMinuteRange(row.ny_date, row.slot, now) == null) continue;
    try {
      const done = await dbQuery(
        `UPDATE social_hub.schedule SET status = 'scheduled', error = NULL, publish_attempt_id = NULL
          WHERE id = $1::uuid AND status = 'failed'`,
        [row.id],
      );
      reopened += done.rowCount ?? 0;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return reopened;
}

/**
 * A due slot becomes a normal publish attempt. The worker then posts it as a
 * trial reel. A reel that is not finished yet stays on the clock.
 */
export async function releaseDueSchedules(): Promise<number> {
  await retryFailedSlots().catch(() => 0);
  const { rows } = await dbQuery<{
    id: string;
    post_idea_id: string;
    video_job_id: string | null;
    source: ScheduleSource;
    approved_at: string | null;
    decision: 'approved' | 'rejected' | null;
  }>(
    `SELECT s.id, s.post_idea_id, s.video_job_id, s.source, s.approved_at, ap.decision
       FROM ${REEL_SCHEDULE} s
       LEFT JOIN social_hub.approvals ap ON ap.content_item_id = s.content_item_id
      WHERE s.status = 'scheduled' AND s.publish_at <= now()
      ORDER BY s.publish_at`,
  );
  const approved = (row: (typeof rows)[number]) => Boolean(row.approved_at) || row.decision === 'approved';
  const approvalNeeded = rows.some((row) => !approved(row)) && (await requireApproval());
  let released = 0;
  for (const row of rows) {
    const refusal = row.decision === 'rejected' ? REJECTED_NOTE : approvalNeeded && !approved(row) ? NOT_APPROVED_NOTE : null;
    if (refusal) {
      await dbQuery(
        `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE id = $1 AND status = 'scheduled'`,
        [row.id, refusal],
      );
      continue;
    }
    const videoId = await readyVideo(row.post_idea_id, row.video_job_id);
    if (!videoId) continue;
    const itemId = await reelItemId(videoId);
    const claimed = await dbQuery<{ id: string }>(
      `UPDATE social_hub.schedule
          SET status = 'publishing', content_item_id = $2
        WHERE id = $1 AND status = 'scheduled'
        RETURNING id`,
      [row.id, itemId],
    );
    if (!claimed.rows[0]) continue;
    // The slot's approval belongs to the video it now posts (D39).
    if (row.approved_at) await approveReel(videoId, 'user');
    const trigger: PublishTrigger = row.source === 'user' ? 'approve' : 'auto';
    let result: Awaited<ReturnType<typeof queuePublish>>;
    try {
      result = await queuePublish(videoId, trigger);
    } catch (error) {
      await dbQuery(
        `UPDATE social_hub.schedule SET status = 'scheduled', error = $2 WHERE id = $1 AND status = 'publishing'`,
        [row.id, error instanceof Error ? error.message : String(error)],
      );
      continue;
    }
    if (result.queued) {
      await dbQuery(
        `UPDATE social_hub.schedule SET publish_attempt_id = $2 WHERE id = $1`,
        [row.id, result.id],
      );
      released += 1;
      continue;
    }
    if (result.terminal) {
      await dbQuery(
        `UPDATE social_hub.schedule
            SET status = 'failed', error = $2, publish_attempt_id = COALESCE($3, publish_attempt_id)
          WHERE id = $1 AND status = 'publishing'`,
        [row.id, result.note, result.id ?? null],
      );
      continue;
    }
    if (result.note.includes('already published')) {
      await dbQuery(
        `UPDATE social_hub.schedule SET status = 'published', error = NULL WHERE id = $1`,
        [row.id],
      );
      continue;
    }
    if (result.note.includes('already publishing')) continue;
    await dbQuery(
      `UPDATE social_hub.schedule
          SET status = 'scheduled', error = $2
        WHERE id = $1 AND status = 'publishing'`,
      [row.id, result.note],
    );
  }
  return released;
}

/**
 * A person rejects a trial reel (Social Hub Reject, D47): its video is
 * rejected on the spine, and the idea's waiting slot is cancelled with the
 * reason. A reel with no video yet just loses its slot.
 */
export async function rejectReel(postIdeaId: string, videoJobId: string | null, by: string | null): Promise<{ rejected: boolean; note: string }> {
  const { rejectReelItem } = await import('@/lib/reels/publish/items');
  if (videoJobId) await rejectReelItem(videoJobId, by);
  const { rows } = await dbQuery(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $2
      WHERE vertical = 'reels' AND idea_ref = $1 AND status = 'scheduled' RETURNING id`,
    [postIdeaId, REJECTED_NOTE],
  );
  if (!videoJobId && rows.length === 0) return { rejected: false, note: 'Nothing is waiting to post for this idea.' };
  return { rejected: true, note: 'Rejected. It will not post.' };
}

/** Drop a clock time so Force post does not also fire when the slot arrives. */
export async function cancelScheduledPost(postIdeaId: string): Promise<void> {
  await dbQuery(
    `UPDATE social_hub.schedule
        SET status = 'cancelled'
      WHERE vertical = 'reels' AND idea_ref = $1 AND status = 'scheduled'`,
    [postIdeaId],
  );
}

export async function markScheduleForAttempt(
  attemptId: string,
  status: 'published' | 'failed',
  error: string | null,
): Promise<void> {
  await dbQuery(
    `UPDATE social_hub.schedule
        SET status = $2, error = $3
      WHERE publish_attempt_id = $1 AND status = 'publishing'`,
    [attemptId, status, error],
  );
}

/** Latest clock time for each idea, preferring one that is still ahead. */
export async function loadSchedulesForIdeas(postIdeaIds: string[]): Promise<Record<string, StoredSchedule>> {
  if (postIdeaIds.length === 0) return {};
  const { rows } = await dbQuery<ScheduleRow>(
    `SELECT DISTINCT ON (post_idea_id)
            id, post_idea_id, video_job_id, ny_date::text AS ny_date, slot, publish_at, status, source
       FROM ${REEL_SCHEDULE} s
      WHERE post_idea_id = ANY($1::uuid[])
        AND status IN ('scheduled', 'publishing', 'published', 'failed')
      ORDER BY post_idea_id,
               CASE status WHEN 'publishing' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
               created_at DESC`,
    [postIdeaIds],
  );
  const out: Record<string, StoredSchedule> = {};
  for (const row of rows) out[row.post_idea_id] = toSchedule(row);
  return out;
}

/**
 * Force post (the /reels Force button, also the Social Hub's Hard publish):
 * post now as a trial reel, skipping the slot. The same three steps as the
 * force branch of POST /api/reels/publish, in one place.
 */
export async function forcePost(videoJobId: string): Promise<{ queued: true; id: string; note: string } | { queued: false; status: number; note: string }> {
  const ready = await publishReadiness(videoJobId, { trigger: 'force' });
  if (!ready.ok) return { queued: false, status: ready.status, note: ready.note };
  await cancelScheduledPost(ready.postIdeaId);
  // Force post is a person's click: it counts as approval (SH-17).
  await approveReel(videoJobId, 'force');
  const result = await queuePublish(videoJobId, 'force');
  if (!result.queued) return { queued: false, status: result.status, note: result.note };
  return { queued: true, id: result.id, note: 'Posting to Instagram now as a trial reel.' };
}

export const UNSCHEDULED_NOTE = 'Taken off the calendar by a person (unscheduled). It is not approved any more.';

/**
 * Take a reel's slot off the calendar (the hub's Unschedule): the idea's
 * waiting slot is cancelled and the slot's and the video's approval withdrawn.
 * A reel that is posting can't be unscheduled.
 */
export async function unscheduleIdea(postIdeaId: string): Promise<{ ok: boolean; note: string }> {
  const { rows } = await dbQuery<{ id: string; status: string; content_item_id: string | null }>(
    `SELECT id::text AS id, status, content_item_id::text AS content_item_id
       FROM social_hub.schedule
      WHERE vertical = 'reels' AND idea_ref = $1 AND status IN ('scheduled', 'publishing')
      ORDER BY created_at DESC LIMIT 1`,
    [postIdeaId],
  );
  const slot = rows[0];
  if (!slot) return { ok: false, note: 'It has no slot to remove.' };
  if (slot.status === 'publishing') return { ok: false, note: 'It is posting right now, so it can’t be unscheduled.' };
  await dbQuery(
    `UPDATE social_hub.schedule SET status = 'cancelled', approved_at = NULL, error = $2 WHERE id = $1::uuid AND status = 'scheduled'`,
    [slot.id, UNSCHEDULED_NOTE],
  );
  if (slot.content_item_id) await dbQuery(`DELETE FROM social_hub.approvals WHERE content_item_id = $1::uuid AND decision = 'approved'`, [slot.content_item_id]);
  return { ok: true, note: 'Unscheduled. It is not approved any more; approve it again when you want it to post.' };
}
