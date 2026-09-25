import { dbQuery } from '@/lib/db';
import { queueCopyJob } from '@/lib/reels/copy/jobs';
import { queueVideoJob } from '@/lib/reels/visual/video-run';
import { queueVisualFrame } from '@/lib/reels/visual/run';

/**
 * Generate walks one scored idea through copy, frame, and video, fresh on
 * every click. The page only records the request and queues copy. The worker
 * calls advanceFinishes after each stage, and again when it is idle, so a
 * closed tab still reaches the video. Stages fail open with warnings; a stage
 * that still errors (an outage, a timeout) is retried automatically.
 */

export type FinishStage = 'copy' | 'frame' | 'video';
export type FinishAction = FinishStage | 'wait' | 'done' | 'failed';

export type StageState = 'missing' | 'in_flight' | 'ok' | 'failed';

export type FinishProgress = {
  copy: StageState;
  frame: StageState;
  video: StageState;
};

/** Failed attempts per stage since this click. */
export type FinishAttempts = Record<FinishStage, number>;

/** Each stage gets this many tries per click before the walk gives up. */
export const MAX_STAGE_ATTEMPTS = 3;

const NO_ATTEMPTS: FinishAttempts = { copy: 0, frame: 0, video: 0 };

/**
 * What to do next. Only work finished after this click counts, so every click
 * makes a new reel. A failed stage is queued again until it has used
 * MAX_STAGE_ATTEMPTS; only then does the walk stop.
 */
export function nextFinishAction(progress: FinishProgress, attempts: FinishAttempts = NO_ATTEMPTS): FinishAction {
  if (progress.video === 'ok') return 'done';
  if (progress.copy === 'in_flight' || progress.frame === 'in_flight' || progress.video === 'in_flight') {
    return 'wait';
  }
  for (const stage of ['copy', 'frame', 'video'] as const) {
    const state = progress[stage];
    if (state === 'ok') continue;
    if (state === 'failed' && attempts[stage] >= MAX_STAGE_ATTEMPTS) return 'failed';
    return stage;
  }
  return 'video';
}

type ActiveFinish = {
  postIdeaId: string;
  slateId: string;
  progress: FinishProgress;
  attempts: FinishAttempts;
};

const STAGE_ERROR: Record<FinishStage, string> = {
  copy: `Copy failed ${MAX_STAGE_ATTEMPTS} times in a row, so the reel stopped. Click Generate to try again.`,
  frame: `The frame failed ${MAX_STAGE_ATTEMPTS} times in a row, so the reel stopped. Click Generate to try again.`,
  video: `The video failed ${MAX_STAGE_ATTEMPTS} times in a row, so the reel stopped. Click Generate to try again.`,
};

const STAGE_NOTE: Record<FinishStage, string> = {
  copy: 'Generating: copy, then the frame, then the video.',
  frame: 'Generating the frame. The video follows.',
  video: 'Generating the video.',
};

export type FinishStart = {
  status: 'active' | 'done' | 'failed';
  note: string;
};

/** Record the request and queue whichever stage is still missing. */
export async function requestFinish(postIdeaId: string, slateId: string): Promise<FinishStart> {
  await dbQuery(
    `INSERT INTO reels.finish_requests (post_idea_id, slate_id, status, error)
     VALUES ($1::uuid, $2::uuid, 'active', NULL)
     ON CONFLICT (post_idea_id) DO UPDATE
       SET slate_id = EXCLUDED.slate_id, status = 'active', error = NULL,
           requested_at = now(), updated_at = now()`,
    [postIdeaId, slateId],
  );
  const [row] = await loadActive(postIdeaId);
  if (!row) return { status: 'failed', note: 'Could not start whole generation.' };
  return stepFinish(row);
}

/**
 * Move every active request one step. Safe to call often: an in-flight stage
 * waits, and the queue inserts do nothing while a job is already waiting.
 * Returns true when a new stage was queued, so the worker can claim it now.
 */
export async function advanceFinishes(): Promise<boolean> {
  const rows = await loadActive();
  let queued = false;
  for (const row of rows) {
    const outcome = await stepFinish(row);
    if (outcome.status === 'active' && outcome.queued) queued = true;
  }
  return queued;
}

export async function loadFinishStatus(
  postIdeaIds: string[],
): Promise<Record<string, { status: 'active' | 'done' | 'failed'; error: string | null }>> {
  if (postIdeaIds.length === 0) return {};
  const result = await dbQuery<{ post_idea_id: string; status: 'active' | 'done' | 'failed'; error: string | null }>(
    `SELECT post_idea_id::text, status, error
     FROM reels.finish_requests WHERE post_idea_id = ANY($1::uuid[])`,
    [postIdeaIds],
  );
  const out: Record<string, { status: 'active' | 'done' | 'failed'; error: string | null }> = {};
  for (const row of result.rows) out[row.post_idea_id] = { status: row.status, error: row.error };
  return out;
}

type StepOutcome = FinishStart & { queued: boolean };

async function stepFinish(row: ActiveFinish): Promise<StepOutcome> {
  const action = nextFinishAction(row.progress, row.attempts);
  if (action === 'wait') {
    return { status: 'active', note: 'Already making this reel.', queued: false };
  }
  if (action === 'done') {
    await mark(row.postIdeaId, 'done', null);
    return { status: 'done', note: 'This reel is already finished.', queued: false };
  }
  if (action === 'failed') {
    const note = STAGE_ERROR[failedStage(row.progress)];
    await mark(row.postIdeaId, 'failed', note);
    return { status: 'failed', note, queued: false };
  }
  try {
    const queued = await queueStage(row, action);
    return { status: 'active', note: queued ? STAGE_NOTE[action] : 'Already making this reel.', queued };
  } catch (err) {
    const note = err instanceof Error ? err.message : 'Could not queue the next stage.';
    await mark(row.postIdeaId, 'failed', note);
    return { status: 'failed', note, queued: false };
  }
}

function failedStage(progress: FinishProgress): FinishStage {
  if (progress.copy !== 'ok') return 'copy';
  if (progress.frame !== 'ok') return 'frame';
  return 'video';
}

async function queueStage(row: ActiveFinish, stage: FinishStage): Promise<boolean> {
  const result =
    stage === 'copy'
      ? await queueCopyJob(row.postIdeaId, row.slateId)
      : stage === 'frame'
        ? await queueVisualFrame(row.postIdeaId, row.slateId)
        : await queueVideoJob(row.postIdeaId, row.slateId);
  if (!result.queued && result.status !== 200) throw new Error(result.note);
  return result.queued;
}

async function mark(postIdeaId: string, status: 'done' | 'failed', error: string | null): Promise<void> {
  await dbQuery(
    `UPDATE reels.finish_requests
     SET status = $2, error = $3, updated_at = now()
     WHERE post_idea_id = $1::uuid AND status = 'active'`,
    [postIdeaId, status, error],
  );
}

/** One stage's state and failed attempts, counting only jobs finished after the click. */
function stageSql(table: string, alias: string, okStatuses: string, failStatuses: string): string {
  const latest = (column: string) =>
    `(SELECT ${alias}.${column} FROM reels.${table} ${alias}
       WHERE ${alias}.post_idea_id = f.post_idea_id AND ${alias}.requested_at >= f.requested_at
       ORDER BY ${alias}.requested_at DESC LIMIT 1)`;
  return `CASE
      WHEN EXISTS (SELECT 1 FROM reels.${table} ${alias}
                   WHERE ${alias}.post_idea_id = f.post_idea_id AND ${alias}.status IN ('requested', 'running')) THEN 'in_flight'
      WHEN ${latest('status')} IN (${okStatuses}) THEN 'ok'
      WHEN ${latest('status')} IN (${failStatuses}) THEN 'failed'
      ELSE 'missing'
    END`;
}

function attemptsSql(table: string, alias: string, failStatuses: string): string {
  return `(SELECT count(*)::int FROM reels.${table} ${alias}
            WHERE ${alias}.post_idea_id = f.post_idea_id AND ${alias}.requested_at >= f.requested_at
              AND ${alias}.status IN (${failStatuses}))`;
}

const FRAME_FAIL = "'failed', 'rejected_background', 'copy_does_not_fit'";

async function loadActive(postIdeaId?: string): Promise<ActiveFinish[]> {
  const result = await dbQuery<{
    post_idea_id: string;
    slate_id: string;
    copy_state: StageState;
    frame_state: StageState;
    video_state: StageState;
    copy_attempts: number;
    frame_attempts: number;
    video_attempts: number;
  }>(
    `SELECT f.post_idea_id::text, f.slate_id::text,
            ${stageSql('copy_jobs', 'j', "'ok'", "'failed'")} AS copy_state,
            ${stageSql('visual_jobs', 'v', "'ok'", FRAME_FAIL)} AS frame_state,
            ${stageSql('video_jobs', 'd', "'ok'", "'failed'")} AS video_state,
            ${attemptsSql('copy_jobs', 'j', "'failed'")} AS copy_attempts,
            ${attemptsSql('visual_jobs', 'v', FRAME_FAIL)} AS frame_attempts,
            ${attemptsSql('video_jobs', 'd', "'failed'")} AS video_attempts
     FROM reels.finish_requests f
     WHERE f.status = 'active'
       AND ($1::uuid IS NULL OR f.post_idea_id = $1::uuid)`,
    [postIdeaId ?? null],
  );
  return result.rows.map((row) => ({
    postIdeaId: row.post_idea_id,
    slateId: row.slate_id,
    progress: { copy: row.copy_state, frame: row.frame_state, video: row.video_state },
    attempts: { copy: row.copy_attempts, frame: row.frame_attempts, video: row.video_attempts },
  }));
}
