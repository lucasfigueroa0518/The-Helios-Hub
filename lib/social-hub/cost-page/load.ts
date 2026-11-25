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
import { DEFAULT_FIELD_NOTES_RUN_CAP_USD } from '@/lib/field-notes/config';
import { SERIES_OF_VERTICAL, type StoryVertical } from '@/lib/social-hub/story-types';
import { readDramaDailySpendCap } from '@/lib/reel-ai-drama/hub-read';

export { parseCostParams } from '@/lib/social-hub/cost-page/params';
export type { CostParams, CostRange } from '@/lib/social-hub/cost-page/params';

type Params = { get(name: string): string | null };

/** Defaults when a setting is missing or unreadable (lib/stories/settings.ts, lib/explainers/settings.ts). */
/**
 * Each Stories-format type's default posting weekdays (0 = Sunday), as in lib/stories/settings.ts DEFAULT_SETTINGS. Copied,
 * not imported: that module also writes stories.settings, and hub read code never reaches a write (social-hub-scope test).
 */
const STORY_DEFAULT_DAYS: Record<StoryVertical, number[]> = { stories: [0, 1, 2, 3, 4, 5, 6], ai_trivia: [0, 1, 4], real_or_ai: [2, 6] };
/** A Stories-format type's daily cap (lib/stories/settings.ts DEFAULT_TYPE, SS-1). */
const STORY_TYPE_DAILY_CAP_USD = 2;
const EXPLAINERS_DAILY_CAP_USD = 10;
const DRAMA_DAILY_CAP_USD = 20;

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
  // A Stories-format type's cap: its own `types` entry, else the engine-wide daily cap (SS-1, SS-22).
  const storyTypeCap = (v: StoryVertical) => settingNumber(liveHubQuery, `SELECT coalesce(
      (SELECT value->'${v}'->'dailyCapUsd' FROM stories.settings WHERE key = 'types'),
      (SELECT value FROM stories.settings WHERE key = 'daily_cap_usd')) AS value`);
  // The days in the month a Stories-format type posts: its series' window days (stories.settings `series`), else the default.
  const storyDays = async (v: StoryVertical): Promise<number> => {
    const series = SERIES_OF_VERTICAL[v];
    let weekdays: number[] = STORY_DEFAULT_DAYS[v];
    try {
      const got = (await liveHubQuery<{ value: unknown }>(`SELECT value->'${series}'->'window'->'days' AS value FROM stories.settings WHERE key = 'series'`)).rows[0]?.value;
      if (Array.isArray(got) && got.every((d) => Number.isInteger(d))) weekdays = got as number[];
    } catch {
      /* the default days */
    }
    const [y, m] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
    let n = 0;
    for (let d = 1; d <= days; d++) if (weekdays.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) n++;
    return n;
  };
  const [mdCap, explainersCap, runCap, lfdCap, aiEventsCap, fieldNotesCap, dramaCap, triviaCap, roaCap, mdDays, triviaDays, roaDays] = await Promise.all([
    storyTypeCap('stories'),
    settingNumber(eq, `SELECT value FROM explainers.settings WHERE key = 'daily_spend_cap_usd'`),
    settingNumber(liveHubQuery, `SELECT value FROM social.settings WHERE key = 'run_cap_usd'`),
    settingNumber(liveHubQuery, `SELECT value FROM lfd.settings WHERE key = 'run_cap_usd'`),
    settingNumber(liveHubQuery, `SELECT value FROM ai_events.settings WHERE key = 'run_cap_usd'`),
    settingNumber(liveHubQuery, `SELECT value FROM field_notes.settings WHERE key = 'run_cap_usd'`),
    eq ? readDramaDailySpendCap(eq).then((v) => (v != null && v > 0 ? v : null)).catch(() => null) : null,
    storyTypeCap('ai_trivia'),
    storyTypeCap('real_or_ai'),
    storyDays('stories'),
    storyDays('ai_trivia'),
    storyDays('real_or_ai'),
  ]);
  return {
    // Two posts a week: its cap for each one this month can hold.
    last_few_days: (lfdCap ?? DEFAULT_LFD_RUN_CAP_USD) * Math.ceil((days * 2) / 7),
    // One post a week: its cap for each Sunday this month can hold.
    ai_events: (aiEventsCap ?? DEFAULT_AI_EVENTS_RUN_CAP_USD) * Math.ceil(days / 7),
    // Two posts a week at most: its cap for each one this month can hold.
    field_notes: (fieldNotesCap ?? DEFAULT_FIELD_NOTES_RUN_CAP_USD) * Math.ceil((days * 2) / 7),
    reels: MONTHLY_WATCH_USD,
    // Each Stories-format type watches its own daily cap × the days it posts this month (SS-22). The engine-wide
    // monthly watch (stories.settings monthly_watch_usd) is a guard over all three together, not any one type's budget.
    stories: (mdCap ?? STORY_TYPE_DAILY_CAP_USD) * mdDays,
    ai_trivia: (triviaCap ?? STORY_TYPE_DAILY_CAP_USD) * triviaDays,
    real_or_ai: (roaCap ?? STORY_TYPE_DAILY_CAP_USD) * roaDays,
    explainers: (explainersCap ?? EXPLAINERS_DAILY_CAP_USD) * days,
    carousels: (runCap ?? DEFAULT_RUN_CAP_USD) * days,
    // Daily production cap (reel_ai_drama.settings daily_spend_cap_usd, launch default $20) × days.
    reel_ai_drama: (dramaCap ?? DRAMA_DAILY_CAP_USD) * days,
  };
}

/** Reads only. Never throws: a failure comes back as `{ error }`. A missing Explainers database never fails the page. */
export async function loadCostPage(email: string, params: Params, now: Date): Promise<CostInput | { error: string }> {
  try {
    const p = parseCostParams(params, now);
    const eq: HubQuery | null = await explainersHubQuery().catch(() => null);
    const scope = { vertical: p.vertical, mode: p.mode };
    // Every read below needs only the params and the Explainers handle, so they run as one wave
    // instead of seven round trips in a row.
    const [reads, { rows: stages }, loaded, sets, cacheRows, watchUsd, readiness] = await Promise.all([
      readCosts(liveHubQuery, eq ?? Promise.reject(new Error('Explainers database not available'))),
      liveHubQuery<{ id: string; s: Record<string, number> | null; claude: number; jev: number | null; total: number }>(
        `SELECT id::text, cost_by_stage AS s, claude_usd::float8 AS claude, jev_usd::float8 AS jev, total_usd::float8 AS total
           FROM social.runs WHERE status IN ('ok', 'partial', 'failed')`,
      ),
      loadForPage(email),
      wasteSets(liveHubQuery, eq),
      readCacheRows(liveHubQuery, eq, nyDayStart(p.from).toISOString(), nyDayStart(addDays(p.to, 1)).toISOString(), scope),
      watches(eq, p.to),
      readinessFor(liveHubQuery, now),
    ]);
    const { rows, pools } = buildLedger(reads);
    const ledger = allocate(rows, pools);
    const cRows = toCostRows(
      ledger,
      stages.map((r): CarouselStageSplit => ({ runId: r.id, byStage: r.s ?? {} })),
      stages.map((r): CarouselVendorSplit => ({ runId: r.id, claude: r.claude, jev: r.jev ?? 0, total: r.total })),
    );
    const posts = 'error' in loaded ? [] : loaded.posts;

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

    const caching = cacheSavings(cacheRows);
    return {
      rows: cRows, from: p.from, to: p.to, now, vertical: p.vertical, mode: p.mode, watchUsd, posts, waste, prevWastePct,
      readiness, caching,
      monthTotals: scopedMonthTotals(cRows, scope), bestEverCpi,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
