import type { Queryable } from '@/lib/explainers/db';
import type { RealCaseSettings } from '@/lib/real-case/settings';
import type { Mode } from '@/lib/real-case/types';

/** Real Case render jobs (M5), in this route's own tables (RC-01). */

export type RealCaseJobStatus = 'requested' | 'running' | 'ok' | 'failed';

export type RealCaseJob = {
  id: string;
  story_id: string;
  status: RealCaseJobStatus;
  trigger: 'click' | 'auto';
  mode: Mode;
  stage: string | null;
  spend_cap_usd: number;
  spend_usd: number;
  capped: boolean;
  orchestrator_model: string;
  frame_worker_model: string;
  opener: string | null;
  session_a_id: string | null;
  session_b_id: string | null;
  error: string | null;
  flags: { kind: string; detail: string; at: string }[];
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

function jobRow(r: Record<string, unknown>): RealCaseJob {
  return {
    ...(r as unknown as RealCaseJob),
    spend_cap_usd: Number(r.spend_cap_usd),
    spend_usd: Number(r.spend_usd),
    requested_at: iso(r.requested_at)!,
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at),
  };
}

export type RenderRequest = { ok: true; jobId: string } | { ok: false; reason: 'not_found' | 'not_makeable' | 'already_running' };

/**
 * Lucas's Make reel click (RC-10): a story in the pool (or promoted, or made before and asked again)
 * gets a job. One live job per story. The story is marked promoted while it renders.
 */
export async function requestStoryRender(
  db: Queryable,
  input: { storyId: string; trigger: 'click' | 'auto'; settings: Pick<RealCaseSettings, 'mode' | 'per_reel_cap_usd' | 'orchestrator_model' | 'frame_worker_model'> },
): Promise<RenderRequest> {
  const { rows: stories } = await db.query<{ status: string }>('SELECT status FROM real_case.stories WHERE id = $1', [input.storyId]);
  if (!stories[0]) return { ok: false, reason: 'not_found' };
  if (!['pool', 'promoted', 'rendered'].includes(stories[0].status)) return { ok: false, reason: 'not_makeable' };
  try {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO real_case.jobs (story_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model)
       VALUES ($1, 'requested', $2, $3, $4, $5, $6) RETURNING id`,
      [input.storyId, input.trigger, input.settings.mode, input.settings.per_reel_cap_usd, input.settings.orchestrator_model, input.settings.frame_worker_model],
    );
    await db.query(`UPDATE real_case.stories SET status = 'promoted', updated_at = now() WHERE id = $1 AND status = 'pool'`, [input.storyId]);
    return { ok: true, jobId: rows[0].id };
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') return { ok: false, reason: 'already_running' };
    throw error;
  }
}

/** The oldest requested job, now running; null when none waits. */
export async function claimNextRealCaseJob(db: Queryable): Promise<RealCaseJob | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE real_case.jobs SET status = 'running', started_at = now(), stage = 'claimed'
      WHERE id = (SELECT id FROM real_case.jobs WHERE status = 'requested' ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
  );
  return rows[0] ? jobRow(rows[0]) : null;
}

export async function getRealCaseJob(db: Queryable, id: string): Promise<RealCaseJob | null> {
  const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM real_case.jobs WHERE id = $1', [id]);
  return rows[0] ? jobRow(rows[0]) : null;
}

export async function listRealCaseJobs(db: Queryable, limit = 50): Promise<(RealCaseJob & { story_title: string; term: string })[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT j.*, s.title AS story_title, s.term
       FROM real_case.jobs j JOIN real_case.stories s ON s.id = j.story_id
      ORDER BY j.requested_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ ...jobRow(r), story_title: String(r.story_title), term: String(r.term) }));
}

export async function setRealCaseJobStage(db: Queryable, id: string, stage: string, sessions: { sessionAId?: string; sessionBId?: string } = {}): Promise<void> {
  await db.query(
    `UPDATE real_case.jobs SET stage = $2,
            session_a_id = COALESCE($3, session_a_id), session_b_id = COALESCE($4, session_b_id)
      WHERE id = $1`,
    [id, stage, sessions.sessionAId ?? null, sessions.sessionBId ?? null],
  );
}

export async function setRealCaseJobOpener(db: Queryable, id: string, opener: string): Promise<void> {
  await db.query('UPDATE real_case.jobs SET opener = $2 WHERE id = $1', [id, opener]);
}

/** The openers of the latest Real Case jobs, newest first (this route's own rotation). */
export async function recentRealCaseOpeners(db: Queryable, exceptJobId: string, limit: number): Promise<string[]> {
  const { rows } = await db.query<{ opener: string }>(
    `SELECT opener FROM real_case.jobs WHERE opener IS NOT NULL AND id <> $1 ORDER BY requested_at DESC LIMIT $2`,
    [exceptJobId, limit],
  );
  return rows.map((r) => r.opener);
}

/** Something the reel shipped with that Lucas should see (a cut sentence, a remaining misunderstanding). */
export async function addRealCaseJobFlag(db: Queryable, id: string, kind: string, detail: string): Promise<void> {
  await db.query(`UPDATE real_case.jobs SET flags = flags || $2::jsonb WHERE id = $1`, [id, JSON.stringify([{ kind, detail, at: new Date().toISOString() }])]);
}

/** Finish a job. A made reel marks its story rendered; a failed one puts it back in the pool. */
export async function finishRealCaseJob(db: Queryable, id: string, result: { status: 'ok' | 'failed'; error?: string | null; capped?: boolean }): Promise<void> {
  const { rows } = await db.query<{ story_id: string }>(
    `UPDATE real_case.jobs SET status = $2, error = $3, capped = $4, finished_at = now(), stage = $5 WHERE id = $1 RETURNING story_id`,
    [id, result.status, result.error ?? null, result.capped ?? false, result.status === 'ok' ? 'done' : 'failed'],
  );
  const storyId = rows[0]?.story_id;
  if (!storyId) return;
  if (result.status === 'ok') {
    await db.query(`UPDATE real_case.stories SET status = 'rendered', rendered_at = now(), updated_at = now() WHERE id = $1`, [storyId]);
  } else {
    await db.query(`UPDATE real_case.stories SET status = 'pool', updated_at = now() WHERE id = $1 AND status = 'promoted'`, [storyId]);
  }
}

/** Jobs left `running` by a worker that died: failed, with why. */
export async function failStaleRealCaseJobs(db: Queryable, reason: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM real_case.jobs WHERE status = 'running'`);
  for (const r of rows) await finishRealCaseJob(db, r.id, { status: 'failed', error: reason });
  return rows.length;
}

export type RealCaseArtifactKind = 'brief' | 'storyboard' | 'script' | 'audio_meta' | 'lint_report' | 'fact_check' | 'contact_sheet' | 'video' | 'captions' | 'transcript_log';

export async function addRealCaseArtifact(
  db: Queryable,
  a: { jobId: string; kind: RealCaseArtifactKind; content?: string | null; storagePath?: string | null; storageLocation?: string | null; bytes?: number | null },
): Promise<void> {
  await db.query(
    `INSERT INTO real_case.artifacts (job_id, kind, content, storage_path, storage_location, bytes) VALUES ($1, $2, $3, $4, $5, $6)`,
    [a.jobId, a.kind, a.content ?? null, a.storagePath ?? null, a.storageLocation ?? null, a.bytes ?? null],
  );
}

export async function listRealCaseArtifacts(db: Queryable, jobId: string): Promise<{ kind: RealCaseArtifactKind; content: string | null; storage_path: string | null; created_at: string }[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    'SELECT kind, content, storage_path, created_at FROM real_case.artifacts WHERE job_id = $1 ORDER BY created_at',
    [jobId],
  );
  return rows.map((r) => ({ kind: r.kind as RealCaseArtifactKind, content: (r.content as string) ?? null, storage_path: (r.storage_path as string) ?? null, created_at: iso(r.created_at)! }));
}
