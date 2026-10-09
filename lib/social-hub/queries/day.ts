import type { HubQuery } from '@/lib/social-hub/db';
import type { DayQuotas, IdeaAdjustment } from '@/lib/social-hub/views/day-rank';

/**
 * The day's ranking inputs (SELECT only): a person's Promote / Demote moves
 * for the day, and each type's posts per day. Missing tables or rows fall back
 * to no moves and each type's default quota, so the hub never fails on them.
 */

/** Each type's default when its posts_per_day row is missing (lib/reels/config.ts, lib/social/overnight/config.ts, lib/explainers/publish/config.ts). */
export const DEFAULT_DAY_QUOTAS: DayQuotas = { reels: 3, carousels: 2, explainers: 2 };

export async function readAdjustments(q: HubQuery, nyDate: string): Promise<IdeaAdjustment[]> {
  const { rows } = await q<{ vertical: IdeaAdjustment['vertical']; idea_id: string; ny_date: string; kind: IdeaAdjustment['kind']; created_at: string }>(
    `SELECT vertical, idea_id, ny_date::text AS ny_date, kind, created_at::text AS created_at
       FROM social_hub.idea_adjustments WHERE ny_date = $1::date ORDER BY created_at`,
    [nyDate],
  );
  return rows.map((r) => ({ vertical: r.vertical, ideaId: r.idea_id, nyDate: r.ny_date.slice(0, 10), kind: r.kind, createdAt: r.created_at }));
}

const perDay = (rows: Array<{ value: unknown }>, fallback: number, min = 0) => {
  const n = Number(rows[0]?.value);
  return rows.length && Number.isInteger(n) && n >= min ? n : fallback;
};

export async function readDayQuotas(q: HubQuery, explainersQ: Promise<HubQuery>): Promise<DayQuotas> {
  const sql = (schema: string) => `SELECT value FROM ${schema}.settings WHERE key = 'posts_per_day'`;
  const safe = (p: Promise<{ rows: Array<{ value: unknown }> }>) => p.catch(() => ({ rows: [] as Array<{ value: unknown }> }));
  const [reels, carousels, explainers] = await Promise.all([
    safe(q<{ value: unknown }>(sql('reels'))),
    safe(q<{ value: unknown }>(sql('social'))),
    safe(explainersQ.then((eq) => eq<{ value: unknown }>(sql('explainers')))),
  ]);
  return {
    reels: perDay(reels.rows, DEFAULT_DAY_QUOTAS.reels),
    carousels: perDay(carousels.rows, DEFAULT_DAY_QUOTAS.carousels),
    explainers: perDay(explainers.rows, DEFAULT_DAY_QUOTAS.explainers, 1),
  };
}
