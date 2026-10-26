import { allocate } from '@/lib/social-hub/cost';
import { cacheSavings, readCacheRows } from '@/lib/social-hub/cost-page/caching';
import { interactionsOf, type CostInput } from '@/lib/social-hub/cost-page/model';
import { parseCostParams } from '@/lib/social-hub/cost-page/params';
import { scopedItems, scopedMonthTotals, scopedSpend, scopedUnattributed } from '@/lib/social-hub/cost-page/scope';
import { toCostRows, type CarouselStageSplit, type CarouselVendorSplit } from '@/lib/social-hub/cost-page/rows';
import { classifyWaste, wasteSets } from '@/lib/social-hub/cost-page/waste';
import { explainersHubQuery, liveHubQuery, type HubQuery } from '@/lib/social-hub/db';
import { readinessFor } from '@/lib/social-hub/health/readiness';
import { loadForPage } from '@/lib/social-hub/live';
import { buildLedger, readCosts } from '@/lib/social-hub/queries/costs';
import { addDays, nyDayStart } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';
import { MONTHLY_WATCH_USD } from '@/lib/reels/config';
import { DEFAULT_RUN_CAP_USD } from '@/lib/social/overnight/config';
import { DEFAULT_LFD_RUN_CAP_USD } from '@/lib/lfd/config';
import { DEFAULT_AI_EVENTS_RUN_CAP_USD } from '@/lib/ai-events/config';

export { parseCostParams } from '@/lib/social-hub/cost-page/params';
export type { CostParams, CostRange } from '@/lib/social-hub/cost-page/params';

type Params = { get(name: string): string | null };

/** Defaults when a setting is missing or unreadable (lib/stories/settings.ts, lib/explainers/settings.ts). */
const STORIES_WATCH_USD = 25;
const EXPLAINERS_DAILY_CAP_USD = 10;

/**
 * One jsonb number from a settings table, read SELECT-only. The pipelines' own
 * settings modules also write (save*), so the hub's read code reads the rows directly.
 */
async function settingNumber(q: HubQuery | null, sql: string): Promise<number | null> {
  if (!q) return null;
  try {
    const value = (await q<{ value: unknown }>(sql)).rows[0]?.value;
    return typeof value === 'number' && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Each type's monthly watch. Types with only a daily cap use cap × days in the month of `to`. */
async function watches(eq: HubQuery | null, to: string): Promise<Record<Vertical, number>> {
  const days = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)).getUTCDate();
  const [stories, explainersCap, runCap, lfdCap, aiEventsCap] = await Promise.all([
    settingNumber(liveHubQuery, `SELECT value FROM stories.settings WHERE key = 'monthly_watch_usd'`),
    settingNumber(eq, `SELECT value FROM explainers.settings WHERE key = 'daily_spend_cap_usd'`),
    settingNumber(liveHubQuery, `SELECT value FROM social.settings WHERE key = 'run_cap_usd'`),
    settingNumber(liveHubQuery, `SELECT value FROM lfd.settings WHERE key = 'run_cap_usd'`),
    settingNumber(liveHubQuery, `SELECT value FROM ai_events.settings WHERE key = 'run_cap_usd'`),
  ]);
  return {
    // Two posts a week: its cap for each one this month can hold.
    last_few_days: (lfdCap ?? DEFAULT_LFD_RUN_CAP_USD) * Math.ceil((days * 2) / 7),
    // One post a week: its cap for each Sunday this month can hold.
    ai_events: (aiEventsCap ?? DEFAULT_AI_EVENTS_RUN_CAP_USD) * Math.ceil(days / 7),
    reels: MONTHLY_WATCH_USD,
    stories: stories ?? STORIES_WATCH_USD,
    explainers: (explainersCap ?? EXPLAINERS_DAILY_CAP_USD) * days,
    carousels: (runCap ?? DEFAULT_RUN_CAP_USD) * days,
  };
}

/** Reads only. Never throws: a failure comes back as `{ error }`. A missing Explainers database never fails the page. */
export async function loadCostPage(email: string, params: Params, now: Date): Promise<CostInput | { error: string }> {
  try {
    const p = parseCostParams(params, now);
    const eq: HubQuery | null = await explainersHubQuery().catch(() => null);
    const reads = await readCosts(liveHubQuery, eq ?? Promise.reject(new Error('Explainers database not available')));
    const { rows, pools } = buildLedger(reads);
    const ledger = allocate(rows, pools);
    const stages = (await liveHubQuery<{ id: string; s: Record<string, number> | null; claude: number; jev: number | null; total: number }>(
      `SELECT id::text, record->'result'->'costByStage' AS s, claude_usd::float8 AS claude, (record->'jev'->>'costUsd')::float8 AS jev, total_usd::float8 AS total
         FROM social.runs WHERE status IN ('ok', 'partial', 'failed')`,
    )).rows;
    const cRows = toCostRows(
      ledger,
      stages.map((r): CarouselStageSplit => ({ runId: r.id, byStage: r.s ?? {} })),
      stages.map((r): CarouselVendorSplit => ({ runId: r.id, claude: r.claude, jev: r.jev ?? 0, total: r.total })),
    );
    const loaded = await loadForPage(email);
    const posts = 'error' in loaded ? [] : loaded.posts;
    const sets = await wasteSets(liveHubQuery, eq);
    const scope = { vertical: p.vertical, mode: p.mode };

    const spendMicros = scopedSpend(cRows, scope, p.from, p.to);
    const published = new Set(posts.filter((x) => x.status === 'published' && x.costItemKey).map((x) => x.costItemKey!));
    const inFlight = new Set(posts.filter((x) => ['ready', 'scheduled', 'publishing', 'generating'].includes(x.status) && x.costItemKey).map((x) => x.costItemKey!));
    const inRange = scopedItems(ledger, scope, p.from, p.to);
    const waste = classifyWaste({ ...inRange, published, inFlight, unattributedMicros: scopedUnattributed(ledger, scope, p.from, p.to), now, spendMicros, ...sets });

    const prevTo = addDays(p.from, -1);
    const prevFrom = `${prevTo.slice(0, 7)}-01`;
    const prevSpend = scopedSpend(cRows, scope, prevFrom, prevTo);
    const prevWaste = classifyWaste({ ...scopedItems(ledger, scope, prevFrom, prevTo), published, inFlight: new Set(), unattributedMicros: 0, now, spendMicros: prevSpend, ...sets });
    const prevWastePct = prevSpend > 0 ? Math.round(((prevWaste.rejected + prevWaste.failed + prevWaste.expired) / prevSpend) * 100) : null;

    const bestEverCpi: Partial<Record<Vertical, number>> = {};
    for (const v of VERTICAL_IDS) {
      const byMonth = new Map<string, { cost: number; n: number }>();
      for (const x of posts.filter((y) => y.vertical === v && y.status === 'published' && y.postedAt && y.costMicros && y.postedAt.slice(0, 7) < p.to.slice(0, 7))) {
        const m = byMonth.get(x.postedAt!.slice(0, 7)) ?? { cost: 0, n: 0 };
        m.cost += x.costMicros!;
        m.n += interactionsOf(x);
        byMonth.set(x.postedAt!.slice(0, 7), m);
      }
      const cpis = [...byMonth.values()].filter((m) => m.n > 0).map((m) => m.cost / m.n);
      if (cpis.length) bestEverCpi[v] = Math.min(...cpis);
    }

    const caching = cacheSavings(await readCacheRows(liveHubQuery, eq, nyDayStart(p.from).toISOString(), nyDayStart(addDays(p.to, 1)).toISOString(), scope));
    return {
      rows: cRows, from: p.from, to: p.to, now, vertical: p.vertical, mode: p.mode, watchUsd: await watches(eq, p.to), posts, waste, prevWastePct,
      readiness: await readinessFor(liveHubQuery, now), caching,
      monthTotals: scopedMonthTotals(cRows, scope), bestEverCpi,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
