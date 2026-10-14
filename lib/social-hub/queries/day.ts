import type { HubQuery } from '@/lib/social-hub/db';
import type { HubPost } from '@/lib/social-hub/types';
import { madeMoveIds, type DayQuotas, type IdeaAdjustment } from '@/lib/social-hub/views/day-rank';
import { readLfdSettings } from '@/lib/lfd/settings';

/**
 * The day's ranking inputs: a person's Promote / Demote moves still in force
 * (consumeMoves is the only write: it marks used moves), and each type's posts per day. Missing tables or rows fall back
 * to no moves and each type's default quota, so the hub never fails on them.
 */

/** Each type's default when its posts_per_day row is missing (lib/reels/config.ts, lib/social/overnight/config.ts, lib/explainers/publish/config.ts). */
export const DEFAULT_DAY_QUOTAS: DayQuotas = { reels: 3, carousels: 2, explainers: 2, last_few_days: 1, lfdDays: [] };

type AdjustmentRow = { id: string; vertical: IdeaAdjustment['vertical']; idea_id: string; ny_date: string; kind: IdeaAdjustment['kind']; created_at: string };

const ADJUSTMENT_COLS = `id::text AS id, vertical, idea_id, ny_date::text AS ny_date, kind,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at`;

const toAdjustment = (r: AdjustmentRow): IdeaAdjustment => ({ id: r.id, vertical: r.vertical, ideaId: r.idea_id, nyDate: r.ny_date.slice(0, 10), kind: r.kind, createdAt: r.created_at });

/**
 * The moves still steering (B8): not used yet, from any day, oldest first.
 * Before the consumed_at column is applied, today's moves, as before Phase B.
 */
export async function readAdjustments(q: HubQuery, nyDate: string): Promise<IdeaAdjustment[]> {
  try {
    const { rows } = await q<AdjustmentRow>(`SELECT ${ADJUSTMENT_COLS} FROM social_hub.idea_adjustments WHERE consumed_at IS NULL ORDER BY created_at`);
    return rows.map(toAdjustment);
  } catch {
    const { rows } = await q<AdjustmentRow>(`SELECT ${ADJUSTMENT_COLS} FROM social_hub.idea_adjustments WHERE ny_date = $1::date ORDER BY created_at`, [nyDate]);
    return rows.map(toAdjustment);
  }
}

/**
 * Use up moves (B8), the one place it happens: a move whose idea got content
 * after it (madeMoveIds, from the posts the hub just loaded, whichever
 * database they live in), or a Stories move whose pool entry the build used
 * (stories.pool.used_at). Marks them consumed and returns the rest. No worker
 * writes consumed_at.
 */
export async function consumeMoves(q: HubQuery, adjustments: readonly IdeaAdjustment[], posts: readonly HubPost[]): Promise<IdeaAdjustment[]> {
  if (!adjustments.length) return [];
  const used = new Set(madeMoveIds(adjustments, posts));
  if (adjustments.some((a) => a.vertical === 'stories')) {
    const { rows } = await q<{ id: string }>(
      `SELECT a.id::text AS id
         FROM social_hub.idea_adjustments a
         JOIN stories.pool p ON a.idea_id = 'stories:pool:' || p.series || ':' || p.key
        WHERE a.vertical = 'stories' AND a.consumed_at IS NULL AND p.used_at IS NOT NULL`,
    );
    for (const r of rows) used.add(r.id);
  }
  if (!used.size) return [...adjustments];
  await q(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE id = ANY($1::uuid[]) AND consumed_at IS NULL`, [[...used]]);
  return adjustments.filter((a) => !used.has(a.id));
}

const perDay = (rows: Array<{ value: unknown }>, fallback: number, min = 0) => {
  const n = Number(rows[0]?.value);
  return rows.length && Number.isInteger(n) && n >= min ? n : fallback;
};

export async function readDayQuotas(q: HubQuery, explainersQ: Promise<HubQuery>): Promise<DayQuotas> {
  const sql = (schema: string) => `SELECT value FROM ${schema}.settings WHERE key = 'posts_per_day'`;
  const safe = (p: Promise<{ rows: Array<{ value: unknown }> }>) => p.catch(() => ({ rows: [] as Array<{ value: unknown }> }));
  const [reels, carousels, explainers, lfd] = await Promise.all([
    safe(q<{ value: unknown }>(sql('reels'))),
    safe(q<{ value: unknown }>(sql('social'))),
    safe(explainersQ.then((eq) => eq<{ value: unknown }>(sql('explainers')))),
    // An unreadable lfd schema reads as Last Few Days off: Carousels keep every day.
    readLfdSettings(q).catch(() => null),
  ]);
  // Last Few Days asks for its post (and Carousels give up its days, LFD-02) only while its auto_run is on.
  const lfdOn = lfd?.autoRun === true;
  return {
    reels: perDay(reels.rows, DEFAULT_DAY_QUOTAS.reels),
    carousels: perDay(carousels.rows, DEFAULT_DAY_QUOTAS.carousels),
    explainers: perDay(explainers.rows, DEFAULT_DAY_QUOTAS.explainers, 1),
    last_few_days: lfdOn ? DEFAULT_DAY_QUOTAS.last_few_days : 0,
    lfdDays: lfdOn ? lfd!.days : [],
  };
}
