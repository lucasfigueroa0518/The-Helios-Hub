import type { Queryable } from '@/lib/explainers/db';
import { nyDate } from '@/lib/explainers/repository';
import { compareStories } from '@/lib/real-case/scoring';
import type { StoryCheck } from '@/lib/real-case/source-check';
import {
  STORY_SCORE_KEYS,
  type Mode,
  type Polarity,
  type ScoutOutcome,
  type SeedTopic,
  type StoryBeats,
  type StoryClaim,
  type StoryRow,
  type StoryScores,
  type StorySource,
  type StoryStatus,
} from '@/lib/real-case/types';

export { nyDate };

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

function storyRow(r: Record<string, unknown>): StoryRow {
  return {
    ...(r as unknown as StoryRow),
    recognition: num(r.recognition),
    tension: num(r.tension),
    illumination: num(r.illumination),
    mechanism_fit: num(r.mechanism_fit),
    tellable: num(r.tellable),
    weighted_score: num(r.weighted_score),
    checked_at: iso(r.checked_at),
    scored_at: iso(r.scored_at),
    rendered_at: iso(r.rendered_at),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

/** A scored story's five scores, or null while any is missing. */
export function storyScores(row: Pick<StoryRow, (typeof STORY_SCORE_KEYS)[number]>): StoryScores | null {
  const out = {} as StoryScores;
  for (const key of STORY_SCORE_KEYS) {
    const value = row[key];
    if (value === null) return null;
    out[key] = value;
  }
  return out;
}

// ── Seeds: Explainer topics, read only (RC-01, RC-08) ───────────────────────

/**
 * The topics to search next: every non-archived Explainer topic (pool, rendered and rejected alike,
 * RC-08) that this route hasn't searched inside the cooldown, best Explainer score first. A search
 * that failed doesn't count, so the topic is tried again. Reads explainers.topics; never writes it.
 */
export async function pickSeedTopics(
  db: Queryable,
  opts: { limit: number; cooldownDays: number; now?: Date },
): Promise<SeedTopic[]> {
  if (opts.limit < 1) return [];
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT t.id, t.title, t.scope, t.term, t.status, t.weighted_score
       FROM explainers.topics t
      WHERE t.status <> 'archived'
        AND NOT EXISTS (
              SELECT 1 FROM real_case.topic_scouts s
               WHERE s.topic_id = t.id
                 AND s.outcome <> 'failed'
                 AND s.scouted_at > $2::timestamptz - make_interval(days => $3::int))
      ORDER BY t.weighted_score DESC NULLS LAST, t.created_at ASC
      LIMIT $1`,
    [opts.limit, (opts.now ?? new Date()).toISOString(), opts.cooldownDays],
  );
  return rows.map((r) => ({ ...(r as unknown as SeedTopic), weighted_score: num(r.weighted_score) }));
}

/** One Explainer topic by id, read only, or null (it may have been deleted on that side). */
export async function getSeedTopic(db: Queryable, id: string): Promise<SeedTopic | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    'SELECT id, title, scope, term, status, weighted_score FROM explainers.topics WHERE id = $1',
    [id],
  );
  return rows[0] ? { ...(rows[0] as unknown as SeedTopic), weighted_score: num(rows[0].weighted_score) } : null;
}

// ── Cycles and scouts ───────────────────────────────────────────────────────

/** Start a cycle. The nightly one is unique per New York day: null when today's already ran. */
export async function startCycle(db: Queryable, opts: { mode: Mode; trigger: 'auto' | 'click'; now?: Date }): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO real_case.story_cycles (status, mode, trigger, ny_date)
     VALUES ('running', $1, $2, $3::date)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [opts.mode, opts.trigger, nyDate(opts.now)],
  );
  return rows[0]?.id ?? null;
}

export async function finishCycle(
  db: Queryable,
  id: string,
  result: { status: 'ok' | 'failed'; error?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE real_case.story_cycles c
        SET status = $2, error = $3, finished_at = now(),
            topics_scouted = (SELECT count(*) FROM real_case.topic_scouts WHERE cycle_id = c.id),
            stories_found = (SELECT count(*) FROM real_case.stories WHERE cycle_id = c.id),
            stories_checked = (SELECT count(*) FROM real_case.stories WHERE cycle_id = c.id AND checked_at IS NOT NULL),
            stories_entering_pool = (SELECT count(*) FROM real_case.stories WHERE cycle_id = c.id AND status IN ('pool', 'promoted', 'rendered'))
      WHERE c.id = $1`,
    [id, result.status, result.error ?? null],
  );
}

export async function startScout(db: Queryable, topic: Pick<SeedTopic, 'id' | 'title'>, cycleId: string | null): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO real_case.topic_scouts (topic_id, topic_title, cycle_id, outcome)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [topic.id, topic.title, cycleId],
  );
  return rows[0].id;
}

export async function finishScout(
  db: Queryable,
  id: string,
  result: { outcome: Exclude<ScoutOutcome, 'running'>; storiesFound: number; bestScore?: number | null; error?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE real_case.topic_scouts SET outcome = $2, stories_found = $3, best_score = $4, error = $5 WHERE id = $1`,
    [id, result.outcome, result.storiesFound, result.bestScore ?? null, result.error ?? null],
  );
}

export type ScoutRow = {
  id: string;
  topic_id: string;
  topic_title: string;
  outcome: ScoutOutcome;
  stories_found: number;
  best_score: number | null;
  error: string | null;
  scouted_at: string;
};

/** Each topic's latest search, newest first (the lab page's weak and failed topics). */
export async function listLatestScouts(db: Queryable, limit = 100): Promise<ScoutRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT DISTINCT ON (topic_id) id, topic_id, topic_title, outcome, stories_found, best_score, error, scouted_at
       FROM real_case.topic_scouts
      ORDER BY topic_id, scouted_at DESC`,
  );
  return rows
    .map((r) => ({ ...(r as unknown as ScoutRow), best_score: num(r.best_score), scouted_at: iso(r.scouted_at)! }))
    .sort((a, b) => b.scouted_at.localeCompare(a.scouted_at))
    .slice(0, limit);
}

// ── Stories ─────────────────────────────────────────────────────────────────

export type NewStory = {
  topicId: string;
  scoutId: string | null;
  cycleId: string | null;
  term: string;
  title: string;
  summary: string;
  polarity: Polarity;
  story: StoryBeats;
  claims: StoryClaim[];
  sources: StorySource[];
};

export async function addStory(db: Queryable, s: NewStory): Promise<StoryRow> {
  const { rows } = await db.query<Record<string, unknown>>(
    `INSERT INTO real_case.stories (topic_id, scout_id, cycle_id, term, title, summary, polarity, story, claims, sources)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
     RETURNING *`,
    [s.topicId, s.scoutId, s.cycleId, s.term.trim(), s.title.trim(), s.summary, s.polarity, JSON.stringify(s.story), JSON.stringify(s.claims), JSON.stringify(s.sources)],
  );
  return storyRow(rows[0]);
}

export async function getStory(db: Queryable, id: string): Promise<StoryRow | null> {
  const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM real_case.stories WHERE id = $1', [id]);
  return rows[0] ? storyRow(rows[0]) : null;
}

/** Stories in the given statuses, best first. */
export async function listStories(db: Queryable, statuses: readonly StoryStatus[], limit = 200): Promise<StoryRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM real_case.stories
      WHERE status = ANY($1::text[])
      ORDER BY weighted_score DESC NULLS LAST, created_at DESC
      LIMIT $2`,
    [statuses, limit],
  );
  return rows.map(storyRow);
}

/**
 * Store the source check (RC-13). A failed core claim rejects the story; a failed non-core claim
 * stays on the row with its check, so the reel can see it may not say it.
 */
export async function saveStoryCheck(db: Queryable, id: string, check: StoryCheck): Promise<StoryStatus> {
  const rejected = check.failedCore.length > 0;
  const reason = rejected
    ? `Source check failed for core claim${check.failedCore.length > 1 ? 's' : ''} ${check.failedCore.join(', ')}: ${check.claims
        .filter((c) => check.failedCore.includes(c.id))
        .map((c) => `${c.id} ${c.check?.status}${c.check?.detail ? ` (${c.check.detail})` : ''}`)
        .join('; ')}.`
    : null;
  const { rows } = await db.query<{ status: StoryStatus }>(
    `UPDATE real_case.stories
        SET claims = $2::jsonb, checked_at = now(), updated_at = now(),
            status = CASE WHEN $3 THEN 'rejected' ELSE status END,
            reject_reason = CASE WHEN $3 THEN $4 ELSE reject_reason END
      WHERE id = $1
      RETURNING status`,
    [id, JSON.stringify(check.claims), rejected, reason],
  );
  return rows[0].status;
}

export async function saveStoryScores(
  db: Queryable,
  id: string,
  scores: StoryScores,
  total: number,
  notes: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `UPDATE real_case.stories
        SET recognition = $2, tension = $3, illumination = $4, mechanism_fit = $5, tellable = $6,
            weighted_score = $7, scored_at = now(), updated_at = now(),
            jev_notes = jev_notes || $8::jsonb
      WHERE id = $1`,
    [id, scores.recognition, scores.tension, scores.illumination, scores.mechanism_fit, scores.tellable, total, JSON.stringify(notes)],
  );
}

export async function setStoryStatus(
  db: Queryable,
  id: string,
  status: StoryStatus,
  opts: { reason?: string | null; duplicateOf?: string | null } = {},
): Promise<void> {
  await db.query(
    `UPDATE real_case.stories
        SET status = $2, reject_reason = $3, duplicate_of = $4, updated_at = now(),
            rendered_at = CASE WHEN $2 = 'rendered' THEN now() ELSE rendered_at END
      WHERE id = $1`,
    [id, status, opts.reason ?? null, opts.duplicateOf ?? null],
  );
}

/**
 * Keep the best `poolSize` pool stories (total, then the tie-breaks); the rest are displaced. A story
 * named in `keep` is never cut. Returns the ids displaced.
 */
export async function trimStoryPool(db: Queryable, poolSize: number, keep: string | null = null): Promise<string[]> {
  const pool = await listStories(db, ['pool'], 10_000);
  const ranked = pool
    .map((row) => ({ row, scores: storyScores(row) }))
    .sort((a, b) => {
      if (a.row.id === keep) return -1;
      if (b.row.id === keep) return 1;
      if (!a.scores || !b.scores) return a.scores ? -1 : b.scores ? 1 : 0;
      return compareStories(b.scores, a.scores);
    });
  const cut = ranked.slice(Math.max(0, poolSize)).map((r) => r.row.id);
  if (cut.length) {
    await db.query(
      `UPDATE real_case.stories SET status = 'displaced', reject_reason = 'Below the pool cut.', updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [cut],
    );
  }
  return cut;
}

/** Stories made into reels inside the lookback, for the duplicate check. */
export async function listRecentlyMadeStories(db: Queryable, lookbackDays: number, now: Date = new Date()): Promise<StoryRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM real_case.stories
      WHERE rendered_at IS NOT NULL AND rendered_at > $1::timestamptz - make_interval(days => $2::int)
      ORDER BY rendered_at DESC`,
    [now.toISOString(), lookbackDays],
  );
  return rows.map(storyRow);
}

// ── Costs ───────────────────────────────────────────────────────────────────

export type RealCaseCostInput = {
  cycleId?: string | null;
  /** A render's spend: also added to the job's spend_usd. */
  jobId?: string | null;
  storyId?: string | null;
  mode: Mode;
  vendor: 'anthropic' | 'heygen' | 'jev';
  component: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  webSearches?: number;
  /** null: the vendor gave no price (stored as unknown, never guessed). */
  usd: number | null;
};

export async function recordRealCaseCost(db: Queryable, e: RealCaseCostInput): Promise<void> {
  const usd = e.usd ?? 0;
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`invalid cost: ${e.usd}`);
  await db.query(
    `WITH ev AS (
       INSERT INTO real_case.cost_events
         (cycle_id, story_id, mode, vendor, component, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, web_searches, usd, usd_known, job_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING job_id, usd
     )
     UPDATE real_case.jobs j SET spend_usd = j.spend_usd + ev.usd FROM ev WHERE j.id = ev.job_id`,
    [
      e.cycleId ?? null,
      e.storyId ?? null,
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
      e.jobId ?? null,
    ],
  );
}

/** A cycle's spend so far (the nightly cap, RC-11). */
export async function cycleSpend(db: Queryable, cycleId: string): Promise<number> {
  const { rows } = await db.query<{ usd: unknown }>(
    'SELECT COALESCE(SUM(usd), 0) AS usd FROM real_case.cost_events WHERE cycle_id = $1',
    [cycleId],
  );
  return Number(rows[0].usd);
}
