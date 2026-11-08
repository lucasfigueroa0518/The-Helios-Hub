import type { Queryable } from '@/lib/explainers/db';
import type { Mode } from '@/lib/reel-ai-drama/types';

export type Vendor = 'anthropic' | 'heygen' | 'jev' | 'openai' | 'serper' | 'other';

export type CostInput = {
  sessionId?: string | null;
  pitchId?: string | null;
  jobId?: string | null;
  mode: Mode;
  vendor: Vendor;
  /** Pipeline step, e.g. `producer`, `drama_score`, `visuals_check`, `reporting`, `writer`. */
  component: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  webSearches?: number;
  /** null when the vendor doesn't report a price (HeyGen): stored as 0 with usd_known = false. */
  usd: number | null;
};

/** Record one cost event; a job's spend_usd moves with it in the same statement. */
export async function recordCost(db: Queryable, e: CostInput): Promise<void> {
  const usd = e.usd ?? 0;
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`invalid cost: ${e.usd}`);
  await db.query(
    `WITH ev AS (
       INSERT INTO reel_ai_drama.cost_events
         (session_id, pitch_id, job_id, mode, vendor, component, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, web_searches, usd, usd_known)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING job_id, usd
     )
     UPDATE reel_ai_drama.jobs j SET spend_usd = j.spend_usd + ev.usd FROM ev WHERE j.id = ev.job_id`,
    [
      e.sessionId ?? null,
      e.pitchId ?? null,
      e.jobId ?? null,
      e.mode,
      e.vendor,
      e.component,
      e.inputTokens ?? 0,
      e.outputTokens ?? 0,
      e.cacheReadTokens ?? 0,
      e.cacheWriteTokens ?? 0,
      e.webSearches ?? 0,
      usd,
      e.usd !== null,
    ],
  );
}

/** Spend so far for a development session, a job, or one pitch's checks. */
export async function spendFor(db: Queryable, by: { sessionId?: string; jobId?: string; pitchId?: string }): Promise<number> {
  const [col, id] = by.jobId ? ['job_id', by.jobId] : by.sessionId ? ['session_id', by.sessionId] : ['pitch_id', by.pitchId];
  if (!id) throw new Error('spendFor needs an id');
  const { rows } = await db.query<{ usd: unknown }>(`SELECT COALESCE(SUM(usd), 0) AS usd FROM reel_ai_drama.cost_events WHERE ${col} = $1`, [id]);
  return Number(rows[0].usd);
}

/** Development spend since a time (the weekly cap, MD-28). */
export async function developmentSpendSince(db: Queryable, since: Date): Promise<number> {
  const { rows } = await db.query<{ usd: unknown }>(
    `SELECT COALESCE(SUM(usd), 0) AS usd FROM reel_ai_drama.cost_events WHERE job_id IS NULL AND created_at >= $1`,
    [since.toISOString()],
  );
  return Number(rows[0].usd);
}
