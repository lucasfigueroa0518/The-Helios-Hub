import type { Queryable } from '@/lib/explainers/db';
import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { JobFlag, JobStage, Mode, PitchRow } from '@/lib/reel-ai-drama/types';

/**
 * Reel AI Drama production jobs (PROCESS.md P1–P9), in this route's own tables. Pattern:
 * lib/real-case/jobs.ts. Pitch status moves with the job: pooled → picked (requested) → made (ok),
 * killed (a kill, MD-31), or back to pooled (a failure, so a click can retry it).
 */

export type JobStatus = 'queued' | 'running' | 'ok' | 'failed' | 'killed';
export type JobTrigger = 'auto' | 'click';
export type KillReason = 'facts_dont_hold' | 'too_few_visuals' | 'no_key_moment_image';
export const KILL_REASONS: readonly KillReason[] = ['facts_dont_hold', 'too_few_visuals', 'no_key_moment_image'];

export type ArtifactKind =
  | 'fact_sheet'
  | 'inventory'
  | 'writer_draft'
  | 'director_plan'
  | 'script_md'
  | 'storyboard_md'
  | 'facts_check'
  | 'integrity_check'
  | 'first_viewer'
  | 'breakage'
  | 'post_text'
  | 'contact_sheet'
  | 'video'
  | 'delivery_report'
  | 'transcript_log';

export type Job = {
  id: string;
  pitch_id: string;
  status: JobStatus;
  trigger: JobTrigger;
  mode: Mode;
  stage: JobStage | null;
  spend_cap_usd: number;
  spend_usd: number;
  capped: boolean;
  models: Record<string, string>;
  flags: JobFlag[];
  kill_reason: string | null;
  error: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

export function jobRow(r: Record<string, unknown>): Job {
  return {
    ...(r as unknown as Job),
    spend_cap_usd: Number(r.spend_cap_usd),
    spend_usd: Number(r.spend_usd),
    capped: Boolean(r.capped),
    models: json(r.models, {}),
    flags: json(r.flags, []),
    requested_at: iso(r.requested_at)!,
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at),
  };
}

export function pitchRow(r: Record<string, unknown>): PitchRow {
  const date = r.event_date instanceof Date ? r.event_date.toISOString().slice(0, 10) : (r.event_date as string | null) ?? null;
  return {
    ...(r as unknown as PitchRow),
    pitch: json(r.pitch, {} as PitchRow['pitch']),
    event_date: date,
    drama: json(r.drama, null),
    drama_score: num(r.drama_score),
    material: json(r.material, null),
    material_score: num(r.material_score),
    visuals_card: json(r.visuals_card, null),
    rank_score: num(r.rank_score),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
    made_at: iso(r.made_at),
  };
}

export async function getPitch(db: Queryable, id: string): Promise<PitchRow | null> {
  const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM reel_ai_drama.pitches WHERE id = $1', [id]);
  return rows[0] ? pitchRow(rows[0]) : null;
}

export type JobRequest = { ok: true; jobId: string } | { ok: false; reason: 'not_found' | 'not_makeable' | 'already_running' };

/**
 * Queue one production job for a pitch: the schedule's pick (auto) or the lab's Make click. One live
 * job per pitch. A pooled pitch can be made; a made one only again by a click.
 */
export async function requestJob(
  db: Queryable,
  input: {
    pitchId: string;
    trigger: JobTrigger;
    settings: Pick<ReelAiDramaSettings, 'mode' | 'per_reel_cap_usd' | 'orchestrator_model' | 'frame_worker_model' | 'writer_model' | 'director_model' | 'reporting_model' | 'vision_model'>;
  },
): Promise<JobRequest> {
  const { rows: pitches } = await db.query<{ status: string }>('SELECT status FROM reel_ai_drama.pitches WHERE id = $1', [input.pitchId]);
  const status = pitches[0]?.status;
  if (!status) return { ok: false, reason: 'not_found' };
  if (!(status === 'pooled' || (status === 'made' && input.trigger === 'click'))) return { ok: false, reason: 'not_makeable' };
  const { rows: live } = await db.query('SELECT 1 FROM reel_ai_drama.jobs WHERE pitch_id = $1 AND status IN (\'queued\', \'running\')', [input.pitchId]);
  if (live.length) return { ok: false, reason: 'already_running' };
  const s = input.settings;
  const models = {
    reporting: s.reporting_model,
    writer: s.writer_model,
    director: s.director_model,
    orchestrator: s.orchestrator_model,
    frame_worker: s.frame_worker_model,
    vision: s.vision_model,
  };
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.jobs (pitch_id, status, trigger, mode, spend_cap_usd, models)
     VALUES ($1, 'queued', $2, $3, $4, $5::jsonb) RETURNING id`,
    [input.pitchId, input.trigger, s.mode, s.per_reel_cap_usd, JSON.stringify(models)],
  );
  await db.query(`UPDATE reel_ai_drama.pitches SET status = 'picked', updated_at = now() WHERE id = $1`, [input.pitchId]);
  return { ok: true, jobId: rows[0].id };
}

/** The oldest queued job, now running at the pick stage (P1); null when none waits. */
export async function claimNextJob(db: Queryable): Promise<Job | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE reel_ai_drama.jobs SET status = 'running', started_at = now(), stage = 'pick'
      WHERE id = (SELECT id FROM reel_ai_drama.jobs WHERE status = 'queued' ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
  );
  return rows[0] ? jobRow(rows[0]) : null;
}

export async function getJob(db: Queryable, id: string): Promise<Job | null> {
  const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM reel_ai_drama.jobs WHERE id = $1', [id]);
  return rows[0] ? jobRow(rows[0]) : null;
}

export async function listJobs(db: Queryable, limit = 50): Promise<(Job & { title: string })[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT j.*, p.title FROM reel_ai_drama.jobs j JOIN reel_ai_drama.pitches p ON p.id = j.pitch_id
      ORDER BY j.requested_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ ...jobRow(r), title: String(r.title) }));
}

export async function setStage(db: Queryable, jobId: string, stage: JobStage): Promise<void> {
  await db.query('UPDATE reel_ai_drama.jobs SET stage = $2 WHERE id = $1', [jobId, stage]);
}

/** A visible warning the reel ships with (checks fail open, MD-39). */
export async function addFlag(db: Queryable, jobId: string, flag: Omit<JobFlag, 'at'> & { at?: string }): Promise<void> {
  const full: JobFlag = { at: flag.at ?? new Date().toISOString(), check: flag.check, detail: flag.detail };
  await db.query('UPDATE reel_ai_drama.jobs SET flags = flags || $2::jsonb WHERE id = $1', [jobId, JSON.stringify([full])]);
}

/**
 * Finish a job. ok → the pitch is made; killed → the pitch is killed with its reason (MD-31);
 * failed → the pitch goes back to the pool. The stage is left where the job stopped.
 */
export async function finishJob(
  db: Queryable,
  jobId: string,
  result: { status: 'ok' | 'failed' | 'killed'; error?: string | null; killReason?: string | null; capped?: boolean },
): Promise<void> {
  const { rows } = await db.query<{ pitch_id: string }>(
    `UPDATE reel_ai_drama.jobs SET status = $2, error = $3, kill_reason = $4, capped = $5, finished_at = now()
      WHERE id = $1 RETURNING pitch_id`,
    [jobId, result.status, result.error ?? null, result.killReason ?? null, result.capped ?? false],
  );
  const pitchId = rows[0]?.pitch_id;
  if (!pitchId) return;
  if (result.status === 'ok') {
    await db.query(`UPDATE reel_ai_drama.pitches SET status = 'made', made_at = now(), updated_at = now() WHERE id = $1`, [pitchId]);
  } else if (result.status === 'killed') {
    await db.query(`UPDATE reel_ai_drama.pitches SET status = 'killed', reject_reason = $2, updated_at = now() WHERE id = $1`, [pitchId, result.killReason ?? null]);
  } else {
    // A failed or capped job returns its pitch to the pool once; a second failure retires it, so the
    // schedule never spends on the same broken story again (a click can still make it).
    const { rows: failed } = await db.query<{ n: unknown }>(
      `SELECT count(*) AS n FROM reel_ai_drama.jobs WHERE pitch_id = $1 AND status = 'failed'`,
      [pitchId],
    );
    const retire = Number(failed[0]?.n ?? 0) >= 2;
    await db.query(
      `UPDATE reel_ai_drama.pitches SET status = $2, reject_reason = CASE WHEN $2 = 'retired' THEN 'failed twice in production' ELSE reject_reason END,
         updated_at = now() WHERE id = $1 AND status = 'picked'`,
      [pitchId, retire ? 'retired' : 'pooled'],
    );
  }
}

/** Jobs left running by a worker that died: failed, with why. */
export async function failStaleJobs(db: Queryable, reason: string, olderThanMinutes = 120): Promise<number> {
  // Only jobs running far longer than any render: another worker may be running a job right now
  // (parallel workers, 2026-10-28), and failing it would kill a live render.
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM reel_ai_drama.jobs WHERE status = 'running' AND started_at < now() - make_interval(mins => $1)`,
    [olderThanMinutes],
  );
  for (const r of rows) await finishJob(db, r.id, { status: 'failed', error: reason });
  return rows.length;
}

export async function addArtifact(
  db: Queryable,
  a: { jobId: string; kind: ArtifactKind; content?: string | null; storagePath?: string | null; bytes?: number | null },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.artifacts (job_id, kind, content, storage_path, bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [a.jobId, a.kind, a.content ?? null, a.storagePath ?? null, a.bytes ?? null],
  );
  return rows[0].id;
}

export type ArtifactRow = { id: string; job_id: string; kind: ArtifactKind; content: string | null; storage_path: string | null; bytes: number | null; created_at: string };

export async function listArtifacts(db: Queryable, jobId: string): Promise<ArtifactRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    'SELECT id, job_id, kind, content, storage_path, bytes, created_at FROM reel_ai_drama.artifacts WHERE job_id = $1 ORDER BY created_at',
    [jobId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    job_id: String(r.job_id),
    kind: r.kind as ArtifactKind,
    content: (r.content as string) ?? null,
    storage_path: (r.storage_path as string) ?? null,
    bytes: num(r.bytes),
    created_at: iso(r.created_at)!,
  }));
}
