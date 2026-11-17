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

/* ── Phase 2 orders ───────────────────────────────────────────────────── */

const settingTrue = (value: unknown) => value === true || value === 'true';

/** How long a Reels seed waits to be made (lib/reels/seeds.ts SEED_DAYS; not imported: that module pulls in search). */
const REELS_SEED_DAYS = 7;

/** A seed not yet made (no finished video) nor published, as lib/reels/seeds.ts readOpenSeeds counts it. */
const REELS_SEED_WAITING = (idea: string) => `
       AND NOT EXISTS (SELECT 1 FROM reels.video_jobs j WHERE j.post_idea_id = ${idea} AND j.status = 'ok')
       AND NOT EXISTS (SELECT 1 FROM reels.published_status p WHERE p.post_idea_id = ${idea} AND p.published)`;

/**
 * Trial Reels: reels.settings auto_run (on unless set to false, as scripts/reels_worker.ts reads it), a
 * queued/running reels run, or a pending Reels seed (contract: the intake's 'reels' seed or a legacy seed source,
 * under REELS_SEED_DAYS old, not yet made or published).
 */
export async function reelsOpen(q: IntakeQuery): Promise<boolean> {
  const auto = await safe(async () => {
    const { rows } = await q.query<{ value: unknown }>(`SELECT value FROM reels.settings WHERE key = 'auto_run'`);
    return rows[0]?.value !== false && rows[0]?.value !== 'false';
  });
  if (auto) return true;
  const queued = await safe(async () => {
    const { rows } = await q.query(`SELECT 1 FROM reels.runs WHERE status IN ('requested', 'running') LIMIT 1`);
    return rows.length > 0;
  });
  if (queued) return true;
  const intakeSeed = await safe(async () => {
    const { rows } = await q.query(
      `SELECT 1 FROM intake.items i
        WHERE i.seed_order = 'reels' AND i.story_id IS NOT NULL
          AND i.first_seen_at > now() - interval '${REELS_SEED_DAYS} days'${REELS_SEED_WAITING('i.story_id')}
        LIMIT 1`,
    );
    return rows.length > 0;
  });
  if (intakeSeed) return true;
  return safe(async () => {
    const { rows } = await q.query(
      `SELECT 1 FROM reels.sources s JOIN reels.post_idea_members m ON m.source_id = s.id
        WHERE s.adapter_id = 'seed' AND s.drop_reason = 'seed'
          AND s.ingest_time > now() - interval '${REELS_SEED_DAYS} days'${REELS_SEED_WAITING('m.post_idea_id')}
        LIMIT 1`,
    );
    return rows.length > 0;
  });
}

/** Carousels: social.settings auto_run (off unless set to true) or a queued/running carousel run. */
export async function carouselOpen(q: IntakeQuery): Promise<boolean> {
  const auto = await safe(async () => {
    const { rows } = await q.query<{ value: unknown }>(`SELECT value FROM social.settings WHERE key = 'auto_run'`);
    return settingTrue(rows[0]?.value);
  });
  if (auto) return true;
  return safe(async () => {
    const { rows } = await q.query(`SELECT 1 FROM social.runs WHERE status IN ('requested', 'running') LIMIT 1`);
    return rows.length > 0;
  });
}

/** Field Notes: field_notes.settings auto_run on, or a requested/running Field Notes run. */
export async function fieldNotesOpen(q: IntakeQuery): Promise<boolean> {
  const auto = await safe(async () => {
    const { rows } = await q.query<{ value: unknown }>(`SELECT value FROM field_notes.settings WHERE key = 'auto_run'`);
    return settingTrue(rows[0]?.value);
  });
  if (auto) return true;
  return safe(async () => {
    const { rows } = await q.query(`SELECT 1 FROM field_notes.runs WHERE status IN ('requested', 'running') LIMIT 1`);
    return rows.length > 0;
  });
}

/** Trial Reels: the primary adapters plus its own search deposits (family 'search' is covered by 'reels:*'). */
export const REELS_ORDER: IntakeOrder = {
  id: 'reels',
  sources: ['reels:*'],
  lookbackDays: 14,
  scorecards: ['reels-screen', 'reels-score'],
  isOpen: (q) => reelsOpen(q),
};

/** Carousels: the 19 feeds plus the reels primary adapters (today's carousel re-fetches them as hub sources). */
export const CAROUSEL_ORDER: IntakeOrder = {
  id: 'carousel',
  sources: ['feeds:*', 'reels:*'],
  lookbackDays: 2,
  scorecards: ['story-scoring'],
  isOpen: (q) => carouselOpen(q),
};

/** Field Notes: every SOURCE_REGISTRY entry; each item its own story. */
export const FIELD_NOTES_ORDER: IntakeOrder = {
  id: 'field-notes',
  sources: ['field-notes:*'],
  lookbackDays: 45,
  scorecards: ['field-notes-score'],
  isOpen: (q) => fieldNotesOpen(q),
};

export const INTAKE_ORDERS: readonly IntakeOrder[] = [LFD_ORDER, MD_ORDER, GTN_ORDER, FVP_ORDER, REELS_ORDER, CAROUSEL_ORDER, FIELD_NOTES_ORDER];

export const orderById = (id: OrderId): IntakeOrder => INTAKE_ORDERS.find((o) => o.id === id)!;

/** The orders open now, in INTAKE_ORDERS order. */
export async function openOrders(q: IntakeQuery, now: Date, orders: readonly IntakeOrder[] = INTAKE_ORDERS): Promise<IntakeOrder[]> {
  const open = await Promise.all(orders.map((o) => o.isOpen(q, now)));
  return orders.filter((_, i) => open[i]);
}
