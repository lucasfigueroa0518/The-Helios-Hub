/**
 * The lab's local store (CONTRACT.md §Lab): PGlite like lib/memes/db.ts.
 * In-memory for tests; a data directory on disk for the lab (under the
 * already-ignored .memes-local/). One process owns a data directory at a time:
 * stop the dev server before running the CLI, or the reverse.
 * Nothing here touches intake, stories or lfd tables.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { PGlite } from '@electric-sql/pglite';

import type { LabTag, RankerStory } from '@/lib/news-ranker/types';

export type LabDb = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export const DEFAULT_LAB_DIR = path.join(process.cwd(), '.memes-local', 'news-ranker-lab', 'pgdata');

export const LAB_SCHEMA = `
CREATE TABLE IF NOT EXISTS lab_ratings (story_id text PRIMARY KEY, cool smallint NOT NULL CHECK (cool BETWEEN 0 AND 10), need_to_know smallint NOT NULL CHECK (need_to_know BETWEEN 0 AND 10), note text, tagged_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS lab_sets (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), window_from timestamptz NOT NULL, window_to timestamptz NOT NULL, stories jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS lab_runs (id text PRIMARY KEY, set_id text NOT NULL REFERENCES lab_sets(id), variant_id text NOT NULL, status text NOT NULL, estimate_usd numeric NOT NULL DEFAULT 0, cost_usd numeric NOT NULL DEFAULT 0, error text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
CREATE TABLE IF NOT EXISTS lab_scores (run_id text NOT NULL REFERENCES lab_runs(id), story_id text NOT NULL, variant_id text NOT NULL, cool double precision, need_to_know double precision, mixed double precision NOT NULL, final_position int, detail jsonb NOT NULL DEFAULT '{}', cost_usd numeric NOT NULL DEFAULT 0, PRIMARY KEY (run_id, story_id));
`;

export async function openLabDb(dataDir?: string): Promise<{ db: LabDb; pg: PGlite }> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.exec(LAB_SCHEMA);
  return { db: { query: async (text, params) => ({ rows: (await pg.query(text, params)).rows as never[] }) }, pg };
}

/* ── sets ─────────────────────────────────────────────────────────────── */

/** A frozen story plus every source name, for the tag view. */
export type SetStory = RankerStory & { sources: string[] };
export type LabSet = { id: string; createdAt: Date; windowFrom: Date; windowTo: Date; stories: SetStory[] };

const revive = (s: Record<string, unknown>): SetStory => ({
  ...(s as SetStory),
  eventDate: s.eventDate ? new Date(String(s.eventDate)) : null,
  firstSeen: new Date(String(s.firstSeen)),
});

export async function saveSet(db: LabDb, set: LabSet): Promise<void> {
  await db.query(`INSERT INTO lab_sets (id, created_at, window_from, window_to, stories) VALUES ($1, $2, $3, $4, $5::jsonb)`, [
    set.id, set.createdAt, set.windowFrom, set.windowTo, JSON.stringify(set.stories),
  ]);
}

type SetRow = { id: string; created_at: Date; window_from: Date; window_to: Date; stories: Record<string, unknown>[] };
const toSet = (r: SetRow): LabSet => ({ id: r.id, createdAt: new Date(r.created_at), windowFrom: new Date(r.window_from), windowTo: new Date(r.window_to), stories: r.stories.map(revive) });

export async function latestSet(db: LabDb): Promise<LabSet | null> {
  const { rows } = await db.query<SetRow>(`SELECT * FROM lab_sets ORDER BY created_at DESC LIMIT 1`);
  return rows[0] ? toSet(rows[0]) : null;
}

export async function listSets(db: LabDb): Promise<{ id: string; createdAt: string; n: number }[]> {
  const { rows } = await db.query<{ id: string; created_at: Date; n: number }>(`SELECT id, created_at, jsonb_array_length(stories) AS n FROM lab_sets ORDER BY created_at DESC`);
  return rows.map((r) => ({ id: r.id, createdAt: new Date(r.created_at).toISOString(), n: Number(r.n) }));
}

export async function getSet(db: LabDb, id: string): Promise<LabSet | null> {
  const { rows } = await db.query<SetRow>(`SELECT * FROM lab_sets WHERE id = $1`, [id]);
  return rows[0] ? toSet(rows[0]) : null;
}

/* ── tags ─────────────────────────────────────────────────────────────── */

export async function saveTag(db: LabDb, t: Omit<LabTag, 'taggedAt'>): Promise<void> {
  await db.query(
    `INSERT INTO lab_ratings (story_id, cool, need_to_know, note, tagged_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (story_id) DO UPDATE SET cool = EXCLUDED.cool, need_to_know = EXCLUDED.need_to_know, note = EXCLUDED.note, tagged_at = now()`,
    [t.storyId, t.cool, t.needToKnow, t.note ?? null],
  );
}

export async function deleteTag(db: LabDb, storyId: string): Promise<void> {
  await db.query(`DELETE FROM lab_ratings WHERE story_id = $1`, [storyId]);
}

export async function listTags(db: LabDb): Promise<Map<string, LabTag>> {
  const { rows } = await db.query<{ story_id: string; cool: number; need_to_know: number; note: string | null; tagged_at: Date }>(`SELECT * FROM lab_ratings`);
  return new Map(rows.map((r) => [r.story_id, { storyId: r.story_id, cool: Number(r.cool), needToKnow: Number(r.need_to_know), note: r.note ?? undefined, taggedAt: new Date(r.tagged_at) }]));
}

/* ── runs and scores ──────────────────────────────────────────────────── */

export async function spentUsd(db: LabDb): Promise<number> {
  const { rows } = await db.query<{ usd: string | number | null }>(`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM lab_runs`);
  return Number(rows[0]?.usd ?? 0);
}

export type RunRow = { id: string; set_id: string; variant_id: string; status: string; estimate_usd: number; cost_usd: number; error: string | null; started_at: Date; finished_at: Date | null };

export async function listRuns(db: LabDb, setId?: string): Promise<RunRow[]> {
  const { rows } = await db.query<RunRow>(
    setId ? `SELECT * FROM lab_runs WHERE set_id = $1 ORDER BY started_at DESC` : `SELECT * FROM lab_runs ORDER BY started_at DESC`,
    setId ? [setId] : [],
  );
  return rows.map((r) => ({ ...r, estimate_usd: Number(r.estimate_usd), cost_usd: Number(r.cost_usd) }));
}

/** The latest finished run of a variant on a set. */
export async function latestRun(db: LabDb, setId: string, variantId: string): Promise<RunRow | null> {
  const { rows } = await db.query<RunRow>(`SELECT * FROM lab_runs WHERE set_id = $1 AND variant_id = $2 AND status = 'ok' ORDER BY started_at DESC LIMIT 1`, [setId, variantId]);
  return rows[0] ?? null;
}

export type ScoreRecord = { runId: string; storyId: string; variantId: string; cool: number | null; needToKnow: number | null; mixed: number; finalPosition: number | null; detail: Record<string, unknown>; costUsd: number };

export async function saveScore(db: LabDb, s: ScoreRecord): Promise<void> {
  await db.query(
    `INSERT INTO lab_scores (run_id, story_id, variant_id, cool, need_to_know, mixed, final_position, detail, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     ON CONFLICT (run_id, story_id) DO UPDATE SET cool = EXCLUDED.cool, need_to_know = EXCLUDED.need_to_know, mixed = EXCLUDED.mixed,
       final_position = EXCLUDED.final_position, detail = EXCLUDED.detail, cost_usd = EXCLUDED.cost_usd`,
    [s.runId, s.storyId, s.variantId, s.cool, s.needToKnow, s.mixed, s.finalPosition, JSON.stringify(s.detail), s.costUsd],
  );
}

export async function scoresOf(db: LabDb, runId: string): Promise<ScoreRecord[]> {
  const { rows } = await db.query<{ run_id: string; story_id: string; variant_id: string; cool: number | null; need_to_know: number | null; mixed: number; final_position: number | null; detail: Record<string, unknown>; cost_usd: string | number }>(
    `SELECT * FROM lab_scores WHERE run_id = $1`,
    [runId],
  );
  return rows.map((r) => ({ runId: r.run_id, storyId: r.story_id, variantId: r.variant_id, cool: r.cool, needToKnow: r.need_to_know, mixed: r.mixed, finalPosition: r.final_position, detail: r.detail, costUsd: Number(r.cost_usd) }));
}
