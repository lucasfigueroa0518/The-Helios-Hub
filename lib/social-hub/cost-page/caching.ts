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
export async function readCacheRows(q: HubQuery, eq: HubQuery | null, from: string, to: string): Promise<CacheRow[]> {
  const out: CacheRow[] = [];
  const s = await q<{ model: string | null; r: number; w: number }>(
    `SELECT model, sum(cache_read_tokens)::float8 AS r, sum(cache_write_tokens)::float8 AS w FROM stories.cost_events
      WHERE vendor = 'anthropic' AND created_at >= $1 AND created_at < $2 GROUP BY model`, [from, to],
  );
  for (const r of s.rows) out.push({ vertical: 'stories', model: r.model ?? 'claude-sonnet-5-5', readTokens: r.r, writeTokens: r.w });
  if (eq) {
    const e = await eq<{ model: string | null; r: number; w: number }>(
      `SELECT j.orchestrator_model AS model, sum(e.cache_read_tokens)::float8 AS r, sum(e.cache_write_tokens)::float8 AS w
         FROM explainers.cost_events e LEFT JOIN explainers.jobs j ON j.id = e.job_id
        WHERE e.vendor = 'anthropic' AND e.created_at >= $1 AND e.created_at < $2 GROUP BY 1`, [from, to],
    );
    for (const r of e.rows) out.push({ vertical: 'explainers', model: r.model ?? 'claude-sonnet-5-5', readTokens: r.r, writeTokens: r.w });
  }
  return out;
}
