import type { Queryable } from '@/lib/explainers/db';
import { nyDate } from '@/lib/explainers/repository';
import { compareStories, freshness } from '@/lib/real-case/scoring';
import type { StoryCheck } from '@/lib/real-case/source-check';
import {
  STORY_SCORE_KEYS,
  type Mode,
  type Polarity,
  type ScoutOutcome,
  type NewsStory,
  type SeedTopic,
  type StoryClaim,
  type StoryRow,
  type StoryScores,
  type StorySource,
  type StoryStatus,
} from '@/lib/real-case/types';

export { nyDate };

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

/**
 * A `date` column as YYYY-MM-DD. Drivers differ on the Date they return (pg: local midnight; PGlite:
 * UTC midnight), so queries cast date columns to text and this only trims.
 */
function day(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v).slice(0, 10);
}

function storyRow(r: Record<string, unknown>): StoryRow {
  return {
    ...(r as unknown as StoryRow),
    // The story's own copy (jsonb) is the source of truth; the column is for SQL (expiry, the window).
    event_date: (r.story as { event_date?: string } | null)?.event_date ?? null,
    scores: (r.scores as StoryScores | null) ?? null,
    weighted_score: num(r.weighted_score),
    checked_at: iso(r.checked_at),
    scored_at: iso(r.scored_at),
    rendered_at: iso(r.rendered_at),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

/**
 * A scored story's scores, or null while any is missing. With `fresh`, freshness is recomputed from
 * the event date for that moment, so the pool ranks by today's freshness, not the day it was scored.
 */
export function storyScores(
  row: Pick<StoryRow, 'scores' | 'event_date'>,
  fresh?: { windowDays: number; now?: Date },
): StoryScores | null {
  if (!row.scores) return null;
  const out = {} as StoryScores;
  for (const key of STORY_SCORE_KEYS) {
    const value = row.scores[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    out[key] = value;
  }
  if (fresh && row.event_date) out.freshness = freshness(row.event_date, fresh.windowDays, fresh.now);
  return out;
}

// ── Topics: Explainer topics as labels, read only (RC-01, RC-27) ─────────────

/**
 * The Explainer topics a story can be labeled with: every non-archived one, best Explainer score
 * first. Reads explainers.topics; never writes it.
 */
export async function listLabelTopics(db: Queryable, limit = 80): Promise<SeedTopic[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT t.id, t.title, t.scope, t.term, t.status, t.weighted_score
       FROM explainers.topics t
      WHERE t.status <> 'archived'
      ORDER BY t.weighted_score DESC NULLS LAST, t.created_at ASC
      LIMIT $1`,
    [limit],
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

/** A search's row: `topic` is null for a news search (RC-27); its label is then "News search". */
export async function startScout(db: Queryable, topic: Pick<SeedTopic, 'id' | 'title'> | null, cycleId: string | null): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO real_case.topic_scouts (topic_id, topic_title, cycle_id, outcome)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [topic?.id ?? null, topic?.title ?? NEWS_SEARCH_LABEL, cycleId],
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

export const NEWS_SEARCH_LABEL = 'News search';

export type ScoutRow = {
  id: string;
  topic_id: string | null;
  topic_title: string;
  outcome: ScoutOutcome;
  stories_found: number;
  best_score: number | null;
  error: string | null;
  scouted_at: string;
};

/** The latest searches, newest first (the lab page). */
export async function listLatestScouts(db: Queryable, limit = 100): Promise<ScoutRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT id, topic_id, topic_title, outcome, stories_found, best_score, error, scouted_at
       FROM real_case.topic_scouts
      ORDER BY scouted_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ ...(r as unknown as ScoutRow), best_score: num(r.best_score), scouted_at: iso(r.scouted_at)! }));
}

// ── Stories ─────────────────────────────────────────────────────────────────

export type NewStory = {
  topicId: string | null;
  scoutId: string | null;
  cycleId: string | null;
  term: string;
  title: string;
  summary: string;
  polarity: Polarity;
  story: NewsStory;
  claims: StoryClaim[];
  sources: StorySource[];
};

export async function addStory(db: Queryable, s: NewStory): Promise<StoryRow> {
  const { rows } = await db.query<Record<string, unknown>>(
    `INSERT INTO real_case.stories (topic_id, scout_id, cycle_id, term, title, summary, polarity, story, claims, sources, event_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::date)
     RETURNING *`,
    [s.topicId, s.scoutId, s.cycleId, s.term.trim(), s.title.trim(), s.summary, s.polarity, JSON.stringify(s.story), JSON.stringify(s.claims), JSON.stringify(s.sources), s.story.event_date],
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

/** Replace a story's act material (the facts-only rebuild), noting why in jev_notes. */
export async function saveStoryMaterial(db: Queryable, id: string, story: NewsStory, note: Record<string, unknown>): Promise<void> {
  await db.query(
    `UPDATE real_case.stories SET story = $2::jsonb, jev_notes = jev_notes || $3::jsonb, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(story), JSON.stringify(note)],
  );
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
        SET scores = $2::jsonb, weighted_score = $3, scored_at = now(), updated_at = now(),
            jev_notes = jev_notes || $4::jsonb
      WHERE id = $1`,
    [id, JSON.stringify(scores), total, JSON.stringify(notes)],
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
 * Retire pool stories whose event is older than the news window, or that have no event date (the
 * first build's stories, RC-26): they move to `archived`. Returns the ids retired.
 */
export async function expireOldStories(db: Queryable, windowDays: number, now: Date = new Date()): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE real_case.stories
        SET status = 'archived', reject_reason = 'Older than the news window.', updated_at = now()
      WHERE status = 'pool'
        AND (event_date IS NULL OR event_date < ($1::timestamptz - make_interval(days => $2::int))::date)
      RETURNING id`,
    [now.toISOString(), windowDays],
  );
  return rows.map((r) => r.id);
}

/**
 * Keep the best `poolSize` pool stories (total with today's freshness, then the tie-breaks); the rest
 * are displaced. A story named in `keep` is never cut. Returns the ids displaced.
 */
export async function trimStoryPool(
  db: Queryable,
  poolSize: number,
  keep: string | null = null,
  fresh: { windowDays: number; now?: Date } = { windowDays: 90 },
): Promise<string[]> {
  const pool = await listStories(db, ['pool'], 10_000);
  const ranked = pool
    .map((row) => ({ row, scores: storyScores(row, fresh) }))
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

/**
 * Events the scout already found inside the news window, whatever became of them (pooled, made,
 * rejected), newest first: the scout skips them, so a search pays only for new events.
 */
export async function listKnownEvents(db: Queryable, windowDays: number, now: Date = new Date(), limit = 60): Promise<{ title: string; event_date: string | null }[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT title, event_date::text AS event_date FROM real_case.stories
      WHERE event_date IS NOT NULL AND event_date >= ($1::timestamptz - make_interval(days => $2::int))::date
      ORDER BY event_date DESC, created_at DESC
      LIMIT $3`,
    [now.toISOString(), windowDays, limit],
  );
  return rows.map((r) => ({ title: String(r.title), event_date: day(r.event_date) }));
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
  vendor: 'anthropic' | 'heygen' | 'jev' | 'openai';
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
