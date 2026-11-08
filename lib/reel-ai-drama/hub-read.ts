
/**
 * What the Social Hub reads about AI Drama reels (HUB-WIRING-CONTRACT.md §4.4, §4.5, §4.7). The SQL constants are
 * SELECT only and their columns are frozen; B runs them through its own handle. Timestamps come back as text.
 * Write-free by design: hub read code imports this file directly (tests/social-hub-scope). Posting writes live in
 * hub-posting.ts.
 */

export type DramaQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
const NY = 'America/New_York';

/** to_regclass check; never DDL. False on any error (a handle that can't see the schema). */
export async function dramaSchemaReady(q: DramaQuery): Promise<boolean> {
  try {
    const { rows } = await q(`SELECT to_regclass('reel_ai_drama.feedback') IS NOT NULL AND to_regclass('reel_ai_drama.requests') IS NOT NULL AS ready`);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

const NEWEST = (kind: string, col = 'id') =>
  `(SELECT a.${col} FROM reel_ai_drama.artifacts a WHERE a.job_id = j.id AND a.kind = '${kind}' ORDER BY a.seq DESC LIMIT 1)`;

const SOURCES = `COALESCE((SELECT jsonb_agg(jsonb_build_object('url', s->>'url', 'title', s->>'title'))
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.pitch->'sources') = 'array' THEN p.pitch->'sources' ELSE '[]'::jsonb END) s), '[]'::jsonb)`;

export const DRAMA_JOBS_SQL = `
SELECT j.id::text AS job_id, j.pitch_id::text AS pitch_id, j.status, j.trigger, j.mode, j.stage,
       j.spend_usd, j.spend_cap_usd, j.requested_at::text AS requested_at, j.started_at::text AS started_at, j.finished_at::text AS finished_at,
       j.error, j.kill_reason,
       CASE WHEN jsonb_typeof(j.flags) = 'array' THEN jsonb_array_length(j.flags) ELSE 0 END AS flags,
       p.title, COALESCE(p.pitch->>'brief', p.pitch->>'pitch') AS brief, p.pitch->>'story_type' AS story_type, p.pitch->>'era' AS era,
       p.central_player_id, p.rank_score, p.drama_score, p.material_score, p.visuals_grade,
       ${SOURCES} AS sources,
       f.verdict, f.tags, f.note, f.updated_at::text AS feedback_at,
       ${NEWEST('video')}::text AS video_artifact_id, ${NEWEST('video', 'storage_location')} AS video_location,
       ${NEWEST('contact_sheet')}::text AS sheet_artifact_id,
       COALESCE(${NEWEST('post_caption', 'content')},
                (SELECT CASE WHEN a.content ~ '^\\s*\\{' THEN (a.content::jsonb)->>'caption' END FROM reel_ai_drama.artifacts a
                  WHERE a.job_id = j.id AND a.kind = 'post_text' ORDER BY a.seq DESC LIMIT 1)) AS caption,
       (SELECT CASE WHEN a.content ~ '^\\s*\\{' AND jsonb_typeof((a.content::jsonb)->'seconds') = 'number' THEN ((a.content::jsonb)->>'seconds')::float8 END
          FROM reel_ai_drama.artifacts a WHERE a.job_id = j.id AND a.kind = 'delivery_report' ORDER BY a.seq DESC LIMIT 1) AS seconds
  FROM reel_ai_drama.jobs j
  JOIN reel_ai_drama.pitches p ON p.id = j.pitch_id
  LEFT JOIN reel_ai_drama.feedback f ON f.job_id = j.id
 WHERE p.status NOT IN ('killed', 'retired')
 ORDER BY j.seq DESC`;

export const DRAMA_PITCHES_SQL = `
SELECT p.id::text AS pitch_id, p.title, COALESCE(p.pitch->>'brief', p.pitch->>'pitch') AS brief, p.status, p.origin,
       p.rank_score, p.drama_score, p.material_score, p.visuals_grade,
       p.event_date::text AS event_date, p.central_player_id, p.created_at::text AS created_at,
       (SELECT count(*)::int FROM reel_ai_drama.jobs o WHERE o.pitch_id = p.id AND o.status = 'ok') AS ok_jobs,
       (SELECT max(o.finished_at)::text FROM reel_ai_drama.jobs o WHERE o.pitch_id = p.id AND o.status = 'ok') AS last_made_at,
       EXISTS (SELECT 1 FROM reel_ai_drama.jobs o
                 JOIN social_hub.content_items ci ON ci.vertical = 'reel_ai_drama' AND ci.native_ref = o.id::text
                 JOIN social_hub.publish_attempts pa ON pa.content_item_id = ci.id
                WHERE o.pitch_id = p.id AND pa.status = 'published') AS published,
       EXISTS (SELECT 1 FROM reel_ai_drama.jobs o
                 JOIN social_hub.content_items ci ON ci.vertical = 'reel_ai_drama' AND ci.native_ref = o.id::text
                 JOIN social_hub.schedule s ON s.content_item_id = ci.id
                WHERE o.pitch_id = p.id AND s.status IN ('scheduled', 'publishing')) AS scheduled,
       lj.id::text AS job_id, lj.status AS job_status, lj.stage AS job_stage, lj.error AS job_error,
       lj.requested_at::text AS job_requested_at, lj.started_at::text AS job_started_at,
       p.reject_reason, p.revive_when
  FROM reel_ai_drama.pitches p
  LEFT JOIN LATERAL (SELECT * FROM reel_ai_drama.jobs o WHERE o.pitch_id = p.id ORDER BY o.seq DESC LIMIT 1) lj ON true
 WHERE p.status IN ('pooled', 'picked', 'made')
 ORDER BY p.rank_score DESC NULLS LAST, p.created_at DESC
 LIMIT 200`;

/** Row shapes of DRAMA_JOBS_SQL and DRAMA_PITCHES_SQL (frozen). */
export type DramaJobRow = {
  job_id: string; pitch_id: string; status: string; trigger: string; mode: string; stage: string | null;
  spend_usd: number | string; spend_cap_usd: number | string; requested_at: string; started_at: string | null; finished_at: string | null;
  error: string | null; kill_reason: string | null; flags: number;
  title: string; brief: string | null; story_type: string | null; era: string | null; central_player_id: string | null;
  rank_score: number | string | null; drama_score: number | string | null; material_score: number | string | null; visuals_grade: string | null;
  sources: Array<{ url: string; title: string | null }>;
  verdict: string | null; tags: string[] | null; note: string | null; feedback_at: string | null;
  video_artifact_id: string | null; video_location: string | null; sheet_artifact_id: string | null;
  caption: string | null; seconds: number | null;
};

export type DramaPitchRow = {
  pitch_id: string; title: string; brief: string | null; status: string; origin: string;
  rank_score: number | string | null; drama_score: number | string | null; material_score: number | string | null; visuals_grade: string | null;
  event_date: string | null; central_player_id: string | null; created_at: string;
  ok_jobs: number; last_made_at: string | null; published: boolean; scheduled: boolean;
  job_id: string | null; job_status: string | null; job_stage: string | null; job_error: string | null; job_requested_at: string | null; job_started_at: string | null;
  reject_reason: string | null; revive_when: string | null;
};

export const DRAMA_REQUIRE_APPROVAL_SQL = `SELECT value FROM reel_ai_drama.settings WHERE key = 'require_approval'`;
export const DRAMA_POSTS_PER_DAY_SQL = `SELECT value FROM reel_ai_drama.settings WHERE key = 'posts_per_day'`;

// ── Health, cost, progress, misses ──────────────────────────────────────────

export type DramaNightHealth = {
  nights: Array<{ id: string; status: string; quota: number; requested: number; skipReason: string | null; error: string | null; at: string }>;
  jobs: Array<{ id: string; status: string; stage: string | null; error: string | null; capped: boolean; spend: number; trigger: string; at: string }>;
  requests: Array<{ id: string; kind: 'develop' | 'calibrate'; status: string; error: string | null; at: string }>;
  cost: { usd: number; unknown: number };
};

export async function readDramaNightHealth(q: DramaQuery, w: { nyDate: string; start: string; end: string }): Promise<DramaNightHealth> {
  const [nights, jobs, requests, cost] = await Promise.all([
    q(
      `SELECT id::text AS id, status, quota, CASE WHEN jsonb_typeof(requested) = 'array' THEN jsonb_array_length(requested) ELSE 0 END AS requested,
              skip_reason, error, started_at::text AS at
         FROM reel_ai_drama.nights WHERE ny_date = $1::date ORDER BY started_at`,
      [w.nyDate],
    ),
    q(
      `SELECT id::text AS id, status, stage, error, capped, spend_usd, trigger, requested_at::text AS at
         FROM reel_ai_drama.jobs WHERE requested_at >= $1::timestamptz AND requested_at < $2::timestamptz ORDER BY requested_at`,
      [w.start, w.end],
    ),
    q(
      `SELECT id::text AS id, kind, status, error, requested_at::text AS at
         FROM reel_ai_drama.requests WHERE requested_at >= $1::timestamptz AND requested_at < $2::timestamptz ORDER BY requested_at`,
      [w.start, w.end],
    ),
    q(
      `SELECT COALESCE(SUM(usd), 0)::float8 AS usd, count(*) FILTER (WHERE NOT usd_known)::int AS unknown
         FROM reel_ai_drama.cost_events WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
      [w.start, w.end],
    ),
  ]);
  return {
    nights: nights.rows.map((r) => ({ id: r.id, status: r.status, quota: Number(r.quota), requested: Number(r.requested), skipReason: r.skip_reason ?? null, error: r.error ?? null, at: r.at })),
    jobs: jobs.rows.map((r) => ({ id: r.id, status: r.status, stage: r.stage ?? null, error: r.error ?? null, capped: Boolean(r.capped), spend: Number(r.spend_usd), trigger: r.trigger, at: r.at })),
    requests: requests.rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, error: r.error ?? null, at: r.at })),
    cost: { usd: Number(cost.rows[0]?.usd ?? 0), unknown: Number(cost.rows[0]?.unknown ?? 0) },
  };
}

export type DramaCostEventRow = { id: string; job_id: string | null; session_id: string | null; component: string; vendor: string; production: boolean; unknown: boolean; usd: string; ny_date: string };
export type DramaRenderedRow = { job_id: string; ny_date: string; spend_usd: string };

export async function readDramaCosts(q: DramaQuery): Promise<{ events: DramaCostEventRow[]; rendered: DramaRenderedRow[] }> {
  const [events, rendered] = await Promise.all([
    q(
      `SELECT id::text AS id, job_id::text AS job_id, session_id::text AS session_id, component, vendor,
              (mode = 'production') AS production, (NOT usd_known) AS unknown, usd::text AS usd,
              ((created_at AT TIME ZONE '${NY}')::date)::text AS ny_date
         FROM reel_ai_drama.cost_events ORDER BY created_at`,
    ),
    q(
      `SELECT id::text AS job_id, ((coalesce(finished_at, requested_at) AT TIME ZONE '${NY}')::date)::text AS ny_date, spend_usd::text AS spend_usd
         FROM reel_ai_drama.jobs WHERE status = 'ok' ORDER BY finished_at`,
    ),
  ]);
  return { events: events.rows as DramaCostEventRow[], rendered: rendered.rows as DramaRenderedRow[] };
}

export async function readDramaCacheTokens(
  q: DramaQuery,
  f: { mode: 'production' | 'development' | null; from: string | null; to: string | null },
): Promise<Array<{ readTokens: number; writeTokens: number }>> {
  const { rows } = await q(
    `SELECT cache_read_tokens, cache_write_tokens FROM reel_ai_drama.cost_events
      WHERE vendor = 'anthropic'
        AND ($1::text IS NULL OR mode = $1::text)
        AND ($2::date IS NULL OR (created_at AT TIME ZONE '${NY}')::date >= $2::date)
        AND ($3::date IS NULL OR (created_at AT TIME ZONE '${NY}')::date <= $3::date)`,
    [f.mode, f.from, f.to],
  );
  return rows.map((r) => ({ readTokens: Number(r.cache_read_tokens ?? 0), writeTokens: Number(r.cache_write_tokens ?? 0) }));
}

export async function readDramaDailySpendCap(q: DramaQuery): Promise<number | null> {
  const { rows } = await q(`SELECT value FROM reel_ai_drama.settings WHERE key = 'daily_spend_cap_usd'`);
  if (!rows[0]) return 20;
  const n = Number(typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const DRAMA_COST_COMPONENTS: readonly string[] = [
  'producer', 'drama_score', 'material_score', 'same_event', 'visuals_check', 'rebrief', 'reporting', 'harvest_look', 'harvest_search',
  'harvest_sketch', 'harvest_wish_search', 'writer', 'writer_revise', 'story_notes', 'director', 'creative_pass', 'make', 'voice',
  'sound_design', 'facts_check', 'integrity_check', 'first_viewer', 'design_review_fast', 'design_review_judge', 'post_text',
];

export type DramaProgressRow = { id: string; pitchId: string; label: string; state: 'queued' | 'running' | 'failed'; stage: string | null; error: string | null; requestedAt: string; startedAt: string | null };

/** Live jobs, and ones that failed in the last 12 hours; plus how long a finished job typically takes (median of the last 10). */
export async function readDramaProgress(q: DramaQuery): Promise<{ rows: DramaProgressRow[]; typicalSeconds: number | null }> {
  const [live, typical] = await Promise.all([
    q(
      `SELECT j.id::text AS id, j.pitch_id::text AS pitch_id, p.title, j.status, j.stage, j.error, j.requested_at::text AS requested_at, j.started_at::text AS started_at
         FROM reel_ai_drama.jobs j JOIN reel_ai_drama.pitches p ON p.id = j.pitch_id
        WHERE j.status IN ('queued', 'running') OR (j.status = 'failed' AND j.finished_at > now() - interval '12 hours')
        ORDER BY j.seq`,
    ),
    q(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s)::float8 AS median FROM (
         SELECT extract(epoch FROM finished_at - started_at) AS s FROM reel_ai_drama.jobs
          WHERE status = 'ok' AND started_at IS NOT NULL AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 10) t`,
    ),
  ]);
  const median = typical.rows[0]?.median;
  return {
    rows: live.rows.map((r) => ({
      id: r.id, pitchId: r.pitch_id, label: r.title, state: r.status as DramaProgressRow['state'], stage: r.stage ?? null, error: r.error ?? null,
      requestedAt: r.requested_at, startedAt: r.started_at ?? null,
    })),
    typicalSeconds: median == null ? null : Math.round(Number(median)),
  };
}

/** Latest job per pitch requested today (NY) that failed. key = pitch id. */
export async function readDramaMisses(q: DramaQuery, todayNy: string): Promise<Array<{ key: string; reason: string | null }>> {
  const { rows } = await q(
    `SELECT pitch_id, status, error FROM (
       SELECT DISTINCT ON (pitch_id) pitch_id::text AS pitch_id, status, error FROM reel_ai_drama.jobs
        WHERE (requested_at AT TIME ZONE '${NY}')::date = $1::date ORDER BY pitch_id, seq DESC) t
      WHERE status = 'failed'`,
    [todayNy],
  );
  return rows.map((r) => ({ key: r.pitch_id, reason: r.error ?? null }));
}
