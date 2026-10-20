/**
 * The LFD lab's request handlers (LFD lab plan §7). Pure functions over the
 * lab database; the routes under app/api/memes/lfd-sims/ are thin wrappers.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { HubQuery } from '@/lib/social-hub/db';

import { ApiError } from '../api';
import { templateCard } from '../catalog';
import type { Queryable } from '../db';
import { FAULT_LABELS, type FaultId } from '../faults';
import { cellTable, clears, factorTable, fitOdds, MIN_CELL_N, tension } from '../odds';
import { getSettings, oddsRows, pendingRows, saveSettings } from '../odds-store';
import { TAGGER_VERSION } from '../story-tags';

import { requestSim, SIM_DIR, SIM_ESTIMATE_USD } from './run';

export type SimSummary = {
  id: string; asOf: string; replay: boolean; status: string; stage: string | null; costUsd: number; error: string | null;
  requestedAt: string; stories: number; memesPlaced: number; graded: boolean;
};

export async function listSims(db: Queryable): Promise<{ sims: SimSummary[]; estimateUsd: number }> {
  const { rows } = await db.query<{ id: string; as_of: string; replay: boolean; status: string; stage: string | null; cost: number; error: string | null; requested_at: string; stories: number; placed: number | null; graded: boolean }>(
    `SELECT s.id::text, s.as_of::text, s.replay, s.status, s.stage, s.cost_usd::float8 AS cost, s.error, s.requested_at::text,
            (SELECT count(*)::int FROM memes.lfd_sim_stories x WHERE x.sim_id = s.id) AS stories,
            jsonb_array_length(COALESCE(s.placement->'placed', '[]'::jsonb)) AS placed,
            EXISTS (SELECT 1 FROM memes.lfd_sim_grades gr WHERE gr.sim_id = s.id AND gr.rating IS NOT NULL) AS graded
       FROM memes.lfd_sims s ORDER BY s.requested_at DESC LIMIT 100`,
  );
  return {
    sims: rows.map((r) => ({ id: r.id, asOf: r.as_of, replay: r.replay, status: r.status, stage: r.stage, costUsd: r.cost, error: r.error, requestedAt: r.requested_at, stories: r.stories, memesPlaced: r.placed ?? 0, graded: r.graded })),
    estimateUsd: SIM_ESTIMATE_USD,
  };
}

/** Body: { asOf?: 'YYYY-MM-DD' } (a replay as of that day's 3:00 AM New York) or nothing for now. */
export async function createSim(db: Queryable, body: { asOf?: unknown }, by: string, now = new Date()): Promise<{ id: string }> {
  let asOf: Date | null = null;
  if (body.asOf != null && body.asOf !== '') {
    if (typeof body.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.asOf)) throw new ApiError(400, 'Pick a date as YYYY-MM-DD.');
    asOf = new Date(`${body.asOf}T07:00:00Z`);
    if (Number.isNaN(asOf.getTime())) throw new ApiError(400, 'That date is not valid.');
  }
  try {
    return { id: await requestSim(db, { asOf, by }, now) };
  } catch (err) {
    throw new ApiError(409, err instanceof Error ? err.message : String(err));
  }
}

export type SimMeme = {
  id: string; rank: number; templateName: string; hasImage: boolean;
  rating: number | null; note: string | null;
  faults: { count: number; flagged: Array<{ id: string; label: string }> } | null;
};
export type SimStory = {
  key: string; origIndex: number; headline: string; gated: boolean;
  tags: Record<string, unknown> | null; odds: { p: number; why: string; passes: boolean } | null;
  picker: { memeId: string | null; rank: number | null; reason: string } | null;
  requestId: string | null; requestStatus: string | null; memes: SimMeme[];
};

export async function getSim(db: Queryable, id: string) {
  const { rows } = await db.query<{ id: string; as_of: string; replay: boolean; status: string; stage: string | null; cost: number; error: string | null; record: Record<string, unknown>; original_post: Record<string, unknown> | null; final_post: Record<string, unknown> | null; placement: Record<string, unknown> | null; started_at: string | null; finished_at: string | null; now: string }>(
    `SELECT id::text, as_of::text, replay, status, stage, cost_usd::float8 AS cost, error, record, original_post, final_post, placement,
            started_at::text, finished_at::text, now()::text AS now FROM memes.lfd_sims WHERE id = $1`,
    [id],
  );
  const sim = rows[0];
  if (!sim) throw new ApiError(404, 'No such simulation.');
  const { rows: st } = await db.query<{ story_key: string; orig_index: number; headline: string; gated: boolean; tags: Record<string, unknown> | null; odds: SimStory['odds']; picker: SimStory['picker']; request_id: string | null; request_status: string | null }>(
    `SELECT x.story_key, x.orig_index, x.headline, x.gated, x.tags, x.odds, x.picker, x.request_id::text, r.status AS request_status
       FROM memes.lfd_sim_stories x LEFT JOIN memes.requests r ON r.id = x.request_id
      WHERE x.sim_id = $1 ORDER BY x.orig_index`,
    [id],
  );
  const reqIds = st.flatMap((s) => (s.request_id ? [s.request_id] : []));
  const { rows: memes } = reqIds.length
    ? await db.query<{ id: string; request_id: string; rank: number; template_id: string; image_path: string | null; rating: number | null; note: string | null; count: number | null; faults: { flagged: string[] } | null }>(
        `SELECT m.id::text, sl.request_id::text, m.rank, m.template_id, m.image_path, p.rating, p.note, f.count, f.faults
           FROM memes.memes m JOIN memes.slates sl ON sl.id = m.slate_id
           LEFT JOIN memes.picks p ON p.meme_id = m.id
           LEFT JOIN memes.meme_faults f ON f.meme_id = m.id
          WHERE sl.request_id = ANY($1::uuid[]) AND m.in_slate ORDER BY m.rank`,
        [reqIds],
      )
    : { rows: [] };
  const stories: SimStory[] = st.map((s) => ({
    key: s.story_key, origIndex: s.orig_index, headline: s.headline, gated: s.gated, tags: s.tags, odds: s.odds, picker: s.picker,
    requestId: s.request_id, requestStatus: s.request_status,
    memes: memes.filter((m) => m.request_id === s.request_id).map((m) => ({
      id: m.id, rank: m.rank, templateName: templateCard(m.template_id)?.name ?? m.template_id, hasImage: Boolean(m.image_path),
      rating: m.rating, note: m.note,
      faults: m.count == null ? null : { count: m.count, flagged: (m.faults?.flagged ?? []).map((f) => ({ id: f, label: FAULT_LABELS[f as FaultId] ?? f })) },
    })),
  }));
  const { rows: grade } = await db.query<{ rating: number | null; note: string | null }>(`SELECT rating, note FROM memes.lfd_sim_grades WHERE sim_id = $1`, [id]);
  const { rows: events } = await db.query<{ id: string; at: string; stage: string; message: string; count: number; usd: number | null }>(
    `SELECT id::text, at::text, stage, message, count, usd FROM memes.lfd_sim_events WHERE sim_id = $1 ORDER BY id DESC LIMIT 300`,
    [id],
  );
  return {
    id: sim.id, asOf: sim.as_of, replay: sim.replay, status: sim.status, stage: sim.stage, costUsd: sim.cost, error: sim.error,
    record: sim.record, original: sim.original_post, final: sim.final_post, placement: sim.placement, stories,
    grade: grade[0] ?? null,
    report: {
      startedAt: sim.started_at, finishedAt: sim.finished_at, serverNow: sim.now,
      events: events.reverse().map((e) => ({ id: e.id, at: e.at, stage: e.stage, message: e.message, count: e.count, usd: e.usd })),
    },
  };
}

export async function gradeSim(db: Queryable, id: string, body: { rating?: unknown; note?: unknown }, by: string) {
  const rating = body.rating;
  if (rating != null && !(typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 4)) throw new ApiError(400, 'Rate the post 1 to 4.');
  const note = body.note == null ? null : String(body.note).slice(0, 2000);
  const { rows } = await db.query<{ id: string }>(`SELECT id::text FROM memes.lfd_sims WHERE id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, 'No such simulation.');
  await db.query(
    `INSERT INTO memes.lfd_sim_grades (sim_id, rating, note, decided_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (sim_id) DO UPDATE SET rating = COALESCE(EXCLUDED.rating, memes.lfd_sim_grades.rating),
       note = CASE WHEN $5 THEN EXCLUDED.note ELSE memes.lfd_sim_grades.note END, decided_by = EXCLUDED.decided_by, decided_at = now()`,
    [id, rating ?? null, note, by, body.note !== undefined],
  );
  return { ok: true };
}

/** The gate's evidence, recomputed from the grades on every call. */
export async function simStats(db: Queryable, regime: string) {
  const rows = await oddsRows(db, regime);
  const model = fitOdds(rows);
  const settings = await getSettings(db);
  const pending = await pendingRows(db, regime);
  const pendingIn = (t: { tension: boolean; numberStory: boolean; shortHeadline: boolean }) =>
    pending.filter((p) => tension(p.tags) === t.tension && p.tags.numberStory === t.numberStory && p.tags.shortHeadline === t.shortHeadline).length;
  return {
    regime, taggerVersion: TAGGER_VERSION, stories: rows.length,
    base: model.base,
    factors: factorTable(rows),
    cells: cellTable(model).map((c) => ({ tension: tension(c.traits), numberStory: c.traits.numberStory, shortHeadline: c.traits.shortHeadline, pending: pendingIn({ tension: tension(c.traits), numberStory: c.traits.numberStory, shortHeadline: c.traits.shortHeadline }), ...c.odds.chain[c.odds.chain.length - 1]!, p: c.odds.p, passes: clears(c.odds, settings.gateThreshold), needs: Math.max(0, MIN_CELL_N - (c.odds.chain[c.odds.chain.length - 1]?.n ?? 0)) })),
    minCellN: MIN_CELL_N,
    settings,
  };
}

export async function updateSettings(db: Queryable, body: Record<string, unknown>) {
  try {
    return await saveSettings(db, body as never);
  } catch (err) {
    throw new ApiError(400, err instanceof Error ? err.message : String(err));
  }
}

/** A slide image of a simulation, only from inside that simulation's folder. */
export function simImage(id: string, rel: string): Buffer {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(404, 'No image.');
  const root = path.join(SIM_DIR, id);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw new ApiError(404, 'No image.');
  return fs.readFileSync(file);
}

export type ReplayDay = { day: string; reelsScored: number; carouselRuns: number; realPost: boolean };

/** How far back the replay calendar reaches. */
export const REPLAY_DAYS = 60;
/** A day can be replayed when its nightly reels batch scored at least this many stories (LFD needs 5 to make a post). */
export const MIN_REELS_SCORED = 5;

/**
 * Days a replay can use (the calendar): each day of the last REPLAY_DAYS with a nightly reels batch big enough, plus
 * how many carousel runs finished that day and whether the real Last Few Days post ran then. Read only, from the Hub.
 */
export async function replayDays(hub: HubQuery, now = new Date()): Promise<{ days: ReplayDay[]; minScored: number }> {
  const since = new Date(now.getTime() - REPLAY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const reels = await hub<{ day: string; n: number }>(
    `SELECT s.ny_date::text AS day, count(i.*)::int AS n FROM reels.score_slates s JOIN reels.idea_scores i ON i.slate_id = s.id
      WHERE s.ny_date >= $1::date GROUP BY s.ny_date`,
    [since],
  ).catch(() => ({ rows: [] as Array<{ day: string; n: number }> }));
  const carousels = await hub<{ day: string; n: number }>(
    `SELECT (finished_at AT TIME ZONE 'America/New_York')::date::text AS day, count(*)::int AS n FROM social.runs
      WHERE kind = 'daily' AND trigger <> 'cli' AND status IN ('ok', 'partial') AND finished_at >= $1::date GROUP BY 1`,
    [since],
  ).catch(() => ({ rows: [] as Array<{ day: string; n: number }> }));
  const posts = await hub<{ day: string }>(`SELECT DISTINCT ny_date::text AS day FROM lfd.posts WHERE status <> 'rejected' AND ny_date >= $1::date`, [since]).catch(() => ({ rows: [] as Array<{ day: string }> }));
  const c = new Map(carousels.rows.map((r) => [r.day, r.n]));
  const p = new Set(posts.rows.map((r) => r.day));
  const today = now.toISOString().slice(0, 10);
  return {
    minScored: MIN_REELS_SCORED,
    days: reels.rows
      .filter((r) => r.n >= MIN_REELS_SCORED && r.day <= today)
      .map((r) => ({ day: r.day, reelsScored: r.n, carouselRuns: c.get(r.day) ?? 0, realPost: p.has(r.day) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}
