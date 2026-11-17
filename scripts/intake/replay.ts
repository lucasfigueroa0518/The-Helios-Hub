/**
 * Central intake: dry replay over past nights (pre-ship check, plan "Round 4").
 *
 *   npx tsx scripts/intake/replay.ts                       # plan only: no Jev, no HTTP
 *   npx tsx scripts/intake/replay.ts --go --cap 1.00       # the replay (live Jev, capped)
 *   flags: --nights 2026-11-07,2026-11-08,2026-11-09  --cap 1.00  --out <path>  --no-feeds
 *
 * What it does, per night in order (each simulates that night's main intake):
 *  - items: the kept `reels.sources` rows of every reels run that produced a slate
 *    dated that night (drop_reason IS NULL; run_id = the slate's run). They were
 *    screened already, so they are stored as-is (no re-screen); B6 → family
 *    'search' / 'search:b6', A4 → 'search' / 'search:a4'. firstSeenAt = ingest_time.
 *    The night's intake clock is the latest of the slate's scored_at and the
 *    rows' ingest_time (≈ 1 AM NY: the legacy run had every item by then).
 *  - newest night only, with --go: the 19 feeds fetched live once (plain HTTP),
 *    articles published after that clock removed, then lib/intake/fetch.ts's
 *    fetchFeedItems (its window and code filters) and thin-body enrichment.
 *  - groupIntake + scoreForStories (all four orders treated as open) with the
 *    live intake Jev, capped by --cap. IntakeCapReached → stop, partial report.
 *  - consumers, intake vs legacy (legacy read from the real DB, read only).
 *  - Phase 2 (scripts/intake/replay-phase2.ts): Reels slate vs the intake path per night (on this store), then
 *    Carousel (last runs ≤ Oct 28) and Field Notes (past runs' tips) in fresh in-memory stores, same ≥ 80% rule,
 *    inside the same --cap. Plan mode prints their sections too.
 *
 * Real DB: every read happens up front inside ONE `BEGIN READ ONLY` transaction
 * (rolled back), on its own client; a guard refuses anything but SELECT/WITH.
 * No session-level SET. Nothing is ever written to the real DB: the intake
 * state lives in an in-memory PGlite loaded with db/intake_schema.sql.
 * Rule 2: only the replayed nights' items are grouped and scored; nothing else.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { zonedTime } from '@/lib/instagram/clock';
import { candidatesFor, groupIntake, trigrams, type GroupingResult } from '@/lib/intake/group';
import { createIntakeJev, isIntakeCapReached, type IntakeJevHandle } from '@/lib/intake/jev';
import {
  compareReelsNight,
  loadPhase2Snapshot,
  planPhase2,
  renderPhase2Plan,
  renderPhase2Report,
  runPhase2,
  type Phase2Comparison,
  type Phase2Plan,
  type Phase2Result,
  type Phase2Snapshot,
} from './replay-phase2';
import { enrichThinFeedBodies, fetchBodyFrom, fetchFeedItems, intakeItemKey, upsertItem, type SourceEntry } from '@/lib/intake/fetch';
import { INTAKE_ORDERS } from '@/lib/intake/orders';
import { intakeLanes, type IntakeLanes } from '@/lib/intake/pool-lfd';
import { intakePoolReads } from '@/lib/intake/pool-stories';
import { postedCheck, readCarouselPosted } from '@/lib/intake/posted';
import { listStories, loadStories } from '@/lib/intake/read';
import { scoreForStories, type ScoringTally } from '@/lib/intake/score';
import { INTAKE_SCORECARDS } from '@/lib/intake/scorecards';
import type { Family, IntakeQuery, Scorecard, ScorecardId, ScoredStory } from '@/lib/intake/types';
import { judgedPool, mergeSameEvent, rundownOrder, RUNDOWN_POOL, Selector, withoutUsed } from '@/lib/lfd/pick';
import { carouselLane, freshFeedLane, lastCarouselRunAt, reelsLane } from '@/lib/lfd/sources';
import { previousPosts, usedIdeaIds } from '@/lib/lfd/store';
import type { LfdCandidate, LfdWindow, Pick } from '@/lib/lfd/types';
import { shiftDate } from '@/lib/lfd/window';
import { REFERENCE_POOL_HOURS } from '@/lib/reels/config';
import { buildMatchPool } from '@/lib/reels/grouping/content-candidates';
import { jevUsd, type JevRequest, type JevRunner, type JevTransport } from '@/lib/reels/jev/runner';
import type { JevAsk } from '@/lib/social/jev/client';
import { HELIOS_SOCIAL_FEEDS } from '@/lib/social/feeds';
import type { FetchedArticle } from '@/lib/social/ingest/fetch-feeds';
import type { FetchBody } from '@/lib/social/ingest/select/enrich';
import type { HubQuery } from '@/lib/social-hub/db';
import { chooseLeads, leadFor as mdLeadFor } from '@/lib/stories/build/morning-download';
import { BUILDER_BAR, leadOf } from '@/lib/stories/scores';
import { morningDownloadCarousel, shortlistWithoutBrief } from '@/lib/stories/sources/carousel';
import { dedupe, freeToolLeads, morningDownloadReels, theNumberIdeas, type StoryCandidate, type ToolLead } from '@/lib/stories/sources/reels';

/* ── constants and estimates ──────────────────────────────────────────── */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const LFD_NIGHTS = 3;
export const BARS = [0.5, 0.6, 0.7] as const;
/** Stories consumers read at 7:00 AM NY (after the intake and the old 3:00 AM carousel slot); LFD runs at 3:00 AM NY. */
const STORIES_HOUR_NY = 7;
const LFD_HOUR_NY = 3;
export const TARGET = 0.8;
const PREVIOUS_POSTS = 2; // lib/lfd/run.ts

/**
 * Average input tokens per Jev call, from the real logs: reels.cost_events since 2026-11-01 (grouping, idea merge,
 * scoring passes), stories.jev_logs since 2026-10-25 (major-news, same-event), the last carousel run 2026-10-28
 * (story-scoring: 746k tokens over 464 calls for 221 stories). story-builder sends the major-news state.
 */
export const TOKENS = { grouping: 1320, ideaMerge: 1045, pass1: 7618, pass2: 3607, storyScoring: 1610, major: 2300, builder: 2300, posted: 1610, sameEvent: 980 } as const;
/** Share of reels-score pass 1 calls followed by a pass 2 (714 / 940, same logs). */
export const PASS2_SHARE = 0.76;
export const STORY_SCORING_CALLS = 2.1;
/** Idea-merge checks per night (cap 120; reels averaged ~9 a night). */
export const IDEA_MERGE_PER_NIGHT = 10;
/** Without --go the feeds are not fetched: assume this many kept articles (the last carousel run scored 221 stories in 24 h; the intake reads 48 h). */
export const FEED_ESTIMATE = 350;
export const FEED_GROUPING_PER_ARTICLE = 2;
/** Posted checks per consumer per night when the carousel posted list is not empty (asked only until a top 10 settles). */
export const POSTED_PER_CONSUMER = 12;
export const LINEUP_SAME_EVENT_EST = 200;

/* ── snapshot (everything read from the real DB, up front) ────────────── */

export type ReplayItem = {
  key: string;
  family: 'reels' | 'search';
  sourceId: string;
  sourceName: string;
  sourceType: string;
  headline: string;
  body: string;
  url: string;
  author: string | null;
  byline: string | null;
  publishTime: Date | null;
  firstSeenAt: Date;
  engagement: Record<string, number> | null;
};

/** A legacy candidate: its canonical URL key (intakeItemKey) and headline. */
export type LegacyCand = { key: string; headline: string };

export type LegacyLists = {
  mdReels: LegacyCand[];
  mdCarousel: LegacyCand[];
  gtn: LegacyCand[];
  fvp: LegacyCand[];
  lfdReels: LegacyCand[];
  lfdCarousel: LegacyCand[];
};

export type NightData = {
  nyDate: string;
  /** The night's intake clock. */
  runAt: Date;
  items: ReplayItem[];
  legacy: LegacyLists;
  /** social.posted_stories headlines (14 days) as of the Stories read time. */
  postedHeadlines: string[];
  /** Legacy LFD fresh-feed "since": the last carousel run finished by the LFD time, else the window start. */
  feedSince: Date;
};

export type Snapshot = {
  nights: NightData[];
  /** The last Last Few Days posts before the newest night (lfd.posts, read only). */
  previous: Array<{ nyDate: string; ideaIds: string[]; stories: Array<{ headline: string; body: string }> }>;
};

export const safeKey = (url: string) => {
  try {
    return intakeItemKey(url);
  } catch {
    return url.trim().toLowerCase();
  }
};

function nyAt(nyDate: string, hour: number): Date {
  const [y, m, d] = nyDate.split('-').map(Number);
  return zonedTime(y!, m!, d!, hour);
}
export const storiesTime = (nyDate: string) => nyAt(nyDate, STORIES_HOUR_NY);
export const lfdTime = (nyDate: string) => nyAt(nyDate, LFD_HOUR_NY);
export const lfdWindow = (nyDate: string): LfdWindow => ({ after: shiftDate(nyDate, -LFD_NIGHTS), through: nyDate });

const fromStory = (c: StoryCandidate): LegacyCand => ({ key: safeKey(c.url), headline: c.headline });
const fromLead = (c: ToolLead): LegacyCand => ({ key: safeKey(c.url), headline: c.name });
const fromLfd = (c: LfdCandidate): LegacyCand => ({ key: safeKey(c.url), headline: c.headline });

/** Refuses anything but a read: the real DB is never written. */
export function readOnlyQuery(run: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): IntakeQuery {
  return {
    async query<T>(text: string, params?: unknown[]) {
      if (!/^\s*(SELECT|WITH)\b/i.test(text)) throw new Error(`replay: the real DB is read only; refused "${text.trim().slice(0, 60)}"`);
      return { rows: (await run(text, params)).rows as T[] };
    },
  };
}

type SourceRow = {
  canonical_url: string;
  headline: string;
  body: string | null;
  author: string | null;
  byline: string | null;
  source_name: string;
  source_type: string;
  adapter_id: string;
  publish_time: Date | string | null;
  ingest_time: Date | string;
  engagement: Record<string, number> | null;
};

function toReplayItem(r: SourceRow): ReplayItem {
  const search = r.source_type === 'B6' ? { sourceId: 'search:b6', sourceName: 'Claude web search' } : r.source_type === 'A4' ? { sourceId: 'search:a4', sourceName: 'Awesome lists' } : null;
  return {
    key: safeKey(r.canonical_url),
    family: search ? 'search' : 'reels',
    sourceId: search?.sourceId ?? r.adapter_id,
    sourceName: search?.sourceName ?? r.source_name,
    sourceType: r.source_type,
    headline: r.headline,
    body: r.body ?? '',
    url: r.canonical_url,
    author: r.author,
    byline: r.byline,
    publishTime: r.publish_time ? new Date(r.publish_time) : null,
    firstSeenAt: new Date(r.ingest_time),
    engagement: r.engagement,
  };
}

/** The 3 most recent slate dates. */
export async function defaultNights(db: IntakeQuery, n = 3): Promise<string[]> {
  const { rows } = await db.query<{ ny_date: string }>(`SELECT DISTINCT ny_date::text AS ny_date FROM reels.score_slates ORDER BY ny_date DESC LIMIT $1`, [n]);
  return rows.map((r) => r.ny_date).sort();
}

/** Every real-DB read the replay needs (call inside one BEGIN READ ONLY transaction). */
export async function loadSnapshot(db: IntakeQuery, nights: string[]): Promise<Snapshot> {
  const hub: HubQuery = (text, params) => db.query(text, params);
  const out: NightData[] = [];
  for (const nyDate of [...nights].sort()) {
    const { rows: slates } = await db.query<{ run_id: string; scored_at: Date | string }>(
      `SELECT run_id::text AS run_id, scored_at FROM reels.score_slates WHERE ny_date = $1::date AND run_id IS NOT NULL`,
      [nyDate],
    );
    if (slates.length === 0) throw new Error(`no reels slate dated ${nyDate}`);
    const { rows } = await db.query<SourceRow>(
      `SELECT canonical_url, headline, body, author, byline, source_name, source_type, adapter_id, publish_time, ingest_time, engagement
         FROM reels.sources
        WHERE run_id = ANY($1::uuid[]) AND drop_reason IS NULL
        ORDER BY ingest_time, canonical_url`,
      [slates.map((s) => s.run_id)],
    );
    const items = rows.map(toReplayItem);
    const runAt = new Date(Math.max(...slates.map((s) => new Date(s.scored_at).getTime()), ...items.map((i) => i.firstSeenAt.getTime())));
    const evalNow = storiesTime(nyDate);
    const lfdNow = lfdTime(nyDate);
    const w = lfdWindow(nyDate);
    const windowStart = `${w.after}T04:00:00Z`; // lib/lfd/run.ts windowStartIso
    // One client, one transaction: the reads run one after another.
    const mdReels = await morningDownloadReels(db, nyDate);
    const mdCarousel = await morningDownloadCarousel(db, evalNow);
    const shortlist = await shortlistWithoutBrief(db, evalNow);
    const theNumber = await theNumberIdeas(db, nyDate);
    const fvp = await legacyFvpLeads(db, nyDate, evalNow);
    const lfdReels = await reelsLane(hub, w);
    const lfdCarousel = await carouselLane(hub, windowStart, lfdNow.toISOString());
    const lastCarousel = await lastCarouselRunAt(hub, lfdNow.toISOString());
    const posted = await readCarouselPosted(db, evalNow);
    out.push({
      nyDate,
      runAt,
      items,
      legacy: {
        mdReels: mdReels.map(fromStory),
        mdCarousel: mdCarousel.map(fromStory),
        gtn: dedupe([...shortlist, ...theNumber]).map(fromStory),
        fvp: fvp.map(fromLead),
        lfdReels: lfdReels.map(fromLfd),
        lfdCarousel: lfdCarousel.map(fromLfd),
      },
      postedHeadlines: posted,
      feedSince: new Date(lastCarousel ?? windowStart),
    });
  }
  const newest = out[out.length - 1]!.nyDate;
  const previous = await previousPosts(hub, PREVIOUS_POSTS, newest);
  return { nights: out, previous };
}

/**
 * freeToolLeads (lib/stories/sources/reels.ts) as it read on that night: its Ball Knowledge half is the legacy
 * function (slate-bounded); its GitHub Trending half is the same query with an upper bound, since the legacy one
 * has none and would show later nights' repos on a past night.
 */
async function legacyFvpLeads(db: IntakeQuery, nyDate: string, now: Date): Promise<ToolLead[]> {
  const ideas = (await freeToolLeads(db, nyDate)).filter((l) => l.origin === 'reels');
  const { rows } = await db.query<{ id: string; headline: string; canonical_url: string; body: string }>(
    `SELECT id, headline, canonical_url, left(body, 600) AS body FROM reels.sources
      WHERE adapter_id = 'github-trending' AND ingest_time > $1::date - 14 AND ingest_time <= $2::timestamptz ORDER BY ingest_time DESC LIMIT 15`,
    [nyDate, now.toISOString()],
  );
  return [...ideas, ...rows.map((r) => ({ origin: 'github' as const, ref: r.id, name: r.headline, url: r.canonical_url, description: r.body }))];
}

/* ── plan (no Jev, no HTTP) ───────────────────────────────────────────── */

export type NightPlan = {
  nyDate: string;
  runAt: Date;
  reels: number;
  b6: number;
  a4: number;
  feeds: number;
  feedsEstimated: boolean;
  repeats: number;
  groupingChecks: number;
  calls: Record<string, number>;
  usd: number;
};

export type Plan = { nights: NightPlan[]; calls: Record<string, number>; usd: number; lineupCalls: number; lineupUsd: number };

const STEP_TOKENS: Record<string, number> = {
  'grouping checks': TOKENS.grouping,
  'idea merges': TOKENS.ideaMerge,
  'reels-score pass 1': TOKENS.pass1,
  'reels-score pass 2': TOKENS.pass2,
  'story-scoring': TOKENS.storyScoring,
  'major-news': TOKENS.major,
  'story-builder': TOKENS.builder,
  'posted check': TOKENS.posted,
};

/** Estimated calls and USD per night. Grouping checks are an upper bound (pairs inside one story are skipped live). */
export function planReplay(snapshot: Snapshot, feedCount: number | null = null): Plan {
  const nights: NightPlan[] = [];
  const stored: Array<{ key: string; headline: string; body: string; at: number }> = [];
  const known = new Set<string>();
  snapshot.nights.forEach((night, i) => {
    const newest = i === snapshot.nights.length - 1;
    const fresh = night.items.filter((it) => !known.has(it.key) && (known.add(it.key), true));
    const repeats = night.items.length - fresh.length;
    for (const it of fresh) stored.push({ key: it.key, headline: it.headline, body: it.body.slice(0, 4000), at: it.firstSeenAt.getTime() });
    const cutoff = night.runAt.getTime() - REFERENCE_POOL_HOURS * HOUR;
    const poolRows = stored.filter((r) => r.at > cutoff);
    const pool = buildMatchPool(poolRows.map((r) => ({ id: r.key, headline: r.headline, body: r.body })));
    const rows = poolRows.map((r) => ({ key: r.key, trg: trigrams(r.headline) }));
    const pairs = new Set<string>();
    for (const it of fresh) {
      for (const other of candidatesFor({ key: it.key, headline: it.headline, body: it.body.slice(0, 4000) }, rows, pool)) {
        pairs.add(it.key < other ? `${it.key}|${other}` : `${other}|${it.key}`);
      }
    }
    const feeds = newest ? (feedCount ?? FEED_ESTIMATE) : 0;
    const reelsStories = fresh.length;
    const allStories = reelsStories + feeds;
    const postedConsumers = night.postedHeadlines.length > 0 ? 2 : 0;
    const calls: Record<string, number> = {
      'grouping checks': pairs.size + feeds * FEED_GROUPING_PER_ARTICLE,
      'idea merges': IDEA_MERGE_PER_NIGHT,
      'reels-score pass 1': reelsStories,
      'reels-score pass 2': Math.round(reelsStories * PASS2_SHARE),
      'story-scoring': Math.round(feeds * STORY_SCORING_CALLS),
      'major-news': allStories,
      'story-builder': allStories,
      'posted check': feeds > 0 ? postedConsumers * POSTED_PER_CONSUMER : 0,
    };
    const usd = Object.entries(calls).reduce((s, [k, n]) => s + jevUsd(n * STEP_TOKENS[k]!), 0);
    nights.push({
      nyDate: night.nyDate,
      runAt: night.runAt,
      reels: fresh.filter((x) => x.family === 'reels').length,
      b6: fresh.filter((x) => x.sourceId === 'search:b6').length,
      a4: fresh.filter((x) => x.sourceId === 'search:a4').length,
      feeds,
      feedsEstimated: newest && feedCount === null,
      repeats,
      groupingChecks: calls['grouping checks']!,
      calls,
      usd,
    });
  });
  const calls: Record<string, number> = {};
  for (const n of nights) for (const [k, v] of Object.entries(n.calls)) calls[k] = (calls[k] ?? 0) + v;
  const lineupUsd = jevUsd(LINEUP_SAME_EVENT_EST * TOKENS.sameEvent);
  return { nights, calls, usd: nights.reduce((s, n) => s + n.usd, 0) + lineupUsd, lineupCalls: LINEUP_SAME_EVENT_EST, lineupUsd };
}

const money = (usd: number, digits = 4) => `$${usd.toFixed(digits)}`;
const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z');

export function renderPlan(plan: Plan, capUsd: number, phase2?: Phase2Plan): string {
  const lines = ['Intake replay plan (no Jev, no HTTP; the real DB was read in one read-only transaction)', ''];
  for (const n of plan.nights) {
    lines.push(
      `${n.nyDate} (intake clock ${iso(n.runAt)}): reels ${n.reels}, search B6 ${n.b6} / A4 ${n.a4}, feeds ${n.feeds}${n.feedsEstimated ? ' (assumed; fetched live with --go)' : ''}` +
        `${n.repeats ? `, ${n.repeats} repeat URL(s) skipped` : ''}`,
    );
    lines.push(`    Jev calls ≈ ${Object.entries(n.calls).map(([k, v]) => `${k} ${v}`).join(', ')}  →  ≈ ${money(n.usd)}`);
  }
  const total = Object.values(plan.calls).reduce((s, v) => s + v, 0) + plan.lineupCalls;
  lines.push('', `Builder calibration (LFD lineups at ${BARS.join(' / ')}): ≤ ${plan.lineupCalls} same-event checks ≈ ${money(plan.lineupUsd)}`);
  lines.push(`Total ≈ ${total} Jev calls ≈ ${money(plan.usd)} (rate ${money(jevUsd(1_000_000), 3)} per million input tokens). Cap: ${money(capUsd, 2)}.`);
  lines.push('Grouping checks are an upper bound; story counts assume one story per item (joins make it fewer).');
  if (phase2) lines.push(renderPhase2Plan(phase2));
  return lines.join('\n');
}

/* ── metered Jev (per step) ───────────────────────────────────────────── */

type Phase = 'intake' | 'reads' | 'lineups';
type Ledger = Map<string, { calls: number; tokens: number }>;

function meteredJev(inner: IntakeJevHandle, ledger: Ledger, phase: { now: Phase }): IntakeJevHandle {
  const add = (component: string, tokens: number) => {
    const k = `${phase.now}|${component}`;
    const e = ledger.get(k) ?? { calls: 0, tokens: 0 };
    e.calls += 1;
    e.tokens += tokens;
    ledger.set(k, e);
  };
  const runner: JevRunner = {
    async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
      const res = await inner.asReelsRunner().ask(request);
      add(request.component, res.usage.input_tokens);
      return res;
    },
    get callCount() {
      return inner.calls;
    },
  };
  const ask: JevAsk = async (request, meta) => {
    const res = await inner.asSocialAsk()(request, meta);
    add(meta.version, res.usage.input_tokens);
    return res;
  };
  return {
    asReelsRunner: () => runner,
    asSocialAsk: () => ask,
    get usd() {
      return inner.usd;
    },
    get calls() {
      return inner.calls;
    },
    runId: inner.runId,
    capUsd: inner.capUsd,
    get capHit() {
      return inner.capHit;
    },
  };
}

function stepLabel(key: string): string {
  const [phase, component] = key.split('|') as [Phase, string];
  if (phase === 'reads') return 'Posted check (at read time)';
  if (phase === 'lineups') return 'LFD lineup: same-event checks';
  if (component === 'grouping') return 'Grouping: same-event pair checks';
  if (component === 'idea-merge') return 'Grouping: story merge checks';
  if (component.startsWith('scoring-pass')) return `reels-score (pass ${component.slice(-1)})`;
  return component.replace(/@[^@]*$/, '');
}

/* ── overlap math ─────────────────────────────────────────────────────── */

/** An intake candidate: its story and that story's member keys. */
export type IntakeCand = { storyId: string | null; keys: string[]; headline: string };
export type Kind = 'feeds' | 'builder' | 'other';

export type Comparison = {
  legacy: number;
  /** Legacy candidates whose article never entered the replay by that night (older than the first night, or not yet seen). */
  outside: number;
  inScope: number;
  matched: number;
  pct: number | null;
  legacyOnly: string[];
  intakeOnly: Record<Kind, string[]>;
};

/** A legacy candidate matches when its canonical URL is a member of an intake candidate's story. */
export function compareLists(legacy: readonly LegacyCand[], intake: readonly IntakeCand[], inReplay: (key: string) => boolean, kindOf: (c: IntakeCand) => Kind): Comparison {
  const intakeKeys = new Set(intake.flatMap((c) => c.keys));
  const legacyKeys = new Set(legacy.map((l) => l.key));
  const scoped = legacy.filter((l) => inReplay(l.key));
  const matched = scoped.filter((l) => intakeKeys.has(l.key));
  const intakeOnly: Record<Kind, string[]> = { feeds: [], builder: [], other: [] };
  for (const c of intake) if (!c.keys.some((k) => legacyKeys.has(k))) intakeOnly[kindOf(c)].push(c.headline);
  return {
    legacy: legacy.length,
    outside: legacy.length - scoped.length,
    inScope: scoped.length,
    matched: matched.length,
    pct: scoped.length ? matched.length / scoped.length : null,
    legacyOnly: scoped.filter((l) => !intakeKeys.has(l.key)).map((l) => l.headline),
    intakeOnly,
  };
}

/* ── the replay ───────────────────────────────────────────────────────── */

export const CONSUMERS = [
  ['mdReels', 'Morning Download, reels side'],
  ['mdCarousel', 'Morning Download, carousel side'],
  ['gtn', 'Guess the Number (shortlist + The Number)'],
  ['fvp', 'Free vs. Paid leads'],
  ['lfdReels', 'Last Few Days, reels lane'],
  ['lfdCarousel', 'Last Few Days, carousel lane'],
  ['lfdFeed', 'Last Few Days, fresh feed lane'],
] as const;
export type ConsumerId = (typeof CONSUMERS)[number][0];

export type NightResult = {
  nyDate: string;
  items: { reels: number; search: number; feeds: number; feedsFetched?: number; feedsAfterClock?: number; repeats: number };
  grouping: Omit<GroupingResult, 'touched'> & { touched: number };
  tally: ScoringTally;
  comparisons: Partial<Record<ConsumerId, Comparison | null>>;
  /** Morning Download: builders chooseLeads takes, per bar. */
  mdBuilders: Record<string, { leads: number; builders: number; pool: number }>;
};

export type LineupPick = { lane: string; headline: string; builder: number | null; major: number | null; origin: string };
export type Lineup = { bar: number; picks: LineupPick[]; builders: number };

export type ReplayResult = {
  nights: NightResult[];
  stopped: { at: string; reason: string } | null;
  topBuilders: Array<{ headline: string; builder: number; major: number | null; eventDate: string | null; source: string }>;
  builderStories: number;
  lineups: Lineup[];
  lineupWindow: LfdWindow | null;
  previousNote: string;
  steps: Array<{ step: string; calls: number; usd: number }>;
  cacheHits: { scores: number; grouping: number };
  totalCalls: number;
  totalUsd: number;
  capUsd: number;
  runtimeMs: number;
  /** Phase 2: Reels slate vs the intake path, per night. */
  phase2Reels?: Phase2Comparison[];
};

export type ReplayDeps = {
  /** PGlite (or any empty intake schema), never the real DB. */
  intake: IntakeQuery;
  transport: JevTransport;
  fetchFeeds: () => Promise<FetchedArticle[]>;
  fetchBody?: FetchBody;
  scorecards?: readonly Scorecard[];
  capUsd: number;
  log?: (line: string) => void;
  /** Phase 2: the Reels slate nights to compare on this store (replay-phase2.ts). */
  phase2?: Phase2Snapshot;
};

const emptyTally = (): ScoringTally =>
  Object.fromEntries((['reels-screen', 'reels-score', 'story-scoring', 'major-news', 'story-builder'] as ScorecardId[]).map((id) => [id, { scored: 0, cached: 0, usd: 0 }])) as ScoringTally;

/** Builder score as seen with a different bar: leadOf compares builder − BUILDER_BAR, so shifting the score moves the bar. */
const atBar = (builder: number | null, bar: number) => (builder === null ? null : builder - bar + BUILDER_BAR);

class Stop extends Error {}

/** Plan only (no transport, no fetch) unless `go`. */
export async function replay(snapshot: Snapshot, deps: ReplayDeps, opts: { go: boolean }): Promise<{ plan: Plan; result: ReplayResult | null }> {
  const plan = planReplay(snapshot);
  if (!opts.go) return { plan, result: null };
  return { plan, result: await runReplay(snapshot, deps) };
}

export async function runReplay(snapshot: Snapshot, deps: ReplayDeps): Promise<ReplayResult> {
  const started = Date.now();
  const q = deps.intake;
  const log = deps.log ?? (() => {});
  const ledger: Ledger = new Map();
  const phase = { now: 'intake' as Phase };
  const jev = meteredJev(createIntakeJev(deps.transport, q, null, deps.capUsd), ledger, phase);
  const scorecards = deps.scorecards ?? INTAKE_SCORECARDS;
  const result: ReplayResult = {
    nights: [],
    stopped: null,
    topBuilders: [],
    builderStories: 0,
    lineups: [],
    lineupWindow: null,
    previousNote: '',
    steps: [],
    cacheHits: { scores: 0, grouping: 0 },
    totalCalls: 0,
    totalUsd: 0,
    capUsd: deps.capUsd,
    runtimeMs: 0,
  };
  const inStore = new Set<string>();
  let lastLanes: { lanes: IntakeLanes; w: LfdWindow; now: Date } | null = null;
  const stop = (at: string, err: unknown): never => {
    result.stopped = { at, reason: err instanceof Error ? err.message : String(err) };
    throw new Stop();
  };

  try {
    for (const [i, night] of snapshot.nights.entries()) {
      const newest = i === snapshot.nights.length - 1;
      log(`[replay] ${night.nyDate}: storing ${night.items.length} items`);
      phase.now = 'intake';
      // The run row starts when a live intake run would have first seen the night's new items (they keep their legacy
      // ingest times, new or seen again): Morning Download's "timely" is a reels member seen since the main run's start.
      const startedAt = new Date(Math.min(night.runAt.getTime(), ...night.items.map((it) => it.firstSeenAt.getTime())));
      const { rows: run } = await q.query<{ id: string }>(`INSERT INTO intake.runs (kind, status, started_at) VALUES ('main', 'running', $1) RETURNING id::text AS id`, [startedAt]);
      const runId = run[0]!.id;

      // 1. Store the night's kept reels rows (already screened: no re-screen). A URL already stored is only touched.
      let repeats = 0;
      for (const item of night.items) {
        if (inStore.has(item.key)) {
          repeats += 1;
          await q.query(`UPDATE intake.items SET last_seen_at = greatest(last_seen_at, $2) WHERE key = $1`, [item.key, item.firstSeenAt]);
          continue;
        }
        inStore.add(item.key);
        await upsertItem(q, { ...item, dropReason: null, runId }, item.firstSeenAt);
      }

      // 2. Newest night: the feeds, fetched live once, through the intake's own window and code filters.
      const counts: NightResult['items'] = { reels: 0, search: 0, feeds: 0, repeats };
      let feedArticles: FetchedArticle[] | null = null;
      if (newest) {
        const fetched = await deps.fetchFeeds();
        feedArticles = fetched.filter((a) => a.publishedAt.getTime() <= night.runAt.getTime());
        counts.feedsFetched = fetched.length;
        counts.feedsAfterClock = fetched.length - feedArticles.length;
        const entries = new Map<string, SourceEntry>(HELIOS_SOCIAL_FEEDS.map((f) => [`feed:${f.slug}`, { id: `feed:${f.slug}`, fetched: 0, kept: 0, dropped: {} }]));
        const articles = feedArticles;
        await fetchFeedItems(q, HELIOS_SOCIAL_FEEDS, async () => articles, { runId, runStartedAt: night.runAt, now: night.runAt, jev, log }, entries);
        const { rows } = await q.query<{ key: string }>(`SELECT key FROM intake.items WHERE run_id = $1 AND family = 'feeds' AND drop_reason IS NULL`, [runId]);
        for (const r of rows) inStore.add(r.key);
      }
      const { rows: fam } = await q.query<{ family: string; n: number | string }>(
        `SELECT family, count(*) AS n FROM intake.items WHERE run_id = $1 AND drop_reason IS NULL GROUP BY family`,
        [runId],
      );
      for (const r of fam) {
        if (r.family === 'reels') counts.reels = Number(r.n);
        else if (r.family === 'search') counts.search = Number(r.n);
        else if (r.family === 'feeds') counts.feeds = Number(r.n);
      }

      // 3. Group, enrich thin feed bodies, score the touched stories (Rule 2: nothing else).
      const grouping: GroupingResult = { created: 0, joined: 0, merges: 0, pairCalls: 0, cacheHits: 0, touched: new Set(), failures: [] };
      try {
        await groupIntake(q, jev.asReelsRunner(), runId, night.runAt, grouping);
      } catch (err) {
        if (isIntakeCapReached(err)) stop(`${night.nyDate}, grouping`, err);
        throw err;
      }
      for (const f of grouping.failures) log(`[replay] grouping: ${f}`);
      const touched = [...grouping.touched];
      if (newest) await enrichThinFeedBodies(q, touched, deps.fetchBody ?? fetchBodyFrom());
      const stories = await loadStories(q, touched);
      let capped = false;
      const tally = await scoreForStories(q, jev, stories, INTAKE_ORDERS, scorecards, { log, onCapReached: () => (capped = true) });
      result.cacheHits.scores += Object.values(tally).reduce((s, t) => s + t.cached, 0);
      result.cacheHits.grouping += grouping.cacheHits;
      await q.query(`UPDATE intake.runs SET status = $2, finished_at = $3 WHERE id = $1`, [runId, capped ? 'partial' : 'ok', night.runAt]);
      const nightResult: NightResult = {
        nyDate: night.nyDate,
        items: counts,
        grouping: { ...grouping, touched: grouping.touched.size },
        tally,
        comparisons: {},
        mdBuilders: {},
      };
      result.nights.push(nightResult);
      if (capped || jev.capHit) stop(`${night.nyDate}, scoring`, new Error(`Intake Jev cap $${deps.capUsd} reached`));

      // 4. Consumers: intake vs legacy.
      phase.now = 'reads';
      try {
        lastLanes = await compareNight(q, jev, night, newest ? feedArticles : null, inStore, nightResult);
        const reelsNight = deps.phase2?.reels.find((r) => r.nyDate === night.nyDate);
        if (reelsNight) (result.phase2Reels ??= []).push(await compareReelsNight(q, reelsNight, (key) => inStore.has(key)));
      } catch (err) {
        if (isIntakeCapReached(err)) stop(`${night.nyDate}, consumer reads (posted check)`, err);
        throw err;
      }
    }

    // 5. Builder calibration.
    phase.now = 'lineups';
    const first = snapshot.nights[0]!.nyDate;
    const all = await listStories(q, { since: new Date(nyAt(first, 0).getTime() - DAY), needScores: ['story-builder'] });
    result.builderStories = all.length;
    result.topBuilders = all
      .sort((a, b) => (b.scores['story-builder'] ?? 0) - (a.scores['story-builder'] ?? 0))
      .slice(0, 30)
      .map((s) => {
        const rep = s.members.find((m) => m.key === s.representativeKey) ?? s.members[0];
        return {
          headline: s.headline,
          builder: s.scores['story-builder'] ?? 0,
          major: s.scores['major-news'] ?? null,
          eventDate: s.eventDate ? s.eventDate.toISOString().slice(0, 10) : null,
          source: rep ? `${rep.sourceName} (${rep.family})` : '',
        };
      });
    if (lastLanes) {
      try {
        const out = await lineups(lastLanes, snapshot.previous, jev.asSocialAsk());
        result.lineups = out.lineups;
        result.previousNote = out.note;
        result.lineupWindow = lastLanes.w;
      } catch (err) {
        if (isIntakeCapReached(err)) stop('builder calibration (LFD lineups)', err);
        throw err;
      }
    }
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    log(`[replay] stopped: ${result.stopped?.at}: ${result.stopped?.reason}`);
  }

  result.steps = [...ledger.entries()]
    .map(([k, v]) => ({ step: stepLabel(k), calls: v.calls, usd: jevUsd(v.tokens) }))
    .reduce<ReplayResult['steps']>((acc, s) => {
      const hit = acc.find((x) => x.step === s.step);
      if (hit) {
        hit.calls += s.calls;
        hit.usd += s.usd;
      } else acc.push({ ...s });
      return acc;
    }, []);
  result.totalCalls = jev.calls;
  result.totalUsd = jev.usd;
  result.runtimeMs = Date.now() - started;
  return result;
}

type Index = { stories: Map<string, ScoredStory>; storyOfKey: Map<string, string> };

async function indexStore(q: IntakeQuery): Promise<Index> {
  const all = await listStories(q, { since: new Date(0) }); // the replay's own in-memory store, for the report
  const stories = new Map(all.map((s) => [s.id, s]));
  const storyOfKey = new Map<string, string>();
  for (const s of all) for (const m of s.members) storyOfKey.set(m.key, s.id);
  return { stories, storyOfKey };
}

const BUILDER_ONLY = (s: ScoredStory | undefined, now: Date) =>
  s ? leadOf({ major: s.scores['major-news'] ?? null, builder: s.scores['story-builder'] ?? null, eventDate: s.eventDate }, now)?.lane === 'builder' : false;

function kindOf(index: Index, now: Date) {
  return (c: IntakeCand): Kind => {
    const s = c.storyId ? index.stories.get(c.storyId) : undefined;
    const families = new Set<Family>((s?.members ?? []).map((m) => m.family));
    if (s && families.has('feeds') && !families.has('reels') && !families.has('search')) return 'feeds';
    if (BUILDER_ONLY(s, now)) return 'builder';
    return 'other';
  };
}

function cand(index: Index, storyId: string | null, fallbackKey: string, headline: string): IntakeCand {
  const s = storyId ? index.stories.get(storyId) : undefined;
  return { storyId, keys: s ? s.members.map((m) => m.key) : [fallbackKey], headline };
}

function uniq(list: IntakeCand[]): IntakeCand[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = c.storyId ?? c.keys[0]!;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

const fromIntakeStory = (index: Index) => (c: StoryCandidate) => cand(index, c.intake?.storyId ?? c.ref, safeKey(c.url), c.headline);
const fromIntakeLfd = (index: Index) => (c: LfdCandidate) => cand(index, c.refs[0] ?? null, safeKey(c.url), c.headline);
const fromIntakeLead = (index: Index) => (l: ToolLead) =>
  l.origin === 'github' ? { storyId: index.storyOfKey.get(l.ref) ?? null, keys: [l.ref], headline: l.name } : cand(index, l.ref, safeKey(l.url), l.name);

async function compareNight(
  q: IntakeQuery,
  jev: IntakeJevHandle,
  night: NightData,
  feedArticles: FetchedArticle[] | null,
  inStore: ReadonlySet<string>,
  out: NightResult,
): Promise<{ lanes: IntakeLanes; w: LfdWindow; now: Date }> {
  const evalNow = storiesTime(night.nyDate);
  const lfdNow = lfdTime(night.nyDate);
  const w = lfdWindow(night.nyDate);
  const posted = async () => night.postedHeadlines;
  const reads = intakePoolReads(q, evalNow, { jev, readCarouselPosted: posted });
  const morning = await reads.morning();
  const numbers = await reads.numbers();
  const leads = await reads.leads();
  const lanes = await intakeLanes(q, w, lfdNow, jev, { listStories, postedCheck, readCarouselPosted: posted });

  const index = await indexStore(q);
  const inReplay = (key: string) => inStore.has(key);
  const story = fromIntakeStory(index);
  const lfd = fromIntakeLfd(index);
  const kindAt = (now: Date) => kindOf(index, now);
  const cmp = (legacy: LegacyCand[], intake: IntakeCand[], now: Date) => compareLists(legacy, uniq(intake), inReplay, kindAt(now));

  out.comparisons.mdReels = cmp(night.legacy.mdReels, morning.reels.map(story), evalNow);
  out.comparisons.mdCarousel = cmp(night.legacy.mdCarousel, morning.carousel.map(story), evalNow);
  out.comparisons.gtn = cmp(night.legacy.gtn, numbers.unbriefed.map(story), evalNow);
  out.comparisons.fvp = cmp(night.legacy.fvp, leads.map(fromIntakeLead(index)), evalNow);
  out.comparisons.lfdReels = cmp(night.legacy.lfdReels, lanes.reels.map(lfd), lfdNow);
  out.comparisons.lfdCarousel = cmp(night.legacy.lfdCarousel, lanes.carousel.map(lfd), lfdNow);
  // Legacy fresh feed: only where the feeds were fetched (the newest night); past feed articles are not stored.
  out.comparisons.lfdFeed = feedArticles
    ? cmp((await freshFeedLane(async () => feedArticles, night.feedSince, lfdNow)).map(fromLfd), lanes.feed.map(lfd), lfdNow)
    : null;

  // Morning Download lead queue (intake mode): one story per intake story, ranked by stored major-news.
  const seen = new Set<string>();
  const pool = dedupe([...morning.carousel, ...morning.reels]).filter((c) => {
    const id = c.intake?.storyId;
    return id ? (seen.has(id) ? false : (seen.add(id), true)) : true;
  });
  for (const bar of BARS) {
    const ranked = pool.map((c) => ({ ...c, score: c.intake?.major ?? 0, intake: c.intake ? { ...c.intake, builder: atBar(c.intake.builder, bar) } : undefined }));
    const chosen = chooseLeads(ranked, evalNow);
    const builders = chosen.filter((c) => mdLeadFor(c, evalNow)?.lane === 'builder').length;
    out.mdBuilders[bar.toFixed(1)] = { leads: chosen.length, builders, pool: pool.length };
  }
  return { lanes, w, now: lfdNow };
}

/** The intake branch of lib/lfd/run.ts gather (no seeds), then Selector.fill at each bar. */
async function lineups(
  input: { lanes: IntakeLanes; w: LfdWindow; now: Date },
  previous: Snapshot['previous'],
  ask: JevAsk,
): Promise<{ lineups: Lineup[]; note: string }> {
  const used = usedIdeaIds(previous);
  const reels = withoutUsed(input.lanes.reels, used);
  const carousel = withoutUsed(input.lanes.carousel, used);
  const feed = withoutUsed(input.lanes.feed, used);
  const pool = judgedPool(carousel, reels, feed);
  const judgedKeys = new Set(pool.map((c) => c.key));
  const rundownOnly = [...reels]
    .sort(rundownOrder)
    .filter((c) => !judgedKeys.has(c.key))
    .slice(0, RUNDOWN_POOL)
    .map((c) => ({ ...c, major: null }));
  const merged = await mergeSameEvent([...pool.sort((a, b) => (b.major ?? 0) - (a.major ?? 0)), ...rundownOnly], ask);
  const leads = merged.filter((c) => c.major !== null || c.builder !== null);
  const rundown = merged.filter((c) => c.origin === 'reels' || c.refs.some((r) => reels.some((x) => x.refs.includes(r))));
  const prevStories = previous[0]?.stories ?? [];
  const out: Lineup[] = [];
  for (const bar of BARS) {
    const shifted = leads.map((c) => ({ ...c, builder: atBar(c.builder, bar) }));
    const original = new Map(leads.map((c) => [c.key, c.builder]));
    const picks: Pick[] = await new Selector(shifted, rundown, prevStories, ask, [], input.now).fill();
    out.push({
      bar,
      picks: picks.map((p) => ({ lane: p.lane, headline: p.headline, builder: original.get(p.key) ?? p.builder ?? null, major: p.major, origin: p.origin })),
      builders: picks.filter((p) => p.lane === 'builder').length,
    });
  }
  const note = previous.length
    ? `Previous posts: the ${previous.length} Last Few Days post(s) before ${input.w.through} (newest ${previous[0]!.nyDate}), read only from lfd.posts; their stories are skipped and the newest one's are checked for repeats. Archived keys and seeds are not read.`
    : 'Previous posts: none found before the window; no repeat check. Archived keys and seeds are not read.';
  return { lineups: out, note };
}

/* ── the report (for Lucas; no code) ──────────────────────────────────── */

const pctText = (p: number | null) => (p === null ? 'n/a' : `${Math.round(p * 100)}%`);
const cell = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\|/g, '/').replace(/\s+/g, ' ');
const num = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '–' : n.toFixed(d));

function listOf(items: string[], max = 10): string {
  if (items.length === 0) return 'none';
  const shown = items.slice(0, max).map((h) => `"${cell(h, 80)}"`);
  return `${shown.join('; ')}${items.length > max ? `; and ${items.length - max} more` : ''}`;
}

export function renderReport(r: ReplayResult, snapshot: Snapshot, generatedAt: Date): string {
  const L: string[] = [];
  const nights = snapshot.nights.map((n) => n.nyDate);
  L.push(`# Central intake replay, ${nights[0]} to ${nights[nights.length - 1]}`, '');
  L.push(
    `Generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. A dry run: the new central intake was fed the stories the old pipelines saw on these nights, ` +
      'in a throwaway in-memory copy. Nothing was written to the real database and nothing was posted.',
  );
  L.push('');
  if (r.stopped) L.push(`**Partial report.** The run stopped at ${r.stopped.at}: ${r.stopped.reason}. Everything below covers only what finished before that.`, '');

  L.push('## How to read this', '');
  L.push(
    '- **Legacy** is what each content type read on that night from the old pipelines. **Intake** is what it would read from the central intake.',
    '- A legacy story counts as **matched** when its article sits inside a story the intake hands to the same content type. The ship target is **80% or more** per content type per night.',
    '- **Outside the replay** means the legacy story\'s article came from a night before the replay started (or after that night), so the intake could not have it. Those are left out of the percentage.',
    '- **Intake only** splits into: new because the carousel is off (feed stories the old path no longer reads), builder leads (stories that clear the builder bar), and other.',
    '- The carousel has been switched off since 2 November, so legacy carousel lists are mostly empty; feed stories the intake adds there are expected.',
    `- The news feeds are not stored, so they were fetched once today and added only to the newest night (${nights[nights.length - 1]}). Older nights have no feed stories on either side.`,
    '',
  );

  L.push('## Coverage by night', '');
  for (const n of r.nights) {
    const it = n.items;
    L.push(`### ${n.nyDate}`, '');
    L.push(
      `Stored ${it.reels} reels items, ${it.search} web-search finds and ${it.feeds} feed articles` +
        `${it.feedsFetched !== undefined ? ` (of ${it.feedsFetched} fetched; ${it.feedsAfterClock} published after that night's intake were left out, the rest filtered by the intake's window and code filters)` : ''}` +
        `${it.repeats ? `; ${it.repeats} links seen on an earlier night were not stored again` : ''}. ` +
        `Grouping made ${n.grouping.created} stories, joined ${n.grouping.joined} items to existing ones and merged ${n.grouping.merges} pairs of stories.`,
      '',
    );
    L.push('| Content type | Legacy | Outside replay | Matched | Matched % | Target | Intake only: carousel off / feeds | Intake only: builder | Intake only: other |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const [id, label] of CONSUMERS) {
      const c = n.comparisons[id];
      if (c === undefined) continue;
      if (c === null) {
        L.push(`| ${label} | not available (feeds not stored for this night) | | | | | | | |`);
        continue;
      }
      const target = c.pct === null ? 'n/a' : c.pct >= TARGET ? 'met' : '**missed**';
      L.push(`| ${label} | ${c.legacy} | ${c.outside} | ${c.matched} of ${c.inScope} | ${pctText(c.pct)} | ${target} | ${c.intakeOnly.feeds.length} | ${c.intakeOnly.builder.length} | ${c.intakeOnly.other.length} |`);
    }
    L.push('');
    const misses = CONSUMERS.filter(([id]) => (n.comparisons[id]?.legacyOnly.length ?? 0) > 0);
    if (misses.length) {
      L.push('Legacy stories the intake did not hand over:', '');
      for (const [id, label] of misses) L.push(`- ${label}: ${listOf(n.comparisons[id]!.legacyOnly)}`);
      L.push('');
    }
    const others = CONSUMERS.filter(([id]) => (n.comparisons[id]?.intakeOnly.other.length ?? 0) > 0);
    if (others.length) {
      L.push('Intake-only stories marked "other":', '');
      for (const [id, label] of others) L.push(`- ${label}: ${listOf(n.comparisons[id]!.intakeOnly.other, 8)}`);
      L.push('');
    }
  }

  L.push('## Builder bar calibration', '');
  L.push(
    `The builder score (story-builder@2) rates stories about people making or finding something that pushes limits. Today's bar is ${BUILDER_BAR}. ` +
      `${r.builderStories} replayed stories carry a builder score. The 30 highest:`,
    '',
  );
  if (r.topBuilders.length) {
    L.push('| # | Headline | Builder | Major news | Event date | Source |', '|---|---|---|---|---|---|');
    r.topBuilders.forEach((b, i) => L.push(`| ${i + 1} | ${cell(b.headline)} | ${num(b.builder)} | ${num(b.major)} | ${b.eventDate ?? 'unknown'} | ${cell(b.source, 40)} |`));
    L.push('');
  }
  if (r.lineupWindow) {
    L.push(
      `### Last Few Days lineups, nights after ${r.lineupWindow.after} through ${r.lineupWindow.through}`,
      '',
      'The six slides the picker would choose from the intake at three builder bars (no seeds). Leads come first by how far they clear their bar; major news is capped at 3, builders are not.',
      r.previousNote,
      '',
    );
    for (const lu of r.lineups) {
      L.push(`**Bar ${lu.bar.toFixed(1)}**: ${lu.builders} of ${lu.picks.length} slides are builder stories (${lu.picks.length ? Math.round((lu.builders / lu.picks.length) * 100) : 0}%).`, '');
      L.push('| Slot | Lane | Headline | Builder | Major news | From |', '|---|---|---|---|---|---|');
      lu.picks.forEach((p, i) => L.push(`| ${i + 1} | ${p.lane} | ${cell(p.headline)} | ${num(p.builder)} | ${num(p.major)} | ${p.origin} |`));
      L.push('');
    }
  }
  if (r.nights.some((n) => Object.keys(n.mdBuilders).length)) {
    L.push('### Morning Download: builder stories taken per night', '');
    L.push('Morning Download takes up to 5 leads, at most 2 of them builders. Each cell: builders taken / leads chosen (pool size).', '');
    L.push(`| Night | ${BARS.map((b) => `Bar ${b.toFixed(1)}`).join(' | ')} |`, `|---|${BARS.map(() => '---').join('|')}|`);
    for (const n of r.nights) {
      if (!Object.keys(n.mdBuilders).length) continue;
      L.push(`| ${n.nyDate} | ${BARS.map((b) => {
        const x = n.mdBuilders[b.toFixed(1)];
        return x ? `${x.builders} / ${x.leads} (${x.pool})` : '–';
      }).join(' | ')} |`);
    }
    L.push('');
  }

  L.push('## Cost and runtime', '');
  L.push(`Jev spend ${money(r.totalUsd)} over ${r.totalCalls} calls (cap ${money(r.capUsd, 2)}). Runtime ${(r.runtimeMs / 60_000).toFixed(1)} minutes.`, '');
  L.push('| Step | Calls | USD |', '|---|---|---|');
  for (const s of [...r.steps].sort((a, b) => b.usd - a.usd)) L.push(`| ${s.step} | ${s.calls} | ${money(s.usd)} |`);
  L.push('');
  const scored: Record<string, { scored: number; cached: number }> = {};
  for (const n of r.nights) for (const [k, v] of Object.entries(n.tally)) scored[k] = { scored: (scored[k]?.scored ?? 0) + v.scored, cached: (scored[k]?.cached ?? 0) + v.cached };
  L.push(
    `Cache hits: ${r.cacheHits.scores} scores reused (${Object.entries(scored).filter(([, v]) => v.scored || v.cached).map(([k, v]) => `${k}: ${v.scored} scored, ${v.cached} reused`).join('; ') || 'none'}), ` +
      `${r.cacheHits.grouping} grouping decisions reused.`,
    '',
  );
  return L.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

export type Args = { nights: string[] | null; cap: number; go: boolean; out: string | null; noFeeds: boolean };

export function parseArgs(argv: readonly string[]): Args {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] ?? null : null;
  };
  const nights = value('--nights');
  const cap = Number(value('--cap') ?? '1.00');
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('--cap must be a positive dollar amount');
  const list = nights ? nights.split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (list?.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error('--nights takes YYYY-MM-DD dates, comma separated');
  return { nights: list, cap, go: argv.includes('--go'), out: value('--out'), noFeeds: argv.includes('--no-feeds') };
}

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
  }
}

/** An in-memory intake store: PGlite with db/intake_schema.sql (the tests' setup). */
export async function memoryIntake(): Promise<{ q: IntakeQuery; close: () => Promise<void> }> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const pg = new PGlite({ extensions: { pg_trgm } });
  const sql = readFileSync(path.join(process.cwd(), 'db', 'intake_schema.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
  await pg.exec(sql);
  return {
    q: { query: async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] }) },
    close: () => pg.close(),
  };
}

async function main(): Promise<void> {
  loadEnvFile(path.join(process.cwd(), '.env.local'));
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (.env.local)');

  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let snapshot: Snapshot;
  let phase2: Phase2Snapshot;
  try {
    // One read-only transaction for every real-DB read (never a session-level SET on the pooler).
    await client.query('BEGIN READ ONLY');
    const db = readOnlyQuery((text, params) => client.query(text, params as unknown[]));
    const nights = args.nights ?? (await defaultNights(db));
    snapshot = await loadSnapshot(db, nights);
    phase2 = await loadPhase2Snapshot(db, snapshot.nights);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }

  console.log(renderPlan(planReplay(snapshot), args.cap, planPhase2(phase2)));
  if (!args.go) {
    console.log('\nPlan only. Add --go to run the replay (live Jev, capped; feeds fetched once).');
    return;
  }

  const [{ liveJevTransport }, { fetchAllFeeds }] = await Promise.all([import('@/lib/reels/jev/client'), import('@/lib/social/ingest/fetch-feeds')]);
  const store = await memoryIntake();
  try {
    const result = await runReplay(snapshot, {
      intake: store.q,
      transport: liveJevTransport,
      // --no-feeds: reels-side calibration only (a past night's feeds are not stored; a live fetch is today's).
      fetchFeeds: () => (args.noFeeds ? Promise.resolve([]) : fetchAllFeeds(HELIOS_SOCIAL_FEEDS)),
      capUsd: args.cap,
      log: (line) => console.log(line),
      phase2,
    });
    // Carousel and Field Notes in fresh in-memory stores, with what is left of the same cap.
    const ledger = await memoryIntake();
    let p2: Phase2Result = { reels: [], carousel: [], fieldNotes: [], stopped: null };
    try {
      const left = args.cap - result.totalUsd;
      if (left > 0 && !result.stopped) {
        const jev = createIntakeJev(liveJevTransport, ledger.q, null, left);
        p2 = await runPhase2(phase2, { store: memoryIntake, jev, log: (line) => console.log(line) });
        result.totalUsd += jev.usd;
        result.totalCalls += jev.calls;
      } else p2.stopped = 'the cap was spent before Phase 2';
    } finally {
      await ledger.close();
    }
    p2.reels = result.phase2Reels ?? [];
    const now = new Date();
    const out = args.out ?? path.join('planning', 'Central Intake', `replay-${now.toISOString().slice(0, 10)}.md`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${renderReport(result, snapshot, now)}\n\n${renderPhase2Report(p2)}`);
    console.log(`\nReport: ${out}`);
    console.log(`Jev ${result.totalCalls} calls, ${money(result.totalUsd)}; runtime ${(result.runtimeMs / 60_000).toFixed(1)} min${result.stopped ? `; STOPPED at ${result.stopped.at}` : ''}`);
  } finally {
    await store.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
