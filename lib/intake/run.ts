/**
 * One intake run (lib/intake/types.ts RunIntake): open orders → fetch the
 * union of the sources they name → group (grouping-v2) → score only the
 * stories touched in this run (Rule 2) → write `intake.runs`.
 *
 * No open order: nothing is fetched, the run is recorded `no-orders`.
 * IntakeCapReached at any step: asking stops, what is stored stays, `cap`
 * (per stage, see runIntakeWith).
 * The intake never reads or writes `reels.*` or `social.*` run tables.
 */
import { RUN_HANG_BACKSTOP_MINUTES } from '@/lib/content-runs/hang-guard';
import { randomUUID } from 'node:crypto';

import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import type { Scorecard, ScorecardId } from './types';

import type { SourceEntry as FieldNotesSourceEntry } from '@/lib/field-notes/sources/registry';

import {
  enrichThinFeedBodies,
  fetchBodyFrom,
  fetchFeedItems,
  fetchFieldNotesItems,
  fetchReelsAdapter,
  planSources,
  type FetchContext,
  type FieldNotesFetchers,
  type SourceEntry,
} from './fetch';
import { pickFieldNotesStories } from './field-notes-cap';
import { groupIntake, type GroupingResult } from './group';
import { isIntakeCapReached, liveIntakeJev, type IntakeJevHandle } from './jev';
import { lastSuccessfulRunAt, loadStories } from './read';
import { pruneIntake } from './retention';
import { wantedScorecards, type ScoreOptions } from './score';
import { fieldNotesMemberOf, isFieldNotesScorecard } from './scorecards';
import {
  INTAKE_DEPOSIT_CAP_USD,
  INTAKE_MAIN_CAP_USD,
  INTAKE_STALE_AFTER_MINUTES,
  INTAKE_TOPUP_CAP_USD,
  type IntakeJev,
  type IntakeOrder,
  type IntakeQuery,
  type IntakeRunKind,
  type IntakeRunRecord,
  type IntakeStory,
  type RunIntakeDeps,
} from './types';

/** Owner B's scoreForStories (lib/intake/score.ts), injectable for tests. */
export type ScoreForStories = (
  q: IntakeQuery,
  jev: IntakeJev,
  stories: IntakeStory[],
  orders: readonly IntakeOrder[],
  scorecards: readonly Scorecard[],
  opts?: ScoreOptions,
) => Promise<Record<ScorecardId, { scored: number; cached: number; usd: number }>>;

const SCORECARD_IDS: ScorecardId[] = ['reels-screen', 'reels-score', 'story-scoring', 'major-news', 'story-builder', 'field-notes-score'];

/**
 * Phase 2 run deps (a helper type over the frozen RunIntakeDeps): Field Notes' fetchers (absent: its sources are not
 * fetched and the run says so) and, for tests, the registry entries to read.
 */
export type IntakeRunDeps = RunIntakeDeps & {
  fieldNotes?: FieldNotesFetchers;
  fieldNotesEntries?: readonly FieldNotesSourceEntry[];
};

type Tally = IntakeRunRecord['scoring'];

/**
 * Score the stories with every card the open orders name, Field Notes' per-run cap applied: field-notes-score
 * runs only on the stories pickFieldNotesStories selects; the rest go to `unscored` (carried by the next run).
 */
async function scoreStories(
  score: ScoreForStories,
  q: IntakeQuery,
  jev: IntakeJev,
  stories: IntakeStory[],
  open: readonly IntakeOrder[],
  scorecards: readonly Scorecard[],
  opts: ScoreOptions & { unscored: Set<string> },
): Promise<Partial<Tally>> {
  const out: Partial<Tally> = {};
  const take = (tally: Partial<Tally>, ids: readonly ScorecardId[]) => {
    for (const id of ids) if (tally[id]) out[id] = tally[id];
  };
  const fieldNotes = scorecards.find((card) => card.id === 'field-notes-score');
  const rest = scorecards.filter((card) => card !== fieldNotes);
  if (rest.length) take(await score(q, jev, stories, open, rest, opts), rest.map((card) => card.id));
  if (!fieldNotes) return out;
  const wanted = stories.filter((story) => wantedScorecards(story, open).has('field-notes-score'));
  if (wanted.length === 0) return out;
  const pick = await pickFieldNotesStories(q, wanted, fieldNotes);
  for (const id of pick.deferred) opts.unscored.add(id);
  if (pick.selected.length === 0) return out;
  if ((jev as Partial<IntakeJevHandle>).capHit) {
    for (const story of pick.selected) opts.unscored.add(story.id);
    return out;
  }
  take(await score(q, jev, pick.selected, open, [fieldNotes], opts), ['field-notes-score']);
  return out;
}

function emptyScoring(): IntakeRunRecord['scoring'] {
  return Object.fromEntries(SCORECARD_IDS.map((id) => [id, { scored: 0, cached: 0, usd: 0 }])) as IntakeRunRecord['scoring'];
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function openOrders(deps: RunIntakeDeps, now: Date): Promise<IntakeOrder[]> {
  const open: IntakeOrder[] = [];
  for (const order of deps.orders) {
    try {
      if (await order.isOpen(deps.query, now)) open.push(order);
    } catch (error) {
      // An order that cannot read its own settings is closed for this run.
      deps.log?.(`[intake] order ${order.id} isOpen failed: ${errorText(error)}`);
    }
  }
  return open;
}

/** Bound on the orphans one run hands the next (fix 4): the previous run's `unscored` only, never a sweep. */
export const MAX_CARRIED_STORIES = 500;

/** Bound on the deposit runs read after the last fetching run (one a night; a few retried ones at most). */
const MAX_DEPOSITS_READ = 10;

const unscoredOf = (raw: unknown): string[] => {
  const list = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
};

/**
 * The stories the previous finished run touched but could not score (its `record.unscored`, fix 4): the last
 * fetching run's (main/topup/manual) plus those of the deposit runs since it, so a deposit never drops main's
 * orphans (even one that failed before passing them on). Only those runs are read, so a story is carried by the run
 * after the one that left it, never found by scanning the store.
 */
export async function previousUnscored(q: IntakeQuery, runId: string): Promise<string[]> {
  const finished = `id <> $1 AND status IN ('ok', 'partial', 'failed')`;
  const { rows: last } = await q.query<{ started_at: Date | string; unscored: unknown }>(
    `SELECT started_at, record->'unscored' AS unscored FROM intake.runs
      WHERE ${finished} AND kind <> 'deposit'
      ORDER BY started_at DESC LIMIT 1`,
    [runId],
  );
  const since = last[0] ? new Date(last[0].started_at) : new Date(0);
  const { rows: deposits } = await q.query<{ unscored: unknown }>(
    `SELECT record->'unscored' AS unscored FROM intake.runs
      WHERE ${finished} AND kind = 'deposit' AND started_at > $2
      ORDER BY started_at DESC LIMIT ${MAX_DEPOSITS_READ}`,
    [runId, since],
  );
  const out = new Set<string>(last[0] ? unscoredOf(last[0].unscored) : []);
  for (const row of deposits) for (const id of unscoredOf(row.unscored)) out.add(id);
  return [...out].slice(0, MAX_CARRIED_STORIES);
}

/**
 * runIntake with the scoring step injected (tests stub it; production passes B's scoreForStories).
 *
 * The cap (fix 3) is handled per stage: if the screen spends it, screening stops (the rest of that adapter and
 * every later reels adapter are not stored, and their watermarks do not move), the feeds are still fetched (no
 * Jev), grouping still places every item with cached pair decisions only (0 pair calls), and scoring is skipped;
 * the touched stories go to `record.unscored` for the next run. Only a run whose scoring stage ran is `scored`
 * (fresh, read.ts).
 */
export async function runIntakeWith(
  deps: IntakeRunDeps,
  kind: IntakeRunKind,
  score: ScoreForStories,
): Promise<{ runId: string; record: IntakeRunRecord }> {
  const q = deps.query;
  const startedAt = deps.now();
  const runId = (deps.jev as Partial<IntakeJevHandle>).runId ?? randomUUID();
  const log = deps.log ?? (() => {});
  const capHit = () => Boolean((deps.jev as Partial<IntakeJevHandle>).capHit);
  const record: IntakeRunRecord = {
    kind,
    orders: [],
    sources: [],
    grouping: { created: 0, joined: 0, merges: 0, pairCalls: 0, cacheHits: 0 },
    scoring: emptyScoring(),
    usd: 0,
  };
  let status: 'ok' | 'partial' | 'skipped' | 'failed' = 'ok';
  let error: string | null = null;

  await q.query(`INSERT INTO intake.runs (id, kind, status, started_at) VALUES ($1, $2, 'running', $3)`, [runId, kind, startedAt]);

  const grouping: GroupingResult = { created: 0, joined: 0, merges: 0, pairCalls: 0, cacheHits: 0, touched: new Set(), failures: [] };
  // Stories an existing item joined as a new list's member (fix 1), and stories still waiting to be scored.
  const memberTouched = new Set<string>();
  const pending = new Set<string>();
  // Orphans this run does not take on but must not drop (a deposit's pass-through, Field Notes closed tonight).
  const passOn = new Set<string>();
  try {
    const open = await openOrders(deps, startedAt);
    record.orders = open.map((order) => order.id);
    if (open.length === 0) {
      record.stopReason = 'no-orders';
      status = 'skipped';
      log(`[intake] ${kind} run ${runId}: no open order, nothing fetched`);
      return { runId, record };
    }

    // 1. Fetch the union of the sources the open orders name (one fetch per source; a URL is stored once). The screen
    // is the only Jev step here. A deposit run fetches nothing: it groups and scores what was deposited.
    const fetching = kind !== 'deposit';
    const plan = fetching
      ? planSources(open, deps.adapters, undefined, deps.fieldNotesEntries)
      : { adapters: [], feeds: [], lookbackDays: 1, fieldNotes: [], fieldNotesLookbackDays: 1 };
    const ctx: FetchContext = { runId, runStartedAt: startedAt, now: startedAt, jev: deps.jev, fetchPage: deps.fetchPage, log, touched: memberTouched };
    let screenCap: { at: string; skipped: string[] } | null = null;
    for (const adapter of plan.adapters) {
      const entry: SourceEntry = { id: adapter.id, fetched: 0, kept: 0, dropped: {} };
      record.sources.push(entry);
      if (screenCap) {
        entry.error = 'not fetched: the cap was spent in the screen';
        screenCap.skipped.push(adapter.id);
        continue;
      }
      try {
        await fetchReelsAdapter(q, adapter, plan.lookbackDays, ctx, entry);
      } catch (caught) {
        if (!isIntakeCapReached(caught)) throw caught;
        screenCap = { at: adapter.id, skipped: [] };
        entry.error = `the cap was spent in the screen: ${errorText(caught)}`;
        log(`[intake] ${kind} run ${runId}: ${errorText(caught)} while screening ${adapter.id}; screening stops`);
      }
    }
    if (screenCap) {
      record.capStage = 'screen';
      record.unscreened =
        `The cap was spent screening ${screenCap.at}: its unscreened items` +
        (screenCap.skipped.length ? ` and every later reels adapter (${screenCap.skipped.join(', ')})` : '') +
        ' were not stored; their watermarks did not move, so the next run fetches them again.';
    }
    const feedEntries = new Map<string, SourceEntry>();
    for (const feed of plan.feeds) {
      const entry: SourceEntry = { id: `feed:${feed.slug}`, fetched: 0, kept: 0, dropped: {} };
      feedEntries.set(entry.id, entry);
      record.sources.push(entry);
    }
    await fetchFeedItems(q, plan.feeds, deps.fetchFeeds, ctx, feedEntries);
    if (plan.fieldNotes.length > 0) {
      if (deps.fieldNotes) {
        const fieldNotes = await fetchFieldNotesItems({
          query: q,
          now: startedAt,
          runId,
          entries: plan.fieldNotes,
          lookbackDays: plan.fieldNotesLookbackDays,
          fetchers: deps.fieldNotes,
          touched: memberTouched,
          log,
        });
        record.sources.push(...fieldNotes.sources);
      } else {
        for (const entry of plan.fieldNotes) record.sources.push({ id: `field-notes:${entry.id}`, fetched: 0, kept: 0, dropped: {}, error: 'not fetched: no Field Notes fetchers in this run' });
      }
    }

    // 2. Group the new items (Rule 2: only ungrouped items, inside the 72 h pool). Cap spent: cached decisions only.
    await groupIntake(q, deps.jev.asReelsRunner(), runId, startedAt, grouping, { noAsk: capHit() });
    for (const failure of grouping.failures) log(`[intake] grouping: ${failure}`);
    if (grouping.capped && !record.capStage) record.capStage = 'grouping';

    // 3. Thin feed bodies, then score only the stories touched in this run, plus the previous run's orphans (fix 4).
    const touched = [...new Set([...grouping.touched, ...memberTouched])];
    await enrichThinFeedBodies(q, touched, fetchBodyFrom(deps.fetchPage));
    const previous = (await previousUnscored(q, runId)).filter((id) => !touched.includes(id));
    // A deposit scores only what is new to it; it hands the previous run's orphans on untouched (the carry chain).
    const carried = fetching ? previous : [];
    if (!fetching) for (const id of previous) passOn.add(id);
    if (carried.length) record.carried = carried.length;
    const stories = (await loadStories(q, [...touched, ...carried])).filter((story) => !story.mergedInto);
    const named = new Set(open.flatMap((order) => order.scorecards));
    // field-notes-score keeps enriched bodies on the items through this run's store.
    const scorecards = deps.scorecards.filter((card) => named.has(card.id)).map((card) => (isFieldNotesScorecard(card) ? card.withQuery(q) : card));
    if (scorecards.length > 0) for (const story of stories) pending.add(story.id);
    // Field Notes closed tonight: a carried Field Notes story waits for a night it is open (it is not lost).
    if (!named.has('field-notes-score')) for (const story of stories) if (carried.includes(story.id) && fieldNotesMemberOf(story)) passOn.add(story.id);

    if (capHit()) {
      // Nothing can be asked: the stories wait for the next run, and this run is not fresh.
      record.scored = false;
      log(`[intake] ${kind} run ${runId}: the cap is spent; ${pending.size} stories left for the next run`);
    } else {
      const unscored = new Set<string>();
      const failures: Partial<Record<ScorecardId, number>> = {};
      if (stories.length > 0 && scorecards.length > 0) {
        const scored = await scoreStories(score, q, deps.jev, stories, open, scorecards, { log, unscored, failures });
        for (const [id, value] of Object.entries(scored)) record.scoring[id as ScorecardId] = value;
      }
      record.scored = true;
      if (Object.keys(failures).length) record.scoringFailures = failures;
      pending.clear();
      for (const id of unscored) pending.add(id);
      if (capHit() && !record.capStage) record.capStage = 'scoring';
    }
    if (capHit()) {
      record.stopReason = 'cap';
      status = 'partial';
    }
    // 4. Retention, once a night after the main run (bounded deletes by age; never a scoring sweep).
    if (kind === 'main') {
      try {
        const pruned = await pruneIntake(q, startedAt);
        if (pruned.items || pruned.stories) log(`[intake] retention: ${pruned.items} items and ${pruned.stories} stories older than ${pruned.cutoff.toISOString()} dropped`);
      } catch (error) {
        log(`[intake] retention skipped: ${errorText(error)}`);
      }
    }
    return { runId, record };
  } catch (caught) {
    if (isIntakeCapReached(caught)) {
      record.stopReason = 'cap';
      status = 'partial';
      log(`[intake] ${kind} run ${runId}: ${errorText(caught)}; kept what was stored`);
    } else {
      record.stopReason = 'error';
      status = 'failed';
      error = errorText(caught);
      log(`[intake] ${kind} run ${runId} failed: ${error}`);
    }
    if (!record.scored) for (const id of [...grouping.touched, ...memberTouched]) pending.add(id);
    return { runId, record };
  } finally {
    record.grouping = {
      created: grouping.created,
      joined: grouping.joined,
      merges: grouping.merges,
      pairCalls: grouping.pairCalls,
      cacheHits: grouping.cacheHits,
    };
    for (const id of passOn) pending.add(id);
    if (pending.size) record.unscored = [...pending].slice(0, MAX_CARRIED_STORIES);
    record.usd = deps.jev.usd;
    await q
      .query(
        `UPDATE intake.runs SET status = $2, stop_reason = $3, record = $4::jsonb, usd = $5, error = $6, finished_at = $7 WHERE id = $1`,
        [runId, status, record.stopReason ?? null, JSON.stringify(record), record.usd, error, deps.now()],
      )
      .catch((e) => log(`[intake] run ${runId}: could not record the run: ${errorText(e)}`));
  }
}

/** The run (types.ts RunIntake), scoring with Owner B's scoreForStories. */
export async function runIntake(deps: IntakeRunDeps, kind: IntakeRunKind): Promise<{ runId: string; record: IntakeRunRecord }> {
  const { scoreForStories } = await import('./score');
  return runIntakeWith(deps, kind, scoreForStories as ScoreForStories);
}

/** A deposit waits for any intake run started within this window that is still 'running' (a crashed one stops blocking). */
export const DEPOSIT_OVERLAP_HOURS = 6;

export type DepositDeps = {
  /** Default: the live intake Jev capped at INTAKE_DEPOSIT_CAP_USD, its cost rows carrying this run's id. */
  jev?: IntakeJev;
  now?: () => Date;
  orders?: readonly IntakeOrder[];
  scorecards?: readonly Scorecard[];
  /** Default: Owner B's scoreForStories. */
  score?: ScoreForStories;
  log?: (line: string) => void;
};

/**
 * Phase 2: Reels' 1 AM call after its derived adapters (A4, B6) deposited their finds. Kind 'deposit': no fetch;
 * groups the items new since the last run and scores only the stories they touched, with the open orders'
 * scorecards, under INTAKE_DEPOSIT_CAP_USD. The previous run's orphans pass through to the next fetching run.
 * Skipped (record `skipped`, a 'skipped' run row, nothing grouped or scored) while another intake run started in the
 * last DEPOSIT_OVERLAP_HOURS is still 'running': the two would group the same items at once.
 * Never throws: a failure comes back as a record with stopReason 'error'.
 */
export async function runIntakeDeposit(q: IntakeQuery, deps: DepositDeps = {}): Promise<{ runId: string; record: IntakeRunRecord }> {
  const log = deps.log ?? ((line: string) => console.log(line));
  let runId = (deps.jev as Partial<IntakeJevHandle> | undefined)?.runId ?? randomUUID();
  try {
    const now = (deps.now ?? (() => new Date()))();
    const { rows: busy } = await q.query<{ id: string; kind: string }>(
      `SELECT id::text AS id, kind FROM intake.runs WHERE status = 'running' AND started_at > $1 ORDER BY started_at DESC LIMIT 1`,
      [new Date(now.getTime() - DEPOSIT_OVERLAP_HOURS * 3_600_000)],
    );
    if (busy[0]) {
      const record: IntakeRunRecord = {
        kind: 'deposit',
        orders: [],
        sources: [],
        grouping: { created: 0, joined: 0, merges: 0, pairCalls: 0, cacheHits: 0 },
        scoring: emptyScoring(),
        usd: 0,
        skipped: `intake ${busy[0].kind} run ${busy[0].id} is still running`,
      };
      log(`[intake] deposit run skipped: ${record.skipped}`);
      await q
        .query(`INSERT INTO intake.runs (id, kind, status, record, started_at, finished_at) VALUES ($1, 'deposit', 'skipped', $2::jsonb, $3, $3)`, [
          runId,
          JSON.stringify(record),
          now,
        ])
        .catch((e) => log(`[intake] deposit run ${runId}: could not record the skip: ${errorText(e)}`));
      return { runId, record };
    }
    const [orders, scorecards] = await Promise.all([
      deps.orders ?? import('./orders').then((m) => m.INTAKE_ORDERS),
      deps.scorecards ?? import('./scorecards').then((m) => m.INTAKE_SCORECARDS),
    ]);
    const jev = deps.jev ?? (await liveIntakeJev(q, runId, INTAKE_DEPOSIT_CAP_USD));
    runId = (jev as Partial<IntakeJevHandle>).runId ?? runId;
    const score = deps.score ?? ((await import('./score')).scoreForStories as ScoreForStories);
    const runDeps: IntakeRunDeps = {
      query: q,
      jev,
      now: deps.now ?? (() => new Date()),
      adapters: [],
      fetchFeeds: async () => [],
      orders,
      scorecards,
      log,
    };
    return await runIntakeWith(runDeps, 'deposit', score);
  } catch (error) {
    log(`[intake] deposit run failed: ${errorText(error)}`);
    return {
      runId,
      record: {
        kind: 'deposit',
        orders: [],
        sources: [],
        grouping: { created: 0, joined: 0, merges: 0, pairCalls: 0, cacheHits: 0 },
        scoring: emptyScoring(),
        usd: deps.jev?.usd ?? 0,
        stopReason: 'error',
      },
    };
  }
}

/** A run still 'running' after this long died (crash, killed process). */
/** Hang guard only; long runs are normal (CI decision 2026-11-10): 12 h backstop. */
export const INTAKE_ABANDONED_AFTER_HOURS = RUN_HANG_BACKSTOP_MINUTES / 60;

/** Mark runs stuck 'running' for over INTAKE_ABANDONED_AFTER_HOURS as failed, so a dead run never blocks the day's main. */
export async function reapStaleRuns(q: IntakeQuery, now: Date): Promise<number> {
  const { rows } = await q.query<{ id: string }>(
    `UPDATE intake.runs SET status = 'failed', stop_reason = 'error', error = COALESCE(error, 'abandoned: still running after ${INTAKE_ABANDONED_AFTER_HOURS} h'), finished_at = $1
      WHERE status = 'running' AND started_at < $2 RETURNING id::text AS id`,
    [now, new Date(now.getTime() - INTAKE_ABANDONED_AFTER_HOURS * 3_600_000)],
  );
  return rows.length;
}

/**
 * Whether today's (New York date) main run already started and did not fail: the clock's no-double-run guard.
 * A run stuck 'running' past INTAKE_ABANDONED_AFTER_HOURS is reaped first (marked failed), so it does not count.
 */
export async function mainRanToday(q: IntakeQuery, now: Date): Promise<boolean> {
  await reapStaleRuns(q, now);
  const { rows } = await q.query<{ started_at: Date | string }>(
    `SELECT started_at FROM intake.runs
      WHERE kind = 'main' AND status <> 'failed' AND started_at > $1
      ORDER BY started_at DESC`,
    [new Date(now.getTime() - 26 * 3_600_000)],
  );
  const today = calendarDateKey(now, SOCIAL_TIMEZONE);
  return rows.some((row) => calendarDateKey(new Date(row.started_at), SOCIAL_TIMEZONE) === today);
}

/** A top-up is already running (started in the last 30 minutes): a second caller does not start another. */
async function runInFlight(q: IntakeQuery, now: Date): Promise<boolean> {
  const { rows } = await q.query<{ id: string }>(
    `SELECT id::text AS id FROM intake.runs WHERE status = 'running' AND started_at > $1 LIMIT 1`,
    [new Date(now.getTime() - 30 * 60_000)],
  );
  return rows.length > 0;
}

export type EnsureFreshResult = { ran: boolean; reason: string; runId?: string };

/**
 * Before a manual LFD run or an MD/GTN/FvP Generate: a top-up when the last
 * successful run is older than INTAKE_STALE_AFTER_MINUTES. Never throws: a
 * failure is reported in `reason` and the caller goes on.
 */
export async function ensureIntakeFresh(
  q: IntakeQuery,
  deps?: IntakeRunDeps | (() => Promise<IntakeRunDeps>),
  run: (deps: IntakeRunDeps, kind: IntakeRunKind) => Promise<{ runId: string; record: IntakeRunRecord }> = runIntake,
): Promise<EnsureFreshResult> {
  try {
    const now = new Date();
    const last = await lastSuccessfulRunAt(q);
    if (last && now.getTime() - last.getTime() < INTAKE_STALE_AFTER_MINUTES * 60_000) {
      return { ran: false, reason: `fresh: last successful run ${last.toISOString()}` };
    }
    if (await runInFlight(q, now)) return { ran: false, reason: 'a run is already in flight' };
    const resolved = typeof deps === 'function' ? await deps() : deps ?? (await liveIntakeDeps(q, 'topup'));
    const { runId, record } = await run(resolved, 'topup');
    return { ran: true, runId, reason: record.stopReason ?? 'ok' };
  } catch (error) {
    return { ran: false, reason: `intake top-up failed: ${errorText(error)}` };
  }
}

/**
 * Live deps for one run: the reels primary adapters, the live feed fetch,
 * Owner B's orders and scorecards, and a capped Jev (main $0.50, top-up and
 * manual $0.15) whose cost rows carry this run's id.
 */
export async function liveIntakeDeps(query: IntakeQuery, kind: IntakeRunKind = 'main'): Promise<IntakeRunDeps> {
  const [{ primaryAdapters }, { fetchAllFeeds }, { INTAKE_ORDERS }, { INTAKE_SCORECARDS }, http, { PAGE_MAX_BYTES }] = await Promise.all([
    import('@/lib/reels/adapters'),
    import('@/lib/social/ingest/fetch-feeds'),
    import('./orders'),
    import('./scorecards'),
    import('@/lib/reels/net/http'),
    import('@/lib/field-notes/sources/enrich'),
  ]);
  /** Field Notes' feeds and docs pages (lib/field-notes/live.ts SOURCE_MAX_BYTES). */
  const SOURCE_MAX_BYTES = 16_000_000;
  const runId = randomUUID();
  const jev = await liveIntakeJev(query, runId, kind === 'main' ? INTAKE_MAIN_CAP_USD : kind === 'deposit' ? INTAKE_DEPOSIT_CAP_USD : INTAKE_TOPUP_CAP_USD);
  return {
    query,
    jev,
    now: () => new Date(),
    adapters: primaryAdapters(),
    fetchFeeds: fetchAllFeeds,
    orders: INTAKE_ORDERS,
    scorecards: INTAKE_SCORECARDS,
    // Field Notes' collect, wired as lib/field-notes/live.ts wires it (thin: no README or page fetched at collect).
    fieldNotes: {
      fetchText: (url) => http.fetchText(url, { retries: 0, timeoutMs: 15_000, maxBytes: SOURCE_MAX_BYTES }),
      fetchJson: <T,>(url: string) => http.fetchJson<T>(url, { retries: 0, timeoutMs: 15_000, maxBytes: SOURCE_MAX_BYTES }),
      fetchEnrichText: (url) => http.fetchText(url, { retries: 0, timeoutMs: 15_000, maxBytes: PAGE_MAX_BYTES }),
      fetchPage: (url) => http.fetchPageFollowingRedirects(url, { retries: 0, timeoutMs: 15_000, blockPrivate: true, maxBytes: PAGE_MAX_BYTES }),
    },
    log: (line) => console.log(line),
  };
}
