import { dbQuery } from '@/lib/db';
import { COPY_STALE_MINUTES } from '@/lib/reels/config';
import { copyPromptApproved, writeIdeaCopy } from '@/lib/reels/pipeline/copy';

export type CopyJobStatus = 'requested' | 'running' | 'ok' | 'failed';

export type StoredCopyJob = {
  id: string;
  postIdeaId: string;
  slateId: string;
  status: CopyJobStatus;
  error: string | null;
};

type JobRow = {
  id: string;
  post_idea_id: string;
  slate_id: string;
  status: CopyJobStatus;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}

export async function queueCopyJob(
  postIdeaId: string,
  slateId: string,
): Promise<{ queued: true; id: string } | { queued: false; status: number; note: string }> {
  if (!copyPromptApproved()) {
    return {
      queued: false,
      status: 409,
      note: 'On-screen copy and captions are off until the P-10 writer prompt is approved.',
    };
  }
  // The spend watch does not gate a click (fail open). The frame and video jobs warn about it.
  const ready = await dbQuery<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM reels.idea_scores
        WHERE slate_id = $1
          AND post_idea_id = $2
          AND chosen_bucket IS NOT NULL
          AND chosen_framework IS NOT NULL
     ) AS found`,
    [slateId, postIdeaId],
  );
  if (ready.rows[0]?.found !== true) {
    return {
      queued: false,
      status: 400,
      note: 'This post idea has no winning bucket and framework to write from.',
    };
  }
  const { rows } = await dbQuery<JobRow>(
    `INSERT INTO reels.copy_jobs (post_idea_id, slate_id, status)
     VALUES ($1, $2, 'requested')
     ON CONFLICT (post_idea_id) WHERE status IN ('requested', 'running') DO NOTHING
     RETURNING id, post_idea_id, slate_id, status`,
    [postIdeaId, slateId],
  );
  const job = rows[0];
  if (!job) {
    return { queued: false, status: 200, note: 'Copy is already queued for this post idea.' };
  }
  return { queued: true, id: job.id };
}

export async function copyInFlight(): Promise<boolean> {
  const { rows } = await dbQuery<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM reels.copy_jobs WHERE status IN ('requested', 'running')
     ) AS found`,
  );
  return rows[0]?.found === true;
}

export async function loadCopyJobsForIdeas(postIdeaIds: string[]): Promise<Record<string, StoredCopyJob>> {
  if (postIdeaIds.length === 0) return {};
  const { rows } = await dbQuery<{
    id: string;
    post_idea_id: string;
    slate_id: string;
    status: CopyJobStatus;
    error: string | null;
  }>(
    `SELECT DISTINCT ON (post_idea_id)
            id, post_idea_id, slate_id, status, error
       FROM reels.copy_jobs
      WHERE post_idea_id = ANY($1::uuid[])
      ORDER BY post_idea_id, requested_at DESC`,
    [postIdeaIds],
  );
  const out: Record<string, StoredCopyJob> = {};
  for (const row of rows) {
    out[row.post_idea_id] = {
      id: row.id,
      postIdeaId: row.post_idea_id,
      slateId: row.slate_id,
      status: row.status,
      error: row.error,
    };
  }
  return out;
}

async function claimCopyJob(): Promise<string | null> {
  await dbQuery(
    `UPDATE reels.copy_jobs
        SET status = 'failed', finished_at = now(),
            error = 'The worker stopped while this copy was running.'
      WHERE status = 'running'
        AND started_at < now() - ($1::int * interval '1 minute')`,
    [COPY_STALE_MINUTES],
  );
  try {
    const { rows } = await dbQuery<{ id: string }>(
      `UPDATE reels.copy_jobs
          SET status = 'running', started_at = now()
        WHERE id = (
          SELECT id FROM reels.copy_jobs
           WHERE status = 'requested'
             AND NOT EXISTS (SELECT 1 FROM reels.copy_jobs c WHERE c.status = 'running')
           ORDER BY requested_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id`,
    );
    return rows[0]?.id ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** Claim one queued copy job and write it. Returns null when the queue is empty. */
export async function claimAndWriteCopy(): Promise<{ id: string; status: CopyJobStatus } | null> {
  const id = await claimCopyJob();
  if (!id) return null;

  const { rows } = await dbQuery<{ post_idea_id: string; slate_id: string }>(
    `SELECT post_idea_id, slate_id FROM reels.copy_jobs WHERE id = $1`,
    [id],
  );
  const job = rows[0];
  if (!job) return null;

  try {
    const outcome = await writeIdeaCopy(null, job.slate_id, job.post_idea_id);
    await dbQuery(
      `UPDATE reels.copy_jobs
          SET status = $2, finished_at = now(), error = $3, usd = $4
        WHERE id = $1`,
      [id, outcome.ok ? 'ok' : 'failed', outcome.error, outcome.usd],
    );
    return { id, status: outcome.ok ? 'ok' : 'failed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dbQuery(
      `UPDATE reels.copy_jobs
          SET status = 'failed', finished_at = now(), error = $2
        WHERE id = $1`,
      [id, message],
    );
    return { id, status: 'failed' };
  }
}
