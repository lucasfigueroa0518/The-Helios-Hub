import { cacheReadMultiplier, ratesForModel } from '@/lib/anthropic-pricing';
import type { HubQuery } from '@/lib/social-hub/db';
import type { Vertical } from '@/lib/social-hub/types';

export type CacheRow = { vertical: Vertical; model: string; readTokens: number; writeTokens: number };
/** 5-minute cache writes cost 1.25× input (lib/drafting/cost.ts DRAFTING_PRICE_SNAPSHOT). */
const WRITE_PREMIUM = 0.25;

export function cacheSavings(rows: readonly CacheRow[]): { savedMicros: number; withoutMicros: number } {
  let saved = 0;
  let readFull = 0;
  for (const r of rows) {
    const input = ratesForModel(r.model).inputPerMtokUsd;
    const full = (r.readTokens / 1e6) * input;
    saved += full * (1 - cacheReadMultiplier(r.model)) - (r.writeTokens / 1e6) * input * WRITE_PREMIUM;
    readFull += full;
  }
  return { savedMicros: Math.round(saved * 1e6), withoutMicros: Math.round(readFull * 1e6) };
}

/** Only Explainers and Stories record cache tokens today (spec §7). */
export const CACHE_COVERED: readonly Vertical[] = ['explainers', 'stories'];

/** The covered types the Cost page's type filter selects: both for "All types", none for Reels/Carousels. */
export function cacheCovered(vertical: Vertical | null): Vertical[] {
  return CACHE_COVERED.filter((v) => !vertical || v === vertical);
}

export type CacheScope = { vertical: Vertical | null; mode: 'production' | 'development' };

/**
 * Cache tokens for the page's type and mode filters. Explainers carry `mode`
 * on each event; Stories take it from `stories.sets.mode` (a missing set counts
 * as production, as the ledger read does).
 */
export async function readCacheRows(q: HubQuery, eq: HubQuery | null, from: string, to: string, scope: CacheScope): Promise<CacheRow[]> {
  const out: CacheRow[] = [];
  const covered = cacheCovered(scope.vertical);
  if (covered.includes('stories')) {
    const s = await q<{ model: string | null; r: number; w: number }>(
      `SELECT e.model, sum(e.cache_read_tokens)::float8 AS r, sum(e.cache_write_tokens)::float8 AS w
         FROM stories.cost_events e LEFT JOIN stories.sets s ON s.id = e.set_id
        WHERE e.vendor = 'anthropic' AND e.created_at >= $1 AND e.created_at < $2
          AND COALESCE(s.mode, 'production') = $3
        GROUP BY e.model`, [from, to, scope.mode],
    );
    for (const r of s.rows) out.push({ vertical: 'stories', model: r.model ?? 'claude-sonnet-5-5', readTokens: r.r, writeTokens: r.w });
  }
  if (eq && covered.includes('explainers')) {
    const e = await eq<{ model: string | null; r: number; w: number }>(
      `SELECT j.orchestrator_model AS model, sum(e.cache_read_tokens)::float8 AS r, sum(e.cache_write_tokens)::float8 AS w
         FROM explainers.cost_events e LEFT JOIN explainers.jobs j ON j.id = e.job_id
        WHERE e.vendor = 'anthropic' AND e.created_at >= $1 AND e.created_at < $2 AND e.mode = $3 GROUP BY 1`, [from, to, scope.mode],
    );
    for (const r of e.rows) out.push({ vertical: 'explainers', model: r.model ?? 'claude-sonnet-5-5', readTokens: r.r, writeTokens: r.w });
  }
  return out;
}
