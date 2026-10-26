import type { HubQuery } from '@/lib/social-hub/db';
import { toMicros, type LedgerRow, type Pool } from '@/lib/social-hub/cost';
import { klingClipUsdSql } from '@/lib/reels/insights';

/**
 * Ledger reads for the cost model (§8a), SELECT only. The only money
 * sources: reels.cost_events (+ Kling clips, priced exactly as Trial Reels
 * cost analytics prices them), explainers.cost_events, carousel run costs
 * (social.runs.total_usd split by the run record's per-story costs),
 * stories.cost_events, Last Few Days runs (lfd.runs Claude and Jev spend,
 * on the post each run made), and AI Events runs (ai_events.runs Jev spend,
 * on the week's post). Denormalized totals (jobs.spend_usd, sets.spend_usd)
 * are never added; they are only checked against the rows (`agreement`).
 */

const NY = `'America/New_York'`;
const day = (column: string) => `to_char((${column} AT TIME ZONE ${NY})::date, 'YYYY-MM-DD')`;

/** Spend before this instant is Text on Screen development (lib/reels/analytics/rollups.ts defaultProdSpendSince). */
const REEL_PROD_SINCE = `COALESCE((SELECT (value #>> '{}')::timestamptz FROM reels.settings WHERE key = 'prod_spend_since'), '2026-09-30T04:00:00Z'::timestamptz)`;

export type CostReads = {
  reelEvents: Array<{ id: string; run_id: string | null; component: string; vendor: string; production: boolean; usd: string; ny_date: string }>;
  reelKling: Array<{ id: string; post_idea_id: string; slate_id: string | null; production: boolean; usd: string; ny_date: string }>;
  reelWeights: Array<{ run_id: string; post_idea_id: string; slate_id: string; usd: string }>;
  reelProduced: Array<{ run_id: string; run_day: string; post_idea_id: string; slate_id: string }>;
  explainerEvents: Array<{ id: string; job_id: string | null; component: string; vendor: string; production: boolean; unknown: boolean; usd: string; ny_date: string }>;
  explainerRendered: Array<{ job_id: string; ny_date: string; spend_usd: string }>;
  carouselRuns: Array<{
    id: string;
    kind: string;
    production: boolean;
    total_usd: string;
    claude_usd: string;
    jev_usd: string | null;
    ny_date: string;
    posts: Array<{ storyId?: string; costUsd?: number }> | null;
  }>;
  storyEvents: Array<{ id: string; set_id: string | null; component: string; vendor: string; production: boolean; usd: string; ny_date: string }>;
  storySets: Array<{ set_id: string; ny_date: string; spend_usd: string }>;
  /** Last Few Days runs with the post each made (null: it made none). Optional: older callers build reads without it. */
  lfdRuns?: Array<{ id: string; claude_usd: string; jev_usd: string; ny_date: string; post_id: string | null }>;
  /** AI Events runs with the week's post (null: it made none). Optional the same way. */
  aiEventsRuns?: Array<{ id: string; jev_usd: string; ny_date: string; post_id: string | null }>;
};

/** Trial Reels activities whose spend belongs to one post idea (lib/reels/analytics/rollups.ts). */
export const REEL_DIRECT_COMPONENTS = [
  'copy-caption', 'copy-rewrite', 'copy-pick', 'copy-story-match', 'full-story-cue', 'full-story-line',
  'reel-scene', 'reel-background', 'reel-color', 'reel-hook',
  'reel-motion',
  'song-pick', 'song-tag', 'song-narrow',
];

export const COST_SQL = {
  reelEvents: `SELECT id, run_id, component, vendor, (created_at >= ${REEL_PROD_SINCE}) AS production, usd::text AS usd, ${day('created_at')} AS ny_date FROM reels.cost_events`,
  reelKling: `SELECT id, post_idea_id, slate_id, (finished_at >= ${REEL_PROD_SINCE}) AS production, (${klingClipUsdSql('finished_at')})::text AS usd, ${day('finished_at')} AS ny_date
                FROM reels.video_jobs WHERE higgsfield_job_id IS NOT NULL AND finished_at IS NOT NULL`,
  reelWeights: `SELECT sl.run_id, j.post_idea_id, j.slate_id, sum(j.usd)::text AS usd
                  FROM (SELECT post_idea_id, slate_id, usd FROM reels.copy_jobs
                        UNION ALL SELECT post_idea_id, slate_id, usd FROM reels.visual_jobs
                        UNION ALL SELECT post_idea_id, slate_id, usd FROM reels.video_jobs) j
                  JOIN reels.score_slates sl ON sl.id = j.slate_id
                 GROUP BY sl.run_id, j.post_idea_id, j.slate_id`,
  reelProduced: `SELECT DISTINCT sl.run_id, ${day('r.requested_at')} AS run_day, v.post_idea_id, v.slate_id
                   FROM reels.video_jobs v
                   JOIN reels.score_slates sl ON sl.id = v.slate_id
                   JOIN reels.runs r ON r.id = sl.run_id
                  WHERE v.status = 'ok'`,
  explainerEvents: `SELECT e.id, e.job_id, e.component, e.vendor, (e.mode = 'production') AS production, (NOT e.usd_known) AS unknown, e.usd::text AS usd,
                           COALESCE(c.ny_date::text, ${day('e.created_at')}) AS ny_date
                      FROM explainers.cost_events e
                      LEFT JOIN explainers.idea_cycles c ON c.id = e.idea_cycle_id`,
  explainerRendered: `SELECT id AS job_id, ${day('finished_at')} AS ny_date, spend_usd::text AS spend_usd
                        FROM explainers.jobs WHERE status = 'ok' AND finished_at IS NOT NULL`,
  carouselRuns: `SELECT id, kind, (trigger <> 'cli') AS production, total_usd::text AS total_usd, claude_usd::text AS claude_usd,
                        record->'jev'->>'costUsd' AS jev_usd,
                        ${day('COALESCE(started_at, requested_at)')} AS ny_date,
                        CASE WHEN jsonb_typeof(record->'result'->'posts') = 'array'
                             THEN (SELECT jsonb_agg(jsonb_build_object('storyId', e->>'storyId', 'costUsd', (e->>'costUsd')::float8))
                                     FROM jsonb_array_elements(record->'result'->'posts') e)
                        END AS posts
                   FROM social.runs WHERE status IN ('ok', 'partial', 'failed')`,
  storyEvents: `SELECT e.id, e.set_id, e.component, e.vendor, e.usd::text AS usd, ${day('e.created_at')} AS ny_date,
                       (COALESCE(s.mode, 'production') = 'production') AS production
                  FROM stories.cost_events e LEFT JOIN stories.sets s ON s.id = e.set_id`,
  storySets: `SELECT id AS set_id, ny_date::text AS ny_date, spend_usd::text AS spend_usd
                FROM stories.sets WHERE status NOT IN ('requested', 'building')`,
  lfdRuns: `SELECT r.id::text AS id, r.claude_usd::text AS claude_usd, r.jev_usd::text AS jev_usd,
                   ${day('COALESCE(r.started_at, r.requested_at)')} AS ny_date,
                   (SELECT p.id::text FROM lfd.posts p WHERE p.run_id = r.id ORDER BY p.created_at DESC LIMIT 1) AS post_id
              FROM lfd.runs r WHERE r.status IN ('ok', 'partial', 'failed')`,
  // A rebuild re-renders the week's post in place (its run_id moves to the newest run), so a run's post is the
  // one it last rendered, else the week's post that wasn't rejected.
  aiEventsRuns: `SELECT r.id::text AS id, r.jev_usd::text AS jev_usd,
                        ${day('COALESCE(r.started_at, r.requested_at)')} AS ny_date,
                        (SELECT p.id::text FROM ai_events.posts p
                          WHERE p.run_id = r.id OR (r.week_key IS NOT NULL AND p.week_key = r.week_key)
                          ORDER BY (p.run_id = r.id) DESC NULLS LAST, (p.status <> 'rejected') DESC, p.created_at DESC LIMIT 1) AS post_id
                   FROM ai_events.runs r WHERE r.status IN ('ok', 'partial', 'failed', 'skipped')`,
} as const;

const EXPLAINER_KEYS = new Set<keyof typeof COST_SQL>(['explainerEvents', 'explainerRendered']);

/**
 * Explainer rows come from the explainers handle; when it can't be opened
 * (local PGlite mode) those two reads are empty and a note says so.
 */
export async function readCosts(q: HubQuery, explainersQ: Promise<HubQuery> | HubQuery = q): Promise<CostReads & { explainersMissing?: string }> {
  const keys = Object.keys(COST_SQL) as Array<keyof typeof COST_SQL>;
  let missing: string | undefined;
  const eq = await Promise.resolve(explainersQ).catch((error: unknown) => {
    missing = error instanceof Error ? error.message : String(error);
    return null;
  });
  const results = await Promise.all(keys.map((key) => {
    // A database without the lfd schema reads as no Last Few Days spend, never as a cost-read failure.
    if (key === 'lfdRuns' || key === 'aiEventsRuns') return q(COST_SQL[key]).catch(() => ({ rows: [] }));
    if (!EXPLAINER_KEYS.has(key)) return q(COST_SQL[key]);
    return eq ? eq(COST_SQL[key]) : Promise.resolve({ rows: [] });
  }));
  const reads = Object.fromEntries(keys.map((key, i) => [key, results[i]!.rows])) as unknown as CostReads;
  return missing ? { ...reads, explainersMissing: missing } : reads;
}

export function reelItem(postIdeaId: string, slateId: string | null): string {
  return `reels:${postIdeaId}:${slateId ?? 'none'}`;
}

/** Ledger rows and pools for every vertical, from the reads above. */
export function buildLedger(r: CostReads): { rows: LedgerRow[]; pools: Pool[] } {
  const rows: LedgerRow[] = [];
  const pools: Pool[] = [];
  const mode = (p: boolean): 'production' | 'development' => (p ? 'production' : 'development');

  // ── Trial Reels: direct activities split by each idea's job spend that night; the rest equally per reel made.
  const producedByRun = new Map<string, string[]>();
  const producedByDay = new Map<string, string[]>();
  for (const p of r.reelProduced) {
    const item = reelItem(p.post_idea_id, p.slate_id);
    producedByRun.set(p.run_id, [...(producedByRun.get(p.run_id) ?? []), item]);
    producedByDay.set(p.run_day, [...(producedByDay.get(p.run_day) ?? []), item]);
  }
  const weightsByRun = new Map<string, Array<{ item: string; weight: number }>>();
  for (const w of r.reelWeights) {
    const list = weightsByRun.get(w.run_id) ?? [];
    list.push({ item: reelItem(w.post_idea_id, w.slate_id), weight: Number(w.usd) });
    weightsByRun.set(w.run_id, list);
  }
  const runIds = new Set([...producedByRun.keys(), ...weightsByRun.keys(), ...r.reelEvents.map((e) => e.run_id).filter((x): x is string => !!x)]);
  for (const runId of runIds) {
    const produced = producedByRun.get(runId) ?? [];
    pools.push({ key: `reels:direct:${runId}`, items: weightsByRun.get(runId) ?? produced.map((item) => ({ item })), fallback: produced });
    pools.push({ key: `reels:night:${runId}`, items: produced.map((item) => ({ item })) });
  }
  for (const [d, items] of producedByDay) pools.push({ key: `reels:day:${d}`, items: items.map((item) => ({ item })) });
  for (const e of r.reelEvents) {
    const direct = REEL_DIRECT_COMPONENTS.includes(e.component);
    const pool = e.run_id ? `reels:${direct ? 'direct' : 'night'}:${e.run_id}` : `reels:day:${e.ny_date}`;
    rows.push({ id: `reels:ce:${e.id}`, vertical: 'reels', nyDate: e.ny_date, micros: toMicros(e.usd), target: { kind: 'pool', pool }, label: e.component, vendor: e.vendor, mode: mode(e.production) });
  }
  for (const k of r.reelKling) {
    rows.push({ id: `reels:kling:${k.id}`, vertical: 'reels', nyDate: k.ny_date, micros: toMicros(k.usd), target: { kind: 'item', item: reelItem(k.post_idea_id, k.slate_id) }, label: 'Kling clip', vendor: 'kling', mode: mode(k.production) });
  }

  // ── Explainers: rows with a job are direct; the day's idea-cycle rows split across that day's renders.
  const renderedByDay = new Map<string, string[]>();
  for (const j of r.explainerRendered) renderedByDay.set(j.ny_date, [...(renderedByDay.get(j.ny_date) ?? []), `explainers:${j.job_id}`]);
  for (const [d, items] of renderedByDay) pools.push({ key: `explainers:day:${d}`, items: items.map((item) => ({ item })) });
  for (const e of r.explainerEvents) {
    rows.push({
      id: `explainers:ce:${e.id}`,
      vertical: 'explainers',
      nyDate: e.ny_date,
      micros: toMicros(e.usd),
      target: e.job_id ? { kind: 'item', item: `explainers:${e.job_id}` } : { kind: 'pool', pool: `explainers:day:${e.ny_date}` },
      label: e.component,
      vendor: e.vendor,
      mode: mode(e.production),
      ...(e.unknown ? { unknown: true } : {}),
    });
  }

  // ── Carousels: each run's per-story costs are direct; the rest of total_usd splits across the run's posts.
  // A preview run's stories never post: their spend stays on a preview item (unshipped), not on the
  // daily post for the same story id (D22).
  for (const run of r.carouselRuns) {
    const total = toMicros(run.total_usd);
    const stories = (run.posts ?? []).filter((p): p is { storyId: string; costUsd?: number } => typeof p?.storyId === 'string');
    const itemOf = (storyId: string) => (run.kind === 'preview' ? `carousels:preview:${run.id}:${storyId}` : `carousels:story:${storyId}`);
    let direct = 0;
    for (const p of stories) {
      const micros = toMicros(p.costUsd ?? 0);
      direct += micros;
      rows.push({ id: `carousels:run:${run.id}:${p.storyId}`, vertical: 'carousels', nyDate: run.ny_date, micros, target: { kind: 'item', item: itemOf(p.storyId) }, label: 'story stages', vendor: 'carousel', mode: mode(run.production) });
    }
    pools.push({ key: `carousels:run:${run.id}`, items: stories.map((p) => ({ item: itemOf(p.storyId) })) });
    // Σ story costs above total_usd (rounding, or a failed run with total 0) is reported by agreement(), never allocated as negative money.
    if (total - direct > 0) {
      rows.push({ id: `carousels:run:${run.id}:shared`, vertical: 'carousels', nyDate: run.ny_date, micros: total - direct, target: { kind: 'pool', pool: `carousels:run:${run.id}` }, label: 'run (feeds, selection, set-aside stories)', vendor: 'carousel', mode: mode(run.production) });
    }
  }

  // ── Stories: rows with a set are direct; rows without split across that day's sets.
  const setsByDay = new Map<string, string[]>();
  for (const s of r.storySets) setsByDay.set(s.ny_date, [...(setsByDay.get(s.ny_date) ?? []), `stories:${s.set_id}`]);
  for (const [d, items] of setsByDay) pools.push({ key: `stories:day:${d}`, items: items.map((item) => ({ item })) });
  for (const e of r.storyEvents) {
    rows.push({
      id: `stories:ce:${e.id}`,
      vertical: 'stories',
      nyDate: e.ny_date,
      micros: toMicros(e.usd),
      target: e.set_id ? { kind: 'item', item: `stories:${e.set_id}` } : { kind: 'pool', pool: `stories:day:${e.ny_date}` },
      label: e.component,
      vendor: e.vendor,
      mode: mode(e.production),
    });
  }
  // ── Last Few Days: a run's Claude and Jev spend belongs to the post it made; a run with no post stays unattributed.
  for (const run of r.lfdRuns ?? []) {
    const pool = `last_few_days:run:${run.id}`;
    const target: LedgerRow['target'] = run.post_id ? { kind: 'item', item: `last_few_days:${run.post_id}` } : { kind: 'pool', pool };
    if (!run.post_id) pools.push({ key: pool, items: [] });
    const claude = toMicros(run.claude_usd);
    const jev = toMicros(run.jev_usd);
    if (claude > 0) rows.push({ id: `${pool}:claude`, vertical: 'last_few_days', nyDate: run.ny_date, micros: claude, target, label: 'writing and rewrites', vendor: 'anthropic', mode: 'production' });
    if (jev > 0) rows.push({ id: `${pool}:jev`, vertical: 'last_few_days', nyDate: run.ny_date, micros: jev, target, label: 'story picking and fact check (jev)', vendor: 'jev', mode: 'production' });
  }
  // ── AI Events: a run's Jev ranking spend belongs to the week's post; a run with no post stays unattributed. No Claude.
  for (const run of r.aiEventsRuns ?? []) {
    const pool = `ai_events:run:${run.id}`;
    const target: LedgerRow['target'] = run.post_id ? { kind: 'item', item: `ai_events:${run.post_id}` } : { kind: 'pool', pool };
    if (!run.post_id) pools.push({ key: pool, items: [] });
    const jev = toMicros(run.jev_usd);
    if (jev > 0) rows.push({ id: `${pool}:jev`, vertical: 'ai_events', nyDate: run.ny_date, micros: jev, target, label: 'event ranking (jev)', vendor: 'jev', mode: 'production' });
  }
  return { rows, pools };
}

/**
 * Denormalized totals vs the rows they summarize (§8a: "test they agree").
 * Returns each disagreement over one cent; the hub shows them as a note.
 */
export function agreement(r: CostReads): string[] {
  const out: string[] = [];
  const byJob = new Map<string, number>();
  for (const e of r.explainerEvents) if (e.job_id) byJob.set(e.job_id, (byJob.get(e.job_id) ?? 0) + toMicros(e.usd));
  for (const j of r.explainerRendered) {
    const diff = Math.abs(toMicros(j.spend_usd) - (byJob.get(j.job_id) ?? 0));
    if (diff > 10_000) out.push(`Explainer job ${j.job_id}: spend_usd ${j.spend_usd} vs cost rows ${(byJob.get(j.job_id) ?? 0) / 1e6}`);
  }
  for (const run of r.carouselRuns) {
    const total = toMicros(run.total_usd);
    const stories = (run.posts ?? []).reduce((sum, p) => sum + toMicros(p?.costUsd ?? 0), 0);
    if (stories - total > 10_000) out.push(`Carousel run ${run.id}: story costs ${stories / 1e6} exceed total_usd ${run.total_usd}`);
    if (run.jev_usd != null) {
      const parts = toMicros(run.claude_usd) + toMicros(run.jev_usd);
      if (Math.abs(parts - total) > 10_000) out.push(`Carousel run ${run.id}: total_usd ${run.total_usd} vs Claude + Jev ${parts / 1e6}`);
    }
  }
  const bySet = new Map<string, number>();
  for (const e of r.storyEvents) if (e.set_id) bySet.set(e.set_id, (bySet.get(e.set_id) ?? 0) + toMicros(e.usd));
  for (const s of r.storySets) {
    const diff = Math.abs(toMicros(s.spend_usd) - (bySet.get(s.set_id) ?? 0));
    if (diff > 10_000) out.push(`Story set ${s.set_id}: spend_usd ${s.spend_usd} vs cost rows ${(bySet.get(s.set_id) ?? 0) / 1e6}`);
  }
  return out;
}
