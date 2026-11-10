/**
 * The intake orders (Owner B; plan round 4). Code-defined. Each order names
 * the sources and scorecards its type reads today, and opens ONLY from its own
 * type's settings and queue (never because another type is on). A read error
 * on one of those tables counts as "not open" for that branch.
 */
import { readOpenSeeds } from '@/lib/lfd/seeds';
import { parseLfdSettings } from '@/lib/lfd/settings';
import type { Series } from '@/lib/stories/render/types';
import { loadSettings } from '@/lib/stories/settings';

import type { IntakeOrder, IntakeQuery, OrderId, ScorecardId } from './types';

const FULL: readonly ScorecardId[] = ['reels-score', 'story-scoring', 'major-news', 'story-builder'];

const safe = async (read: () => Promise<boolean>): Promise<boolean> => {
  try {
    return await read();
  } catch {
    return false;
  }
};

/** Last Few Days: auto_run on, a requested/running run, or an open seed (lfd.settings `seed:*`). */
export async function lfdOpen(q: IntakeQuery, now: Date): Promise<boolean> {
  const auto = await safe(async () => {
    const { rows } = await q.query<{ key: string; value: unknown }>(`SELECT key, value FROM lfd.settings WHERE key = 'auto_run'`);
    return parseLfdSettings(rows).autoRun;
  });
  if (auto) return true;
  const queued = await safe(async () => {
    const { rows } = await q.query(`SELECT 1 FROM lfd.runs WHERE status IN ('requested', 'running') LIMIT 1`);
    return rows.length > 0;
  });
  if (queued) return true;
  return safe(async () => (await readOpenSeeds((text, params) => q.query(text, params), now)).length > 0);
}

/** A Stories series: enabled with its auto switch on, or a Generate (or auto) set waiting to build. */
export async function seriesOpen(q: IntakeQuery, series: Series): Promise<boolean> {
  const auto = await safe(async () => {
    const s = (await loadSettings(q)).series[series];
    return s.enabled && s.auto;
  });
  if (auto) return true;
  return safe(async () => {
    const { rows } = await q.query(`SELECT 1 FROM stories.sets WHERE series = $1 AND status IN ('requested', 'building') LIMIT 1`, [series]);
    return rows.length > 0;
  });
}

export const LFD_ORDER: IntakeOrder = {
  id: 'lfd',
  sources: ['reels:*', 'feeds:*'],
  lookbackDays: 10,
  scorecards: FULL,
  isOpen: lfdOpen,
};

export const MD_ORDER: IntakeOrder = {
  id: 'md',
  sources: ['reels:*', 'feeds:*'],
  lookbackDays: 4,
  scorecards: FULL,
  isOpen: (q) => seriesOpen(q, 'morning_download'),
};

export const GTN_ORDER: IntakeOrder = {
  id: 'gtn',
  sources: ['reels:*', 'feeds:*'],
  lookbackDays: 7,
  scorecards: ['reels-score', 'story-scoring'],
  isOpen: (q) => seriesOpen(q, 'guess_the_number'),
};

/** Free vs. Paid: the reels adapters only (github-trending is one of them). */
export const FVP_ORDER: IntakeOrder = {
  id: 'fvp',
  sources: ['reels:*'],
  lookbackDays: 14,
  scorecards: ['reels-score'],
  isOpen: (q) => seriesOpen(q, 'free_vs_paid'),
};

export const INTAKE_ORDERS: readonly IntakeOrder[] = [LFD_ORDER, MD_ORDER, GTN_ORDER, FVP_ORDER];

export const orderById = (id: OrderId): IntakeOrder => INTAKE_ORDERS.find((o) => o.id === id)!;

/** The orders open now, in INTAKE_ORDERS order. */
export async function openOrders(q: IntakeQuery, now: Date, orders: readonly IntakeOrder[] = INTAKE_ORDERS): Promise<IntakeOrder[]> {
  const open = await Promise.all(orders.map((o) => o.isOpen(q, now)));
  return orders.filter((_, i) => open[i]);
}
