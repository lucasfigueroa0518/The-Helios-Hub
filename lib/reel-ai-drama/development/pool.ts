import type { Queryable } from '@/lib/explainers/db';
import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Pitch, PitchRow, PitchStatus, Score, VisualsCard, VisualsGrade } from '@/lib/reel-ai-drama/types';
import { DAY_MS, daysBetween, toDateOnly, toIso } from '@/lib/reel-ai-drama/development/util';

/**
 * The pool (PROCESS.md D7, MD-30, MD-32): no human greenlight, so the ranking decides. A story must clear
 * both bars; passing stories rank mainly on drama, material adds a little, fresh news with a why-now
 * gets a small bonus, stale news fades, and no player is made twice within `spread_days`.
 */

export const DRAMA_WEIGHT = 0.85;
export const MATERIAL_WEIGHT = 0.15;
export const FRESH_BONUS = 0.05;
export const AMBER_PENALTY = 0.03;
export const FADE_FACTOR = 0.5;
/** News past this many multiples of `news_window_days` (with no why-now) is retired, not just faded. */
export const RETIRE_WINDOWS = 2;

export const REVIVE_STALE_NEWS = 'a fresh development gives the story a why-now';

type RankSettings = Pick<ReelAiDramaSettings, 'drama_bar' | 'material_bar' | 'fresh_days' | 'news_window_days'>;

/**
 * A news story is one whose event was inside the news window when it was pitched; anything older was
 * pitched as history, which may be from any date (MD-09) and never fades.
 */
export function isNews(row: Pick<PitchRow, 'event_date' | 'created_at'>, settings: Pick<ReelAiDramaSettings, 'news_window_days'>): boolean {
  if (!row.event_date) return false;
  return daysBetween(row.event_date, new Date(row.created_at)) <= settings.news_window_days;
}

export function rankScore(row: PitchRow, settings: RankSettings, now: Date): number {
  const drama = row.drama_score;
  const material = row.material_score;
  if (drama === null || material === null || drama < settings.drama_bar || material < settings.material_bar) return 0;
  let rank = DRAMA_WEIGHT * drama + MATERIAL_WEIGHT * material;
  if (row.visuals_grade === 'amber') rank -= AMBER_PENALTY;
  if (isNews(row, settings) && row.event_date) {
    const age = daysBetween(row.event_date, now);
    const whyNow = !!row.pitch.why_now;
    if (age <= settings.fresh_days && whyNow) rank += FRESH_BONUS;
    if (age > settings.news_window_days && !whyNow) rank *= FADE_FACTOR;
  }
  return Math.round(Math.max(0, rank) * 10000) / 10000;
}

export function pitchFromRow(r: Record<string, unknown>): PitchRow {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id),
    session_id: (r.session_id as string | null) ?? null,
    cell_id: (r.cell_id as string | null) ?? null,
    origin: r.origin as PitchRow['origin'],
    title: String(r.title),
    pitch: r.pitch as Pitch,
    event_key: String(r.event_key),
    event_date: toDateOnly(r.event_date),
    central_player_id: (r.central_player_id as string | null) ?? null,
    status: r.status as PitchStatus,
    duplicate_of: (r.duplicate_of as string | null) ?? null,
    reject_reason: (r.reject_reason as string | null) ?? null,
    revive_when: (r.revive_when as string | null) ?? null,
    drama: (r.drama as Score | null) ?? null,
    drama_score: num(r.drama_score),
    material: (r.material as Score | null) ?? null,
    material_score: num(r.material_score),
    visuals_card: (r.visuals_card as VisualsCard | null) ?? null,
    visuals_grade: (r.visuals_grade as VisualsGrade | null) ?? null,
    rank_score: num(r.rank_score),
    created_at: toIso(r.created_at) ?? '',
    updated_at: toIso(r.updated_at) ?? '',
    made_at: toIso(r.made_at),
  };
}

export async function pooledPitches(db: Queryable): Promise<PitchRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM reel_ai_drama.pitches WHERE status = 'pooled'`);
  return rows.map(pitchFromRow);
}

/** Players picked or made within `spread_days` (MD-32: one documentary per player per week). */
export async function recentPlayers(db: Queryable, spreadDays: number, now: Date): Promise<Set<string>> {
  const since = new Date(now.getTime() - spreadDays * DAY_MS).toISOString();
  const { rows } = await db.query<{ central_player_id: string }>(
    `SELECT DISTINCT central_player_id FROM reel_ai_drama.pitches
     WHERE central_player_id IS NOT NULL
       AND ((status = 'made' AND made_at >= $1) OR (status = 'picked' AND updated_at >= $1))`,
    [since],
  );
  return new Set(rows.map((r) => r.central_player_id));
}

/** The pool ranked now, best first (ties: older pitch first). */
export function rankPool(rows: PitchRow[], settings: RankSettings, now: Date): { row: PitchRow; rank: number }[] {
  return rows
    .map((row) => ({ row, rank: rankScore(row, settings, now) }))
    .filter((x) => x.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.row.created_at.localeCompare(b.row.created_at));
}

/** The top pooled pitch whose central player has not been made or picked within `spread_days`. */
export async function nextForProduction(db: Queryable, settings: ReelAiDramaSettings, now: Date): Promise<PitchRow | null> {
  const blocked = await recentPlayers(db, settings.spread_days, now);
  for (const { row } of rankPool(await pooledPitches(db), settings, now)) {
    if (row.central_player_id && blocked.has(row.central_player_id)) continue;
    return row;
  }
  return null;
}

/**
 * Tend the pool: re-rank every pooled pitch for today (`rechecked`), count the news that has faded
 * past its window without a why-now (`faded`), and retire it once it is RETIRE_WINDOWS windows old,
 * recording what would revive it (`retired`).
 */
export async function tendPool(
  db: Queryable,
  settings: ReelAiDramaSettings,
  now: Date,
): Promise<{ faded: number; retired: number; rechecked: number }> {
  let faded = 0;
  let retired = 0;
  let rechecked = 0;
  for (const row of await pooledPitches(db)) {
    const stale = isNews(row, settings) && !row.pitch.why_now && row.event_date ? daysBetween(row.event_date, now) : 0;
    if (stale > settings.news_window_days * RETIRE_WINDOWS) {
      await db.query(
        `UPDATE reel_ai_drama.pitches SET status = 'retired', reject_reason = $2, revive_when = $3, rank_score = 0, updated_at = $4 WHERE id = $1`,
        [row.id, `news older than ${settings.news_window_days * RETIRE_WINDOWS} days with no why-now`, REVIVE_STALE_NEWS, now.toISOString()],
      );
      retired += 1;
      continue;
    }
    if (stale > settings.news_window_days) faded += 1;
    await db.query(`UPDATE reel_ai_drama.pitches SET rank_score = $2 WHERE id = $1`, [row.id, rankScore(row, settings, now)]);
    rechecked += 1;
  }
  return { faded, retired, rechecked };
}
