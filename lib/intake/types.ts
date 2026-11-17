/**
 * Central intake: the shared contract (Phase 1, 2026-11-09). FROZEN once the
 * builders start: change it only through the integrator.
 *
 * One nightly intake fetches every source an open order names, groups items
 * about the same event into stories (grouping-v2 logic), and runs every
 * scorecard an open order names, once per story per member set. Content types
 * read pre-scored stories through read functions; they never score at pick
 * time (the per-order posted check is the one exception, see PostedCheck).
 *
 * Independence (Lucas, round 4): sources and judgments belong to the intake,
 * not to a content type. The intake never reads or writes `reels.*` or
 * `social.*` run tables. The one inbound link is Reels' Claude web search,
 * which deposits its finds here (`depositFind`), like a seed.
 *
 * CLAUDE.md Rule 2: scorecards run only on stories touched in the current
 * intake run (a new item joined) and on seeds. Nothing iterates the store to
 * score or backfill it.
 *
 * Plan: ~/.claude/plans/ok-one-type-of-keen-umbrella.md (Phase 1 contract,
 * rounds 3–4).
 */

import type { AdapterItem, SourceType } from '@/lib/reels/types';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';

/* ── plumbing ─────────────────────────────────────────────────────────── */

/** Same shape as lib/stories/db Queryable and the hub query object. */
export type IntakeQuery = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

/** Which family an item comes from. Scorecards read only their family's members (keeps scores equal to today's). */
/** Phase 2: 'field-notes' = Field Notes' own sources (lib/field-notes/sources/registry.ts); each item is its own story (never grouped). */
export type Family = 'reels' | 'feeds' | 'search' | 'seed' | 'field-notes';

/** Source ids: a reels adapter id, a feed slug (`feed:<slug>`), `search:b6`, or `seed:<type>`. */
export type SourceId = string;

/* ── orders ───────────────────────────────────────────────────────────── */

/** Phase 2 adds 'reels', 'carousel' and 'field-notes' (planning/Central Intake/PHASE2-CONTRACT.md). */
export type OrderId = 'lfd' | 'md' | 'gtn' | 'fvp' | 'reels' | 'carousel' | 'field-notes';

export type ScorecardId = 'reels-screen' | 'reels-score' | 'story-scoring' | 'major-news' | 'story-builder' | 'field-notes-score';

export type IntakeOrder = {
  id: OrderId;
  /** Reels primary adapter ids and/or `feed:<slug>`; `'reels:*'` = every primary adapter, `'feeds:*'` = all 19 feeds. */
  sources: readonly string[];
  /** How far back the type reads stories (retention is the max over orders, plus 2 days). */
  lookbackDays: number;
  scorecards: readonly ScorecardId[];
  /** Open from the type's OWN settings (enabled / auto / a pending manual run / an open seed). Never from another type's state. */
  isOpen(q: IntakeQuery, now: Date): Promise<boolean>;
};

/* ── store rows (db/intake_schema.sql) ────────────────────────────────── */

export type IntakeItem = {
  key: string; // canonical URL (unique)
  family: Family;
  sourceId: SourceId;
  sourceName: string;
  sourceType: SourceType | 'feed' | 'seed';
  headline: string;
  body: string;
  url: string;
  /** Event or publish date: B6 `happened_on`, else the source's publish time; null when unknown. */
  publishTime: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  engagement: Record<string, number> | null;
  /** Overall: null when at least one membership keeps the item (only then does it join a story), else the origin's reason. */
  dropReason: string | null; // reels DropReason or a feed code-filter reason
  /**
   * Memberships (review fix 1, 2026-11-09): a URL can be on a reels adapter AND a feed. `family` is whoever stored it
   * first; these record each list's own verdict so a scorecard sees every list that carries the item. Absent/null on
   * rows from before the columns: membership then follows `family` + `dropReason`.
   */
  feedSlug?: string | null;
  feedDropReason?: string | null;
  /** The feed's outlet name (`article.source`) when a feed carries the item. */
  feedSourceName?: string | null;
  reelsSourceId?: string | null;
  reelsDropReason?: string | null;
  storyId: string | null;
  role: 'primary' | 'supporting' | 'merged_duplicate' | null;
};

export type IntakeStory = {
  id: string;
  representativeKey: string;
  headline: string;
  firstSeenAt: Date;
  /** Set when a new member joins: drives "timely" (MD) and re-scoring. */
  lastJoinedAt: Date;
  mergedInto: string | null;
  members: IntakeItem[];
};

/* ── scorecards (lib/intake/scorecards.ts, Owner B) ───────────────────── */

/** `id@version`, e.g. 'major-news@3'. The cache key is (story, scorecardVersion, memberHash). */
export type ScorecardVersion = string;

export type ScoreRow = {
  storyId: string;
  scorecard: ScorecardId;
  version: ScorecardVersion;
  /** Hash of the sorted member keys of the scorecard's family subset. A different hash ⇒ re-score (only for stories touched in this run). */
  memberHash: string;
  answers: Record<string, unknown>;
  result: ScorecardResult;
  usd: number;
  scoredAt: Date;
};

export type ScorecardResult =
  | { kind: 'reels-screen'; dropReason: string | null } // per ITEM; stored on the item, row kept for audit
  | { kind: 'reels-score'; score: InterpretedScore; best_net?: number | null; best_blockbuster?: number | null } // net, blockbuster, chosenBucket, ...; best_* = greatest over re-scores
  | { kind: 'story-scoring'; status: 'qualified' | 'not-qualified' | 'skipped'; probSum: number; outletCount: number; answers: Record<string, number> }
  | { kind: 'major-news'; score: number }
  | { kind: 'story-builder'; score: number }
  /** Phase 2: field-notes-score@3 on one 'field-notes' item (lib/field-notes/sources/score.ts scoreFromAnswers). */
  | { kind: 'field-notes-score'; score: number; tags: import('@/lib/field-notes/sources/score').TipTags; answers: Record<string, number> };

export type Scorecard = {
  id: ScorecardId;
  version: ScorecardVersion;
  /** Members this scorecard reads: reels-score → reels+search; story-scoring → feeds; major/builder → all. */
  families: readonly Family[];
  /** Optional narrower member filter within `families` (reels-score keeps only its own order's seeds). */
  keepMember?: (m: IntakeItem) => boolean;
  /** Score one story (or, for reels-screen, one item). Must not read per-night state (posted lists, slates, carryover). */
  score(story: IntakeStory, jev: IntakeJev): Promise<{ answers: Record<string, unknown>; result: ScorecardResult; usd: number }>;
};

/**
 * Per-order posted check (replaces story-scoring@4's `already_posted` noul,
 * which depends on the posted list and so cannot be cached). Run at read time
 * on qualified stories only, against the same list the type uses today
 * (carousel: social.posted_stories 14 days, read-only). Bar: POSTED_MIN 0.7.
 */
export type PostedCheck = (stories: IntakeStory[], postedHeadlines: string[], jev: IntakeJev) => Promise<Set<string /* storyId already posted */>>;

/* ── Jev (lib/intake/jev.ts, Owner A) ─────────────────────────────────── */

/**
 * One Jev surface for the intake. Wraps the TypeSafe transport; records cost
 * in `intake.cost_events` (its own bucket, never reels/stories/social).
 * Adapters: `asReelsRunner()` satisfies lib/reels/jev/runner JevRunner (for
 * scoreOneIdea and the screen); `asSocialAsk()` satisfies lib/social/jev
 * JevAsk (for story-scoring@4 and major-news via scoreMajor-style calls).
 */
export type IntakeJev = {
  asReelsRunner(): import('@/lib/reels/jev/runner').JevRunner;
  asSocialAsk(): import('@/lib/social/jev/client').JevAsk;
  readonly usd: number;
  readonly calls: number;
};

/** Hard cap: when spent, the run stops asking, finishes what is stored, and records `stopReason: 'cap'`. */
export const INTAKE_MAIN_CAP_USD = 0.5;
export const INTAKE_TOPUP_CAP_USD = 0.15;
/** Phase 2: cap for one deposit run (Reels' A4/B6 finds, about 5 items a night). */
export const INTAKE_DEPOSIT_CAP_USD = 0.15;

/* ── run (lib/intake/run.ts, Owner A) ─────────────────────────────────── */

/** Phase 2 'deposit': Reels' 1 AM call that groups and scores items deposited since the last run (no fetch). */
export type IntakeRunKind = 'main' | 'topup' | 'manual' | 'deposit';

export type IntakeRunRecord = {
  kind: IntakeRunKind;
  orders: OrderId[]; // open orders this run
  sources: { id: SourceId; fetched: number; kept: number; dropped: Record<string, number>; error?: string }[];
  grouping: { created: number; joined: number; merges: number; pairCalls: number; cacheHits: number };
  scoring: Record<ScorecardId, { scored: number; cached: number; usd: number }>;
  usd: number;
  stopReason?: 'cap' | 'no-orders' | 'error';
  /** The scoring stage ran (not skipped for the cap). Only such a run counts as fresh (read.ts). */
  scored?: boolean;
  /** Where the cap first stopped asking. */
  capStage?: 'screen' | 'grouping' | 'scoring';
  /** Set when the screen hit the cap: what was not screened (and so not stored). */
  unscreened?: string;
  /** Touched stories left unscored (cap): the NEXT run, and only it, scores them too. */
  unscored?: string[];
  /** How many of the previous run's `unscored` this run took on. */
  carried?: number;
  /** Phase 2: why a deposit run did nothing (another intake run was still running). */
  skipped?: string;
  /** Per-scorecard scoring failures (non-cap errors), so they show in the run record. */
  scoringFailures?: Partial<Record<ScorecardId, number>>;
};

export type RunIntakeDeps = {
  query: IntakeQuery;
  jev: IntakeJev;
  now: () => Date;
  /** Reels primary adapters (`primaryAdapters()`); injectable for tests. */
  adapters: readonly import('@/lib/reels/types').Adapter[];
  fetchFeeds: (feeds: import('@/lib/social/feeds').FeedConfig[]) => Promise<import('@/lib/social/ingest/fetch-feeds').FetchedArticle[]>;
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<unknown>;
  orders: readonly IntakeOrder[];
  scorecards: readonly Scorecard[];
  log?: (line: string) => void;
};

/** runIntake(deps, kind) → run id + record. No open order ⇒ fetch nothing, record `no-orders`. */
export type RunIntake = (deps: RunIntakeDeps, kind: IntakeRunKind) => Promise<{ runId: string; record: IntakeRunRecord }>;

/** Before a manual LFD run or MD/GTN/FvP Generate: run a top-up when the last successful run is older than 180 min. Never throws. */
export const INTAKE_STALE_AFTER_MINUTES = 180;

/* ── deposits and seeds (Owner A: depositFind; Owner B: addIntakeSeed) ── */

/** B6 Claude web search find → an intake item (family 'search'); grouped and scored by the next intake run. */
export type DepositFind = (q: IntakeQuery, item: AdapterItem, now: Date) => Promise<{ key: string; created: boolean }>;

/** A seed: read the link, join or create a story, score it with the order's scorecards now (≤ 2 Jev calls beyond reels-score), mark it yours. */
export type AddIntakeSeed = (
  q: IntakeQuery,
  jev: IntakeJev,
  input: { order: OrderId; url: string; seededBy: string; headline?: string; body?: string },
  now: Date,
) => Promise<{ storyId: string; created: boolean }>;

/* ── reads (lib/intake/read.ts, Owner A) ──────────────────────────────── */

export type ScoredStory = IntakeStory & {
  scores: Partial<{
    'reels-score': InterpretedScore;
    'story-scoring': Extract<ScorecardResult, { kind: 'story-scoring' }>;
    'major-news': number;
    'story-builder': number;
    /** Phase 2: the stored field-notes-score@3 result (score, tags, answers) of the story's Field Notes member. */
    'field-notes-score': Extract<ScorecardResult, { kind: 'field-notes-score' }>;
  }>;
  /** Event date: a 'search' member's publish time (B6 happened_on), else the EARLIEST member publish time; null when none. */
  eventDate: Date | null;
  /** The best net / blockbuster any reels-score of this story reached (LFD reels lane); `scores['reels-score']` is the latest. */
  reelsBest?: { net: number | null; blockbuster: number | null } | null;
  yours: boolean;
};

export type ListStoriesInput = {
  since: Date; // lastJoinedAt >= since OR firstSeenAt >= since
  until?: Date;
  families?: readonly Family[]; // stories with ≥1 member of these families
  needScores?: readonly ScorecardId[]; // only stories that carry these scores
  limit?: number;
};

/** Pure read: no scoring, no writes. Merged-away stories are excluded. */
export type ListStories = (q: IntakeQuery, input: ListStoriesInput) => Promise<ScoredStory[]>;

/** Last successful run of each kind (for freshness and for MD's "timely" window). */
export type LastRuns = (q: IntakeQuery) => Promise<{ main: { id: string; startedAt: Date } | null; topup: { id: string; startedAt: Date } | null }>;

/* ── consumer switch (intake.settings, key 'consumers') ───────────────── */

/**
 * Per type: 'intake' reads intake stories; 'legacy' keeps today's path.
 * Default 'legacy' until Lucas flips it after the real run. When 'intake' is
 * set but the intake has no successful main run in the last 26 h, the type
 * falls back to 'legacy' for that build and records `intake: 'stale-fallback'`.
 */
export type ConsumerMode = 'intake' | 'legacy';
export type ConsumerSettings = Record<OrderId, ConsumerMode>;
export const INTAKE_FRESH_HOURS = 26;

/* ── builder lane (lib/stories/scores.ts, Owner B) ────────────────────── */

export type Lead = 'major' | 'builder';
/** leadOf({major, builder}) → the lane whose score clears its bar by more, or null. Builder requires eventDate within BUILDER_WINDOW_DAYS (unknown date passes). */
export type LeadOf = (s: { major: number | null; builder: number | null; eventDate: Date | null }, now: Date) => { lane: Lead; margin: number } | null;
export const BUILDER_WINDOW_DAYS = 7;

/* ── night schedule v2 (NY time) ──────────────────────────────────────── */

export const INTAKE_MAIN_HOUR_NY = 0; // 12:00 AM
export const INTAKE_TOPUP_HOUR_NY = 2;
export const INTAKE_TOPUP_MINUTE_NY = 40; // 2:40 AM
