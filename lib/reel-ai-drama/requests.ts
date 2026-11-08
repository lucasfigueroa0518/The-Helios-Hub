import type { Queryable } from '@/lib/explainers/db';
import { calendarDateKey } from '@/lib/instagram/clock';
import { rankScore } from '@/lib/reel-ai-drama/development/pool';
import { getPitch, requestJob, requeueJob } from '@/lib/reel-ai-drama/production/jobs';
import { bookFinishedDrama, type DramaScheduleOutcome } from '@/lib/reel-ai-drama/publish/schedule';
import { isUuid } from '@/lib/reel-ai-drama/publish/items';
import { writeDramaPostCaption } from '@/lib/reel-ai-drama/publish/publish';
import { inTransaction, loadSettings, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';

/**
 * A person's clicks and the worker's queue (HUB-WIRING-CONTRACT.md §2.2, §4.3, §7.1 items 3–5). Nothing here calls a
 * model: Develop and Calibrate only queue a `reel_ai_drama.requests` row that the worker claims and runs.
 */

export type DramaRefusal = 'not_found' | 'not_makeable' | 'already_running' | 'daily_render_cap' | 'daily_spend_cap';
export const DRAMA_REFUSAL_TEXT: Record<DramaRefusal, string> = {
  not_found: 'That pitch is gone.',
  not_makeable: 'Only a pitch in the pool (or one already made) can be made.',
  already_running: 'That pitch is already being made.',
  daily_render_cap: 'Today’s AI Drama render cap is reached. Raise it in Settings or try tomorrow.',
  daily_spend_cap: 'Today’s AI Drama spend cap is reached. Raise it in Settings or try tomorrow.',
};

export const nyDateOf = (at: Date = new Date()): string => calendarDateKey(at);

/** Jobs requested on a New York day (killed ones don't hold a place: a kill is refilled). */
export async function dramaJobsRequestedOn(db: Queryable, nyDate: string): Promise<number> {
  const { rows } = await db.query<{ n: unknown }>(
    `SELECT count(*) AS n FROM reel_ai_drama.jobs
      WHERE status <> 'killed' AND (requested_at AT TIME ZONE 'America/New_York')::date = $1::date`,
    [nyDate],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Production spend (every cost a job recorded) on a New York day, all modes. */
export async function dramaSpendOn(db: Queryable, nyDate: string): Promise<number> {
  const { rows } = await db.query<{ usd: unknown }>(
    `SELECT COALESCE(SUM(usd), 0) AS usd FROM reel_ai_drama.cost_events
      WHERE job_id IS NOT NULL AND (created_at AT TIME ZONE 'America/New_York')::date = $1::date`,
    [nyDate],
  );
  return Number(rows[0]?.usd ?? 0);
}

/** The day's caps, checked before a job is queued. Null: room for one more. */
export async function dramaCapRefusal(db: Queryable, settings: ReelAiDramaSettings, now: Date): Promise<'daily_render_cap' | 'daily_spend_cap' | null> {
  const day = nyDateOf(now);
  if ((await dramaJobsRequestedOn(db, day)) >= settings.daily_render_cap) return 'daily_render_cap';
  if ((await dramaSpendOn(db, day)) >= settings.daily_spend_cap_usd) return 'daily_spend_cap';
  return null;
}

/**
 * The day's caps are shared by every pitch, so the check and the insert run under one transaction-scoped lock: a night
 * request and a click on two different pitches can't both pass the last free render.
 */
async function lockDayCaps(tx: Queryable): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext('reel_ai_drama:day_caps'))`);
}

type MakeInput = { pitchId: string; by: string; now?: Date; trigger?: 'click' | 'auto'; nightDate?: string | null };

/**
 * Queue one production job (Make it, Regenerate, Run now: trigger 'click'; the night: 'auto'), under the per-reel cap
 * and the day's render and spend caps. A made pitch may be made again by a click. One transaction with the pitch row
 * locked, so two clicks at once queue one job.
 */
export async function requestDramaJob(db: Queryable, input: MakeInput): Promise<{ ok: true; jobId: string } | { ok: false; reason: DramaRefusal }> {
  if (!isUuid(input.pitchId)) return { ok: false, reason: 'not_found' };
  const now = input.now ?? new Date();
  const settings = await loadSettings(db);
  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ status: string }>('SELECT status FROM reel_ai_drama.pitches WHERE id = $1 FOR UPDATE', [input.pitchId]);
    if (!rows[0]) return { ok: false as const, reason: 'not_found' as const };
    await lockDayCaps(tx);
    const capped = await dramaCapRefusal(tx, settings, now);
    if (capped) {
      // A pitch that couldn't be made anyway says so first.
      const trigger = input.trigger ?? 'click';
      if (!(rows[0].status === 'pooled' || (rows[0].status === 'made' && trigger === 'click'))) return { ok: false as const, reason: 'not_makeable' as const };
      return { ok: false as const, reason: capped };
    }
    return requestJob(tx, { pitchId: input.pitchId, trigger: input.trigger ?? 'click', requestedBy: input.by, nightDate: input.nightDate ?? null, settings });
  });
}

export async function requestDramaJobs(
  db: Queryable,
  pitchIds: readonly string[],
  input: { by: string; now?: Date },
): Promise<{ queued: string[]; refused: Array<{ pitchId: string; reason: DramaRefusal }> }> {
  const queued: string[] = [];
  const refused: Array<{ pitchId: string; reason: DramaRefusal }> = [];
  for (const pitchId of [...new Set(pitchIds)]) {
    const r = await requestDramaJob(db, { pitchId, by: input.by, now: input.now });
    if (r.ok) queued.push(r.jobId);
    else refused.push({ pitchId, reason: r.reason });
  }
  return { queued, refused };
}

export async function dramaInFlightPitchIds(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(`SELECT DISTINCT pitch_id::text AS id FROM reel_ai_drama.jobs WHERE status IN ('queued', 'running')`);
  return rows.map((r) => r.id);
}

export async function dramaRunCostUsd(db: Queryable): Promise<number> {
  return (await loadSettings(db)).per_reel_cap_usd;
}

// ── Develop / Calibrate requests ────────────────────────────────────────────

export type DramaRequestKind = 'develop' | 'calibrate';
export type DramaRequestRow = {
  id: string; kind: DramaRequestKind; status: string; requestedAt: string; startedAt: string | null; finishedAt: string | null; error: string | null; requestedBy: string | null;
};

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/** Queue a click for the worker. Null when one of that kind is already requested or running (the unique index decides). */
export async function queueDramaRequest(db: Queryable, kind: DramaRequestKind, by: string | null): Promise<{ requestId: string } | null> {
  try {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO reel_ai_drama.requests (kind, requested_by) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
      [kind, by],
    );
    return rows[0] ? { requestId: rows[0].id } : null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

export async function listDramaRequests(db: Queryable, limit = 20): Promise<DramaRequestRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM reel_ai_drama.requests ORDER BY requested_at DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({
    id: String(r.id), kind: r.kind as DramaRequestKind, status: String(r.status), requestedAt: iso(r.requested_at)!, startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at), error: (r.error as string | null) ?? null, requestedBy: (r.requested_by as string | null) ?? null,
  }));
}

/** Requests a dead worker left running: failed, with why (the same rule as stale jobs). */
export async function failStaleDramaRequests(db: Queryable, olderThanMinutes = 180): Promise<number> {
  const { rows } = await db.query(
    `UPDATE reel_ai_drama.requests SET status = 'failed', finished_at = now(), error = 'The worker stopped while this was running.'
      WHERE status = 'running' AND started_at < now() - make_interval(mins => $1) RETURNING id`,
    [olderThanMinutes],
  );
  return rows.length;
}

export type DramaRequestRunners = {
  develop: (db: Queryable) => Promise<unknown>;
  calibrate: (db: Queryable) => Promise<unknown>;
};

/**
 * Claim the oldest requested click and run it (develop → one development session, trigger 'click'; calibrate → the
 * Jev calibration, whose report is kept in calibration_reports). Null when nothing waits. A failure is recorded, never thrown.
 */
export async function runNextDramaRequest(db: Queryable, runners: DramaRequestRunners): Promise<DramaRequestRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE reel_ai_drama.requests SET status = 'running', started_at = now()
      WHERE id = (SELECT id FROM reel_ai_drama.requests WHERE status = 'requested' ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
  );
  const claimed = rows[0];
  if (!claimed) return null;
  const id = String(claimed.id);
  const kind = claimed.kind as DramaRequestKind;
  const started = new Date();
  try {
    const result = await (kind === 'develop' ? runners.develop(db) : runners.calibrate(db));
    if (kind === 'calibrate') {
      // What the calibration spent: the development costs no session or job claimed while it ran.
      const { rows: spent } = await db.query<{ usd: unknown }>(
        `SELECT COALESCE(SUM(usd), 0) AS usd FROM reel_ai_drama.cost_events WHERE job_id IS NULL AND session_id IS NULL AND created_at >= $1`,
        [started.toISOString()],
      );
      await db.query(`INSERT INTO reel_ai_drama.calibration_reports (request_id, report, usd) VALUES ($1, $2::jsonb, $3)`, [id, JSON.stringify(result ?? null), Number(spent[0]?.usd ?? 0)]);
    }
    await db.query(`UPDATE reel_ai_drama.requests SET status = 'ok', finished_at = now(), result = $2::jsonb WHERE id = $1 AND status = 'running'`, [id, JSON.stringify(summarize(result))]);
  } catch (error) {
    await db.query(`UPDATE reel_ai_drama.requests SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1 AND status = 'running'`, [id, error instanceof Error ? error.message : String(error)]);
  }
  return (await listDramaRequests(db, 50)).find((r) => r.id === id) ?? null;
}

/** A small, JSON-safe summary of a run's result for the request row (a big report lives in its own table). */
function summarize(result: unknown): unknown {
  try {
    const text = JSON.stringify(result ?? null);
    return text.length <= 20_000 ? JSON.parse(text) : { truncated: true };
  } catch {
    return null;
  }
}

export async function latestCalibration(db: Queryable): Promise<{ at: string; report: unknown; usd: number } | null> {
  const { rows } = await db.query<{ created_at: unknown; report: unknown; usd: unknown }>(
    `SELECT created_at, report, usd FROM reel_ai_drama.calibration_reports ORDER BY created_at DESC LIMIT 1`,
  );
  const r = rows[0];
  return r ? { at: iso(r.created_at)!, report: typeof r.report === 'string' ? JSON.parse(r.report) : r.report, usd: Number(r.usd) } : null;
}

// ── Pool actions ────────────────────────────────────────────────────────────

export class DramaActionError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

/** Reject a pitch by hand: only one not being made (new, pooled, or picked with no live job). */
export async function rejectPitch(db: Queryable, id: string, by: string, note?: string | null): Promise<{ id: string; status: 'rejected' }> {
  if (!isUuid(id)) throw new DramaActionError('That pitch is gone.', 404);
  const reason = `by ${by}${note?.trim() ? `: ${note.trim()}` : ''}`;
  const { rows } = await db.query<{ id: string }>(
    `UPDATE reel_ai_drama.pitches p SET status = 'rejected', reject_reason = $2, updated_at = now()
      WHERE p.id = $1 AND p.status IN ('new', 'pooled', 'picked')
        AND NOT EXISTS (SELECT 1 FROM reel_ai_drama.jobs j WHERE j.pitch_id = p.id AND j.status IN ('queued', 'running'))
      RETURNING id`,
    [id, reason],
  );
  if (rows[0]) return { id, status: 'rejected' };
  const pitch = await getPitch(db, id);
  if (!pitch) throw new DramaActionError('That pitch is gone.', 404);
  if (pitch.status === 'picked') throw new DramaActionError('That pitch is being made. Cancel its job first.');
  throw new DramaActionError(`A ${pitch.status} pitch can’t be rejected.`);
}

/** Bring a rejected, retired or killed pitch back to the pool, re-ranked for today. */
export async function revivePitch(db: Queryable, id: string, now = new Date()): Promise<{ id: string; status: 'pooled' }> {
  if (!isUuid(id)) throw new DramaActionError('That pitch is gone.', 404);
  const pitch = await getPitch(db, id);
  if (!pitch) throw new DramaActionError('That pitch is gone.', 404);
  if (!['rejected', 'retired', 'killed'].includes(pitch.status)) throw new DramaActionError(`A ${pitch.status} pitch can’t be revived.`);
  const settings = await loadSettings(db);
  let rank: number | null = null;
  try {
    rank = rankScore({ ...pitch, status: 'pooled' }, settings, now);
  } catch {
    rank = pitch.rank_score;
  }
  const { rows } = await db.query(
    `UPDATE reel_ai_drama.pitches SET status = 'pooled', reject_reason = NULL, revive_when = NULL, rank_score = $2, updated_at = now()
      WHERE id = $1 AND status IN ('rejected', 'retired', 'killed') RETURNING id`,
    [id, rank],
  );
  if (!rows.length) throw new DramaActionError('That pitch changed just now. Reload and try again.');
  return { id, status: 'pooled' };
}

// ── Job actions ─────────────────────────────────────────────────────────────

export const CANCEL_KILL_REASON = 'cancelled by a person';

/** Cancel: a queued job is killed at once (pitch back to pooled); a running one is asked to stop at its next stage. */
export async function cancelDramaJob(db: Queryable, jobId: string): Promise<{ status: 'killed' | 'cancel_requested' }> {
  if (!isUuid(jobId)) throw new DramaActionError('That job is gone.', 404);
  const { rows: killed } = await db.query<{ pitch_id: string }>(
    `UPDATE reel_ai_drama.jobs SET status = 'killed', kill_reason = $2, finished_at = now() WHERE id = $1 AND status = 'queued' RETURNING pitch_id`,
    [jobId, CANCEL_KILL_REASON],
  );
  if (killed[0]) {
    await db.query(`UPDATE reel_ai_drama.pitches SET status = 'pooled', updated_at = now() WHERE id = $1 AND status = 'picked'`, [killed[0].pitch_id]);
    return { status: 'killed' };
  }
  const { rows: running } = await db.query(
    `UPDATE reel_ai_drama.jobs SET cancel_requested_at = coalesce(cancel_requested_at, now()) WHERE id = $1 AND status = 'running' RETURNING id`,
    [jobId],
  );
  if (running.length) return { status: 'cancel_requested' };
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM reel_ai_drama.jobs WHERE id = $1`, [jobId]);
  if (!rows[0]) throw new DramaActionError('That job is gone.', 404);
  throw new DramaActionError(`That job already finished (${rows[0].status}).`);
}

/**
 * Retry a failed job under its own id (it resumes from what it already paid for). A retry is a new render for today:
 * it passes the day's caps and counts against today's render cap (requested_at moves to now).
 */
export async function retryDramaJob(db: Queryable, jobId: string, now: Date = new Date()): Promise<{ jobId: string }> {
  if (!isUuid(jobId)) throw new DramaActionError('That job is gone.', 404);
  const settings = await loadSettings(db);
  const outcome = await inTransaction(db, async (tx) => {
    await lockDayCaps(tx);
    const capped = await dramaCapRefusal(tx, settings, now);
    if (capped) return capped;
    if (!(await requeueJob(tx, jobId))) return false;
    await tx.query(`UPDATE reel_ai_drama.jobs SET requested_at = $2 WHERE id = $1`, [jobId, now.toISOString()]);
    return true;
  });
  if (outcome === true) return { jobId };
  if (outcome) throw new DramaActionError(DRAMA_REFUSAL_TEXT[outcome]);
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM reel_ai_drama.jobs WHERE id = $1`, [jobId]);
  if (!rows[0]) throw new DramaActionError('That job is gone.', 404);
  if (rows[0].status !== 'failed') throw new DramaActionError(`Only a failed job can be retried (this one is ${rows[0].status}).`);
  throw new DramaActionError('Another job for that pitch is already queued or running.');
}

// ── After a job ─────────────────────────────────────────────────────────────

/**
 * What the worker does when a job finishes ok: write the posting caption from the post text, and (night jobs only,
 * while live) book today's next open slot unapproved (§5). A video not in the bucket is never booked.
 */
export async function afterDramaJob(
  db: Queryable,
  job: { id: string; trigger: string },
  now = new Date(),
): Promise<{ caption: boolean; booked: DramaScheduleOutcome | null }> {
  const caption = (await writeDramaPostCaption(db, job.id)) != null;
  const booked = await bookFinishedDrama(db, job, now);
  return { caption, booked };
}
