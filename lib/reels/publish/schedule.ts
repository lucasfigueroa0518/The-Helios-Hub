import { dbQuery } from '@/lib/db';
import { queuePublish, publishReadiness, type PublishTrigger } from '@/lib/reels/music/publish';
import { getSetting } from '@/lib/reels/music/store';
import { calendarDateKey } from '@/lib/reels/schedule';
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
  return `Scheduled for ${formatPublishAt(schedule.publishAt)} (${slotLabel(schedule.slot)}). It posts as a trial reel.`;
}

/** Live is the switch for the nightly auto-schedule. Off until it is turned on. */
export async function publishingLive(): Promise<boolean> {
  return (await getSetting<boolean>('publishing_live')) === true;
}

async function activeSchedule(postIdeaId: string): Promise<StoredSchedule | null> {
  const { rows } = await dbQuery<ScheduleRow>(
    `SELECT id, post_idea_id, video_job_id, ny_date::text AS ny_date, slot, publish_at, status, source
       FROM reels.posting_schedule
      WHERE post_idea_id = $1 AND status IN ('scheduled', 'publishing')
      ORDER BY created_at DESC
      LIMIT 1`,
    [postIdeaId],
  );
  return rows[0] ? toSchedule(rows[0]) : null;
}

async function takenSlots(fromDate: string): Promise<Set<string>> {
  const { rows } = await dbQuery<{ ny_date: string; slot: SlotId }>(
    `SELECT ny_date::text AS ny_date, slot
       FROM reels.posting_schedule
      WHERE status IN ('scheduled', 'publishing', 'published')
        AND ny_date >= $1::date`,
    [fromDate],
  );
  return new Set(rows.map((row) => slotKey(row.ny_date, row.slot)));
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
  if (existing) return { scheduled: true, schedule: existing, note: scheduleNote(existing) };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const choice = chooseSlot(now, await takenSlots(calendarDateKey(now)), uniformIndex, POSTING_TIME_ZONE, throughDate);
    if (!choice) {
      const note = throughDate
        ? 'No posting window is still open today.'
        : 'No posting slot is open in the next two weeks.';
      return { scheduled: false, status: 409, note };
    }
    try {
      const { rows } = await dbQuery<ScheduleRow>(
        `INSERT INTO reels.posting_schedule (post_idea_id, video_job_id, ny_date, slot, publish_at, status, source)
         VALUES ($1, $2, $3::date, $4, $5, 'scheduled', $6)
         RETURNING id, post_idea_id, video_job_id, ny_date::text AS ny_date, slot, publish_at, status, source`,
        [postIdeaId, videoJobId, choice.nyDate, choice.slot, choice.publishAt.toISOString(), source],
      );
      const schedule = toSchedule(rows[0]);
      return { scheduled: true, schedule, note: scheduleNote(schedule) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await activeSchedule(postIdeaId);
      if (raced) return { scheduled: true, schedule: raced, note: scheduleNote(raced) };
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
  return POSTING_SLOTS.filter(
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

/**
 * A due slot becomes a normal publish attempt. The worker then posts it as a
 * trial reel. A reel that is not finished yet stays on the clock.
 */
export async function releaseDueSchedules(): Promise<number> {
  const { rows } = await dbQuery<{
    id: string;
    post_idea_id: string;
    video_job_id: string | null;
    source: ScheduleSource;
  }>(
    `SELECT id, post_idea_id, video_job_id, source
       FROM reels.posting_schedule
      WHERE status = 'scheduled' AND publish_at <= now()
      ORDER BY publish_at`,
  );
  let released = 0;
  for (const row of rows) {
    const videoId = await readyVideo(row.post_idea_id, row.video_job_id);
    if (!videoId) continue;
    const claimed = await dbQuery<{ id: string }>(
      `UPDATE reels.posting_schedule
          SET status = 'publishing', video_job_id = $2
        WHERE id = $1 AND status = 'scheduled'
        RETURNING id`,
      [row.id, videoId],
    );
    if (!claimed.rows[0]) continue;
    const trigger: PublishTrigger = row.source === 'user' ? 'approve' : 'auto';
    let result: Awaited<ReturnType<typeof queuePublish>>;
    try {
      result = await queuePublish(videoId, trigger);
    } catch (error) {
      await dbQuery(
        `UPDATE reels.posting_schedule SET status = 'scheduled', error = $2 WHERE id = $1 AND status = 'publishing'`,
        [row.id, error instanceof Error ? error.message : String(error)],
      );
      continue;
    }
    if (result.queued) {
      await dbQuery(
        `UPDATE reels.posting_schedule SET publish_attempt_id = $2 WHERE id = $1`,
        [row.id, result.id],
      );
      released += 1;
      continue;
    }
    if (result.terminal) {
      await dbQuery(
        `UPDATE reels.posting_schedule
            SET status = 'failed', error = $2, publish_attempt_id = COALESCE($3, publish_attempt_id)
          WHERE id = $1 AND status = 'publishing'`,
        [row.id, result.note, result.id ?? null],
      );
      continue;
    }
    if (result.note.includes('already published')) {
      await dbQuery(
        `UPDATE reels.posting_schedule SET status = 'published', error = NULL WHERE id = $1`,
        [row.id],
      );
      continue;
    }
    if (result.note.includes('already publishing')) continue;
    await dbQuery(
      `UPDATE reels.posting_schedule
          SET status = 'scheduled', error = $2
        WHERE id = $1 AND status = 'publishing'`,
      [row.id, result.note],
    );
  }
  return released;
}

/** Drop a clock time so Force post does not also fire when the slot arrives. */
export async function cancelScheduledPost(postIdeaId: string): Promise<void> {
  await dbQuery(
    `UPDATE reels.posting_schedule
        SET status = 'cancelled'
      WHERE post_idea_id = $1 AND status = 'scheduled'`,
    [postIdeaId],
  );
}

export async function markScheduleForAttempt(
  attemptId: string,
  status: 'published' | 'failed',
  error: string | null,
): Promise<void> {
  await dbQuery(
    `UPDATE reels.posting_schedule
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
       FROM reels.posting_schedule
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
