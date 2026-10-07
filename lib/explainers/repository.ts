import type { ExplainersDb, Queryable } from '@/lib/explainers/db';
import type { ExplainersSettings } from '@/lib/explainers/settings';
import {
  FAILURE_TAGS,
  SCORE_KEYS,
  type ScoreKey,
  type ArtifactKind,
  type ArtifactRow,
  type CostEventInput,
  type FailureTag,
  type FeedbackRow,
  type JobRow,
  type JobTrigger,
  type LintViolation,
  type TopicOrigin,
  type TopicRow,
  type TopicStatus,
  type Verdict,
} from '@/lib/explainers/types';

const NY_TZ = 'America/New_York';

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Eastern-time calendar date, the day boundary for the E-17 daily caps. */
export function nyDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Paste-a-list seeding: one topic per line, blanks and repeats dropped. */
export function parseTopicList(text: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const title = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }
  return titles;
}

export function normalizeFailureTags(tags: readonly string[]): FailureTag[] {
  const unknown = tags.filter((tag) => !FAILURE_TAGS.includes(tag as FailureTag));
  if (unknown.length) throw new Error(`unknown failure tag: ${unknown.join(', ')}`);
  return FAILURE_TAGS.filter((tag) => tags.includes(tag));
}

/**
 * Pool ranking: weighted score, then the E-15 tie-breaks (teachability,
 * accuracy, audience, visual, hook), then the deterministic system field. The
 * older row wins an exact tie, which is E-16's "retain incumbent".
 */
export const POOL_ORDER_BY = `weighted_score DESC NULLS LAST,
  teachability_45s DESC NULLS LAST,
  accuracy_under_simplification DESC NULLS LAST,
  audience_fit DESC NULLS LAST,
  visual_potential DESC NULLS LAST,
  hook_strength DESC NULLS LAST,
  created_at ASC,
  id ASC`;

// ── Row normalization (pg returns numeric as string) ────────────────────────

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

function toTopic(row: Record<string, unknown>): TopicRow {
  const topic = row as TopicRow;
  const scores = {} as Record<ScoreKey, number | null>;
  for (const key of SCORE_KEYS) scores[key] = numOrNull(row[key]);
  return { ...topic, ...scores, weighted_score: numOrNull(row.weighted_score) };
}

function toJob(row: Record<string, unknown>): JobRow {
  const job = row as JobRow;
  return { ...job, spend_usd: num(row.spend_usd), spend_cap_usd: num(row.spend_cap_usd) };
}

// ── Topics ──────────────────────────────────────────────────────────────────

export type NewTopic = {
  title: string;
  scope?: string | null;
  sourceUrl?: string | null;
  sourceText?: string | null;
  origin: TopicOrigin;
};

export async function addTopics(db: ExplainersDb, topics: NewTopic[]): Promise<TopicRow[]> {
  return db.transaction(async (tx) => {
    const added: TopicRow[] = [];
    for (const topic of topics) {
      const title = topic.title.trim();
      if (!title) throw new Error('topic title is empty');
      const { rows } = await tx.query<Record<string, unknown>>(
        `INSERT INTO explainers.topics (title, scope, source_url, source_text, origin)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          title,
          topic.scope?.trim() || null,
          topic.sourceUrl?.trim() || null,
          topic.sourceText?.trim() || null,
          topic.origin,
        ],
      );
      added.push(toTopic(rows[0]));
    }
    return added;
  });
}

export async function getTopic(db: Queryable, id: string): Promise<TopicRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    'SELECT * FROM explainers.topics WHERE id = $1',
    [id],
  );
  return rows[0] ? toTopic(rows[0]) : null;
}

export async function listTopics(
  db: Queryable,
  statuses?: readonly TopicStatus[],
): Promise<TopicRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    statuses
      ? 'SELECT * FROM explainers.topics WHERE status = ANY($1::text[]) ORDER BY created_at DESC, id'
      : 'SELECT * FROM explainers.topics ORDER BY created_at DESC, id',
    statuses ? [statuses] : [],
  );
  return rows.map(toTopic);
}

/** The candidate pool, best first. */
export async function listPool(db: Queryable): Promise<TopicRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM explainers.topics WHERE status = 'pool' ORDER BY ${POOL_ORDER_BY}`,
  );
  return rows.map(toTopic);
}

/** Duplicate history (A-2): topics rendered inside the lookback window. */
export async function listRecentlyRendered(
  db: Queryable,
  lookbackDays: number,
  now: Date = new Date(),
): Promise<TopicRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM explainers.topics
      WHERE rendered_at IS NOT NULL
        AND rendered_at >= $1::timestamptz - make_interval(days => $2::int)
      ORDER BY rendered_at DESC`,
    [now.toISOString(), lookbackDays],
  );
  return rows.map(toTopic);
}

/** Lucas's Reject on a topic that has not been rendered or queued. */
export async function rejectTopic(db: Queryable, id: string, reason: string): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE explainers.topics
        SET status = 'rejected', reject_reason = $2, updated_at = now()
      WHERE id = $1 AND status IN ('proposed', 'pool', 'promoted')
      RETURNING id`,
    [id, reason],
  );
  return rows.length > 0;
}

// ── Spend ───────────────────────────────────────────────────────────────────

/**
 * Record one priced call. A job's running total moves in the same statement,
 * so the spend meter and the ledger cannot drift.
 */
export async function recordCost(db: Queryable, event: CostEventInput): Promise<void> {
  const usdKnown = event.usd !== null;
  const usd = event.usd ?? 0;
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`invalid cost: ${event.usd}`);
  await db.query(
    `WITH ev AS (
       INSERT INTO explainers.cost_events
         (job_id, idea_cycle_id, mode, vendor, component, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, usd, usd_known)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING job_id, usd
     )
     UPDATE explainers.jobs j
        SET spend_usd = j.spend_usd + ev.usd
       FROM ev
      WHERE j.id = ev.job_id`,
    [
      event.jobId ?? null,
      event.ideaCycleId ?? null,
      event.mode,
      event.vendor,
      event.component,
      event.inputTokens ?? 0,
      event.outputTokens ?? 0,
      event.cacheReadTokens ?? 0,
      event.cacheWriteTokens ?? 0,
      usd,
      usdKnown,
    ],
  );
}

/** Production spend on one Eastern-time day: renders plus the idea pipeline (A-4). */
export async function productionSpendForDay(db: Queryable, day: string): Promise<number> {
  const { rows } = await db.query<{ usd: unknown }>(
    `SELECT COALESCE(SUM(usd), 0) AS usd
       FROM explainers.cost_events
      WHERE mode = 'production'
        AND (created_at AT TIME ZONE '${NY_TZ}')::date = $1::date`,
    [day],
  );
  return num(rows[0].usd);
}

async function productionRendersForDay(db: Queryable, day: string): Promise<number> {
  const { rows } = await db.query<{ n: unknown }>(
    `SELECT count(*) AS n
       FROM explainers.jobs
      WHERE mode = 'production'
        AND (requested_at AT TIME ZONE '${NY_TZ}')::date = $1::date`,
    [day],
  );
  return num(rows[0].n);
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export type RenderRequest =
  | { ok: true; job: JobRow }
  | {
      ok: false;
      reason:
        | 'topic_not_found'
        | 'topic_not_renderable'
        | 'already_in_flight'
        | 'daily_render_cap'
        | 'daily_spend_cap';
    };

/** Topic states a render can start from. `queued` covers a retry after a failed job. */
const RENDERABLE: Record<JobTrigger, readonly TopicStatus[]> = {
  click: ['pool', 'promoted', 'queued'],
  auto: ['promoted'],
};

/**
 * Queue a render. Click renders a pool candidate (A-5); auto renders the
 * promoted topic. In production the E-17/A-4 daily caps apply to both.
 */
export async function requestRender(
  db: ExplainersDb,
  input: { topicId: string; trigger: JobTrigger; settings: ExplainersSettings; now?: Date },
): Promise<RenderRequest> {
  const { topicId, trigger, settings } = input;
  return db.transaction(async (tx) => {
    const { rows: topics } = await tx.query<{ status: TopicStatus }>(
      'SELECT status FROM explainers.topics WHERE id = $1 FOR UPDATE',
      [topicId],
    );
    if (!topics[0]) return { ok: false, reason: 'topic_not_found' } as const;
    if (!RENDERABLE[trigger].includes(topics[0].status)) {
      return { ok: false, reason: 'topic_not_renderable' } as const;
    }

    if (settings.mode === 'production') {
      const day = nyDate(input.now);
      if ((await productionRendersForDay(tx, day)) >= settings.daily_render_cap) {
        return { ok: false, reason: 'daily_render_cap' } as const;
      }
      if ((await productionSpendForDay(tx, day)) >= settings.daily_spend_cap_usd) {
        return { ok: false, reason: 'daily_spend_cap' } as const;
      }
    }

    const { rows } = await tx.query<Record<string, unknown>>(
      `INSERT INTO explainers.jobs
         (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model)
       VALUES ($1, 'requested', $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        topicId,
        trigger,
        settings.mode,
        settings.per_reel_cap_usd,
        settings.orchestrator_model,
        settings.frame_worker_model,
      ],
    );
    if (!rows[0]) return { ok: false, reason: 'already_in_flight' } as const;

    await tx.query(
      `UPDATE explainers.topics SET status = 'queued', updated_at = now() WHERE id = $1`,
      [topicId],
    );
    return { ok: true, job: toJob(rows[0]) } as const;
  });
}

/** Oldest requested job, if nothing is running (one render at a time, E-02). */
export async function claimNextJob(db: Queryable): Promise<JobRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE explainers.jobs
        SET status = 'running', started_at = now(), stage = 'claimed'
      WHERE id = (
              SELECT id FROM explainers.jobs
               WHERE status = 'requested'
               ORDER BY requested_at, seq
               LIMIT 1
               FOR UPDATE SKIP LOCKED
            )
        AND NOT EXISTS (SELECT 1 FROM explainers.jobs WHERE status = 'running')
      RETURNING *`,
  );
  return rows[0] ? toJob(rows[0]) : null;
}

export async function getJob(db: Queryable, id: string): Promise<JobRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    'SELECT * FROM explainers.jobs WHERE id = $1',
    [id],
  );
  return rows[0] ? toJob(rows[0]) : null;
}

export async function listJobs(db: Queryable, limit = 50): Promise<JobRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    'SELECT * FROM explainers.jobs ORDER BY requested_at DESC, seq DESC LIMIT $1',
    [limit],
  );
  return rows.map(toJob);
}

export async function setJobStage(
  db: Queryable,
  id: string,
  stage: string,
  sessions?: { sessionAId?: string; sessionBId?: string },
): Promise<void> {
  await db.query(
    `UPDATE explainers.jobs
        SET stage = $2,
            session_a_id = COALESCE($3, session_a_id),
            session_b_id = COALESCE($4, session_b_id)
      WHERE id = $1 AND status = 'running'`,
    [id, stage, sessions?.sessionAId ?? null, sessions?.sessionBId ?? null],
  );
}

/**
 * Close a running job. Success marks the topic rendered, which starts its
 * 45-day duplicate window. Failure leaves the topic `queued` so Lucas can
 * retry; every artifact the job wrote is kept either way.
 */
export async function finishJob(
  db: ExplainersDb,
  id: string,
  outcome: { status: 'ok' } | { status: 'failed'; error: string; capped?: boolean },
): Promise<JobRow | null> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `UPDATE explainers.jobs
          SET status = $2, error = $3, capped = $4, finished_at = now()
        WHERE id = $1 AND status = 'running'
        RETURNING *`,
      [
        id,
        outcome.status,
        outcome.status === 'failed' ? outcome.error : null,
        outcome.status === 'failed' ? Boolean(outcome.capped) : false,
      ],
    );
    const job = rows[0] ? toJob(rows[0]) : null;
    if (job && outcome.status === 'ok') {
      await tx.query(
        `UPDATE explainers.topics
            SET status = 'rendered', rendered_at = now(), updated_at = now()
          WHERE id = $1`,
        [job.topic_id],
      );
    }
    return job;
  });
}

/**
 * Jobs left `running` by a worker that died. Only one worker renders at a time
 * (E-02), so at start-up any running job is orphaned. Returns how many failed.
 */
export async function failStaleRunningJobs(db: Queryable, reason: string): Promise<number> {
  const { rows } = await db.query(
    `UPDATE explainers.jobs
        SET status = 'failed', error = $1, finished_at = now()
      WHERE status = 'running'
      RETURNING id`,
    [reason],
  );
  return rows.length;
}

// ── Artifacts and lint ──────────────────────────────────────────────────────

export async function addArtifact(
  db: Queryable,
  input: {
    jobId: string;
    kind: ArtifactKind;
    storagePath?: string | null;
    content?: string | null;
    bytes?: number | null;
  },
): Promise<ArtifactRow> {
  const { rows } = await db.query<ArtifactRow>(
    `INSERT INTO explainers.artifacts (job_id, kind, storage_path, content, bytes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.jobId, input.kind, input.storagePath ?? null, input.content ?? null, input.bytes ?? null],
  );
  return { ...rows[0], bytes: rows[0].bytes === null ? null : num(rows[0].bytes) };
}

export async function listArtifacts(db: Queryable, jobId: string): Promise<ArtifactRow[]> {
  const { rows } = await db.query<ArtifactRow>(
    'SELECT * FROM explainers.artifacts WHERE job_id = $1 ORDER BY seq',
    [jobId],
  );
  return rows.map((row) => ({ ...row, bytes: row.bytes === null ? null : num(row.bytes) }));
}

export async function addLintViolations(
  db: ExplainersDb,
  jobId: string,
  violations: readonly LintViolation[],
): Promise<void> {
  if (violations.length === 0) return;
  await db.transaction(async (tx) => {
    for (const v of violations) {
      await tx.query(
        `INSERT INTO explainers.lint_violations (job_id, source, rule, frame, severity, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [jobId, v.source, v.rule, v.frame, v.severity, v.detail],
      );
    }
  });
}

export async function listLintViolations(
  db: Queryable,
  jobId: string,
): Promise<(LintViolation & { id: string })[]> {
  const { rows } = await db.query<LintViolation & { id: string }>(
    `SELECT id, source, rule, frame, severity, detail
       FROM explainers.lint_violations
      WHERE job_id = $1
      ORDER BY frame NULLS FIRST, seq`,
    [jobId],
  );
  return rows;
}

// ── Review (E-08) ───────────────────────────────────────────────────────────

export async function saveFeedback(
  db: Queryable,
  input: {
    jobId: string;
    verdict: Verdict;
    tags: readonly string[];
    note?: string | null;
    createdBy?: string | null;
  },
): Promise<FeedbackRow> {
  const tags = normalizeFailureTags(input.tags);
  const { rows } = await db.query<FeedbackRow>(
    `INSERT INTO explainers.feedback (job_id, verdict, tags, note, created_by)
     VALUES ($1, $2, $3::text[], $4, $5)
     ON CONFLICT (job_id) DO UPDATE
       SET verdict = EXCLUDED.verdict,
           tags = EXCLUDED.tags,
           note = EXCLUDED.note,
           created_by = EXCLUDED.created_by,
           updated_at = now()
     RETURNING *`,
    [input.jobId, input.verdict, tags, input.note?.trim() || null, input.createdBy ?? null],
  );
  return rows[0];
}

export async function getFeedback(db: Queryable, jobId: string): Promise<FeedbackRow | null> {
  const { rows } = await db.query<FeedbackRow>(
    'SELECT * FROM explainers.feedback WHERE job_id = $1',
    [jobId],
  );
  return rows[0] ?? null;
}
