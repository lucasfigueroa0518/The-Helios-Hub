import type { ExplainersDb, Queryable } from '@/lib/explainers/db';
import type { ExplainersSettings } from '@/lib/explainers/settings';
import { syncExplainerApproval } from '@/lib/explainers/publish/items';
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
  term?: string | null;
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
        `INSERT INTO explainers.topics (title, scope, term, source_url, source_text, origin)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          title,
          topic.scope?.trim() || null,
          topic.term?.trim() || null,
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

/** How many typed-in ideas (seeds) may wait in the pool at once; the 11th is refused with a plain message. */
export const MAX_OPEN_SEEDS = 10;

export async function openSeedCount(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM explainers.topics WHERE origin = 'manual' AND status = 'pool'`);
  return Number(rows[0]?.n ?? 0);
}

/** A topic with a post that went out is done: Generate is for what has not been published. */
async function topicPublished(db: Queryable, topicId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
      WHERE ci.vertical = 'explainers' AND ci.idea_ref = $1 AND a.status = 'published' LIMIT 1`,
    [topicId],
  );
  return rows.length > 0;
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
        | 'topic_published'
        | 'already_in_flight'
        | 'daily_render_cap'
        | 'daily_spend_cap';
    };

/**
 * What a render may start from. The night renders only a promoted topic. A person's click renders any
 * topic that is not archived (idea pool standard, 2026-10-21: every unpublished idea can always be
 * generated); a topic already posted is refused separately, in requestRender.
 */
const RENDERABLE: Record<JobTrigger, readonly TopicStatus[]> = {
  click: ['proposed', 'pool', 'rejected', 'displaced', 'promoted', 'queued', 'rendered'],
  auto: ['promoted'],
};

/** A render's typical cost for the "go over the cap?" question: the average of finished production renders, else the per-reel cap. */
export async function typicalRenderCostUsd(db: Queryable, settings: Pick<ExplainersSettings, 'per_reel_cap_usd'>): Promise<number> {
  const { rows } = await db.query<{ usd: string | null }>(
    `SELECT avg(spend_usd)::text AS usd FROM (SELECT spend_usd FROM explainers.jobs WHERE status = 'ok' AND mode = 'production' AND spend_usd > 0 ORDER BY requested_at DESC LIMIT 20) j`,
  );
  const avg = Number(rows[0]?.usd);
  return Number.isFinite(avg) && avg > 0 ? Math.round(avg * 100) / 100 : settings.per_reel_cap_usd;
}

/**
 * Queue a render. Click renders a pool candidate (A-5); auto renders the
 * promoted topic. In production the E-17/A-4 daily caps apply to both.
 */
export async function requestRender(
  db: ExplainersDb,
  input: { topicId: string; trigger: JobTrigger; settings: ExplainersSettings; now?: Date; overrideCaps?: boolean },
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

    if (trigger === 'click' && (await topicPublished(tx, topicId))) return { ok: false, reason: 'topic_published' } as const;

    // A person's confirmed click may go over the day's caps (it is one render, and the spend is recorded as any render's);
    // the night never does.
    if (settings.mode === 'production' && !(trigger === 'click' && input.overrideCaps)) {
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

/**
 * The openers of the latest reels before job `exceptJobId`, newest first (EX3-102): every job
 * that drew one, except failed ones (they never became a video).
 */
export async function recentOpeners(db: Queryable, exceptJobId: string, limit: number): Promise<string[]> {
  const { rows } = await db.query<{ opener: string }>(
    `SELECT opener FROM explainers.jobs
      WHERE opener IS NOT NULL AND id <> $1 AND status <> 'failed'
      ORDER BY seq DESC
      LIMIT $2`,
    [exceptJobId, limit],
  );
  return rows.map((r) => r.opener);
}

/** The hand-offs of the latest reels before job `exceptJobId`, newest first (Explainers 4.3). */
export async function recentHandoffs(db: Queryable, exceptJobId: string, limit: number): Promise<string[]> {
  const { rows } = await db.query<{ handoff: string }>(
    `SELECT handoff FROM explainers.jobs
      WHERE handoff IS NOT NULL AND id <> $1 AND status <> 'failed'
      ORDER BY seq DESC
      LIMIT $2`,
    [exceptJobId, limit],
  );
  return rows.map((r) => r.handoff);
}

/** Record the hand-off template job `id` drew (Explainers 4.3). */
export async function setJobHandoff(db: Queryable, id: string, handoff: string): Promise<void> {
  await db.query('UPDATE explainers.jobs SET handoff = $2 WHERE id = $1', [id, handoff]);
}

/** Record the opener job `id` drew. */
export async function setJobOpener(db: Queryable, id: string, opener: string): Promise<void> {
  await db.query('UPDATE explainers.jobs SET opener = $2 WHERE id = $1', [id, opener]);
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
    storageLocation?: 'local' | 'bucket';
  },
): Promise<ArtifactRow> {
  const { rows } = await db.query<ArtifactRow>(
    `INSERT INTO explainers.artifacts (job_id, kind, storage_path, content, bytes, storage_location)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.jobId, input.kind, input.storagePath ?? null, input.content ?? null, input.bytes ?? null, input.storageLocation ?? 'local'],
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
  // The lifecycle spine reads approval from one place for every type (D36).
  await syncExplainerApproval(db, input.jobId);
  return rows[0];
}

/** Why a render the hub rejected lost its waiting slot. */
export const REJECTED_SLOT_NOTE = 'This reel was rejected, so it was not posted.';

/**
 * Set a render's verdict from outside the review page (Social Hub actions,
 * D47), keeping the tags and note a reviewer already left unless the hub
 * sends its own (D53: tags from the review page's vocabulary, FAILURE_TAGS).
 * The spine mirror follows (saveFeedback). A rejection always wins: whatever
 * approval the item had (a person's, a Hard publish's, a setting's) becomes
 * a rejection, and its waiting slot is cancelled with the reason, as
 * Carousels and Trial Reels do.
 */
export async function setVerdict(
  db: Queryable,
  jobId: string,
  verdict: Verdict,
  by: string | null,
  review: { tags?: readonly string[]; note?: string | null } = {},
): Promise<FeedbackRow> {
  const existing = await getFeedback(db, jobId);
  const row = await saveFeedback(db, {
    jobId,
    verdict,
    tags: review.tags ?? existing?.tags ?? [],
    note: review.note !== undefined ? review.note : existing?.note ?? null,
    createdBy: by,
  });
  if (verdict === 'rejected') {
    await db.query(
      `UPDATE social_hub.schedule SET status = 'cancelled', error = $2
        WHERE status = 'scheduled'
          AND content_item_id = (SELECT ci.id FROM social_hub.content_items ci JOIN explainers.jobs j ON ci.native_ref = j.id::text
                                  WHERE ci.vertical = 'explainers' AND j.id = $1::uuid)`,
      [jobId, REJECTED_SLOT_NOTE],
    );
  }
  return row;
}

export async function getFeedback(db: Queryable, jobId: string): Promise<FeedbackRow | null> {
  const { rows } = await db.query<FeedbackRow>(
    'SELECT * FROM explainers.feedback WHERE job_id = $1',
    [jobId],
  );
  return rows[0] ?? null;
}

/**
 * Hard regenerate (Social Hub, SH-15/SH-16/SH-54): render this topic again
 * now. A topic that already rendered goes back to `promoted` so
 * `requestRender` accepts it; the daily caps still apply. The new render
 * becomes the current version when it finishes; earlier ones stay as history.
 */
export async function requestRerender(
  db: ExplainersDb,
  input: { topicId: string; settings: ExplainersSettings; now?: Date },
): Promise<RenderRequest> {
  const reopened = await db.query<{ id: string }>(
    `UPDATE explainers.topics SET status = 'promoted', updated_at = now() WHERE id = $1 AND status = 'rendered' RETURNING id`,
    [input.topicId],
  );
  const result = await requestRender(db, { topicId: input.topicId, trigger: 'click', settings: input.settings, now: input.now });
  // A cap refused it: the topic goes back to how it was.
  if (!result.ok && reopened.rows[0]) {
    await db.query(`UPDATE explainers.topics SET status = 'rendered', updated_at = now() WHERE id = $1 AND status = 'promoted'`, [input.topicId]);
  }
  return result;
}
