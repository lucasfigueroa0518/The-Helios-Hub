/**
 * Reels on the central intake (Phase 2, planning/Central Intake/PHASE2-CONTRACT.md, Owner B).
 *
 * In intake mode a Reels idea id IS its intake story id. Reels writes no `reels.sources` / `post_idea_members`
 * rows; it upserts one registry row in `reels.post_ideas` per intake story it uses (Reels' own per-night state:
 * first_seen, last_joined, timely) so idea_scores, idea_copy and the other per-idea tables keep their foreign keys.
 * Content (headline, body, members) comes from the intake (`reels.idea_sources_v` for readers).
 *
 * CLAUDE.md Rule 2: nothing here scores. Registration is an upsert of the order's already-scored stories; scores
 * are read from `intake.scores` by id. The only Jev on an intake night is the legacy scoring of a legacy carryover.
 */
import { membersOf } from '@/lib/intake/scorecards';
import type { IntakeQuery, IntakeRunRecord, ListStoriesInput, OrderId, ScoredStory } from '@/lib/intake/types';
import type { PoolSource } from '@/lib/reels/repository';
import { REEL_SCHEDULE } from '@/lib/reels/spine-tables';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import type { IntakeScoreSource, StoredIntakeScore } from '@/lib/reels/pipeline/scoring';
import type { Bucket, SourceType } from '@/lib/reels/types';

/** The 'reels' order's lookback (lib/intake/orders.ts): stories older than this are not Reels ideas. */
export const REELS_LOOKBACK_DAYS = 14;
/**
 * The intake's 12:00 AM main run fetches what Reels' 1:00 AM night used to fetch itself. A sighting in that run
 * counts as tonight's (D-059 parity): the timely window opens at the main run's start when it began at most this
 * many hours before the Reels run.
 */
export const TONIGHT_WINDOW_HOURS = 12;

const DAY = 86_400_000;

export type ConsumerModeReading = 'intake' | 'legacy' | 'stale-fallback';

/** Owner A's read helpers and deposit run (lib/intake/read.ts, lib/intake/run.ts), injected so tests stub them. */
export type ListOrderStories = (
  q: IntakeQuery,
  order: OrderId,
  input: Omit<ListStoriesInput, 'families'>,
) => Promise<ScoredStory[]>;
export type ResolveStoryId = (q: IntakeQuery, id: string) => Promise<string | null>;
export type RunIntakeDeposit = (q: IntakeQuery) => Promise<{ runId: string; record: IntakeRunRecord }>;

export type IntakeRunDeps = {
  query: IntakeQuery;
  readMode: (q: IntakeQuery, order: OrderId, now: Date) => Promise<ConsumerModeReading>;
  listOrderStories: ListOrderStories;
  resolveStoryId: ResolveStoryId;
  runIntakeDeposit: RunIntakeDeposit;
  /** Start of the newest successful main intake run (lib/intake/read.ts lastSuccessfulMainStart), or null. */
  lastMainStart: (q: IntakeQuery) => Promise<Date | null>;
};

/** The app's database as an IntakeQuery (the same adapter lib/intake/deposit.ts uses). */
export const liveIntakeQuery: IntakeQuery = {
  async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
    const { dbQuery } = await import('@/lib/db');
    return { rows: (await dbQuery(text, params)).rows as T[] };
  },
};

/** Live deps with any test overrides on top. */
export function intakeRunDeps(overrides: Partial<IntakeRunDeps> = {}): IntakeRunDeps {
  return {
    query: liveIntakeQuery,
    readMode: async (q, order, now) => {
      const { readConsumerMode } = await import('@/lib/intake/read');
      return readConsumerMode(q, order, now);
    },
    listOrderStories: async (q, order, input) => (await import('@/lib/intake/read')).listOrderStories(q, order, input),
    resolveStoryId: async (q, id) => (await import('@/lib/intake/read')).resolveStoryId(q, id),
    // Its own live deps (open orders, scorecards, a Jev capped at INTAKE_DEPOSIT_CAP_USD); never throws.
    runIntakeDeposit: async (q) => (await import('@/lib/intake/run')).runIntakeDeposit(q),
    lastMainStart: async (q) => {
      // Owner A's lastSuccessfulMainStart when it exists; lastRuns().main is the same read (newest successful main).
      const read = (await import('@/lib/intake/read')) as typeof import('@/lib/intake/read') & {
        lastSuccessfulMainStart?: (q: IntakeQuery) => Promise<Date | null>;
      };
      return read.lastSuccessfulMainStart ? read.lastSuccessfulMainStart(q) : ((await read.lastRuns(q)).main?.startedAt ?? null);
    },
    ...overrides,
  };
}

/** Kept reels/search members: what the reels-score scorecard reads (lib/intake/scorecards.ts REELS_SCORE). */
export function reelsMembers(story: ScoredStory) {
  return membersOf(story, ['reels', 'search']);
}

/** Whether the newest successful main intake run is tonight's: it started at most TONIGHT_WINDOW_HOURS before the Reels run. */
export function isTonightsMain(runStartedAt: Date, lastMainStart: Date | null): boolean {
  if (!lastMainStart) return false;
  const lead = runStartedAt.getTime() - lastMainStart.getTime();
  return lead >= 0 && lead <= TONIGHT_WINDOW_HOURS * 3_600_000;
}

/** When tonight's timely window opens: tonight's main intake run if it ran shortly before, else the Reels run. */
export function intakeTimelyFrom(runStartedAt: Date, lastMainStart: Date | null): Date {
  return lastMainStart && isTonightsMain(runStartedAt, lastMainStart) ? lastMainStart : runStartedAt;
}

/** The latest sighting of a kept reels/search member (the Phase 1 rule, lib/intake/pool-stories.ts reelsLastSeen). */
export function reelsLastSeenAt(story: ScoredStory): Date | null {
  const members = reelsMembers(story);
  return members.length ? new Date(Math.max(...members.map((m) => m.lastSeenAt.getTime()))) : null;
}

/** Timely (D-059 parity): a kept reels/search member was seen in tonight's window. A seed never is (legacy seeds are not). */
export function isTimely(story: ScoredStory, timelyFrom: Date): boolean {
  if (story.yours) return false;
  return (reelsLastSeenAt(story)?.getTime() ?? -Infinity) >= timelyFrom.getTime();
}

/** The Reels ideas tonight: the order's scored stories that still hold a kept reels/search member. */
export async function listReelsStories(deps: IntakeRunDeps, now: Date): Promise<ScoredStory[]> {
  const stories = await deps.listOrderStories(deps.query, 'reels', {
    since: new Date(now.getTime() - REELS_LOOKBACK_DAYS * DAY),
    needScores: ['reels-score'],
  });
  return stories.filter((story) => story.mergedInto == null && reelsMembers(story).length > 0);
}

/**
 * Upsert one registry row per story (id = intake story id) and set tonight's timely flags. Every other idea goes
 * cold first, as `resetTimelyFlags` does on a legacy night (no legacy idea joins anything on an intake night).
 * Idempotent: a second call with the same stories writes the same rows.
 */
export async function registerIntakeIdeas(
  q: IntakeQuery,
  stories: readonly ScoredStory[],
  timelyFrom: Date,
): Promise<{ created: number; updated: number; timely: number }> {
  await q.query(`UPDATE reels.post_ideas SET timely = false, updated_at = now() WHERE timely`);
  if (stories.length === 0) return { created: 0, updated: 0, timely: 0 };
  const flags = stories.map((story) => isTimely(story, timelyFrom));
  const { rows } = await q.query<{ inserted: boolean }>(
    `INSERT INTO reels.post_ideas (id, first_seen, last_joined, timely)
     SELECT id, first_seen, last_joined, timely
       FROM unnest($1::uuid[], $2::timestamptz[], $3::timestamptz[], $4::boolean[])
            AS t(id, first_seen, last_joined, timely)
     ON CONFLICT (id) DO UPDATE
        SET first_seen = least(reels.post_ideas.first_seen, EXCLUDED.first_seen),
            last_joined = greatest(reels.post_ideas.last_joined, EXCLUDED.last_joined),
            timely = EXCLUDED.timely,
            updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [
      stories.map((story) => story.id),
      stories.map((story) => story.firstSeenAt.toISOString()),
      stories.map((story) => story.lastJoinedAt.toISOString()),
      flags,
    ],
  );
  const created = rows.filter((row) => row.inserted).length;
  return { created, updated: rows.length - created, timely: flags.filter(Boolean).length };
}

/** One registry row for one story (a seed, or a resolved survivor the night did not list). Never changes timely. */
export async function ensureRegistered(q: IntakeQuery, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await q.query(
    `INSERT INTO reels.post_ideas (id, first_seen, last_joined, timely)
     SELECT s.id, s.first_seen_at, s.last_joined_at, false
       FROM intake.stories s
      WHERE s.id = ANY($1::uuid[])
     ON CONFLICT (id) DO NOTHING`,
    [[...ids]],
  );
}

function parseScore(result: unknown): InterpretedScore | null {
  const value = typeof result === 'string' ? (JSON.parse(result) as unknown) : result;
  if (!value || typeof value !== 'object') return null;
  const row = value as { kind?: unknown; score?: unknown };
  return row.kind === 'reels-score' && row.score && typeof row.score === 'object' ? (row.score as InterpretedScore) : null;
}

/** The stored reels-score of these ids, for the ids that are intake stories (a bounded read by id, never a scan). */
export async function readStoredReelsScores(
  q: IntakeQuery,
  ids: readonly string[],
): Promise<Map<string, StoredIntakeScore>> {
  const out = new Map<string, StoredIntakeScore>();
  if (ids.length === 0) return out;
  const { rows } = await q.query<{ id: string; result: unknown; last_joined: Date | string | null; story_joined: Date | string }>(
    `SELECT s.id::text AS id, c.result, i.last_joined, s.last_joined_at AS story_joined
       FROM intake.stories s
       LEFT JOIN intake.scores c ON c.story_id = s.id AND c.scorecard = 'reels-score'
       LEFT JOIN reels.post_ideas i ON i.id = s.id
      WHERE s.id = ANY($1::uuid[])`,
    [[...ids]],
  );
  const unregistered: string[] = [];
  for (const row of rows) {
    const score = parseScore(row.result);
    if (score && row.last_joined == null) unregistered.push(row.id);
    out.set(row.id, { score, lastJoinedMs: new Date(row.last_joined ?? row.story_joined).getTime() });
  }
  // idea_scores needs the registry row (FK): a scored survivor the night did not list gets one, not timely.
  await ensureRegistered(q, unregistered);
  return out;
}

/** The live IntakeScoreSource for scoreRun. */
export function intakeScoreSource(deps: Pick<IntakeRunDeps, 'query' | 'resolveStoryId'>): IntakeScoreSource {
  return {
    async resolve(ids) {
      const out = new Map<string, string>();
      for (const id of new Set(ids)) {
        const survivor = await deps.resolveStoryId(deps.query, id);
        if (survivor && survivor !== id) out.set(id, survivor);
      }
      return out;
    },
    storedScores: (ids) => readStoredReelsScores(deps.query, ids),
    twins: (legacyIds, intakeIds) => readSwitchTwins(deps.query, legacyIds, intakeIds),
    made: (ids) => readMadeIdeas(deps.query, ids),
  };
}

/** Legacy ideas and intake stories that share a member URL (bounded: both sides filtered by id). */
export async function readSwitchTwins(
  q: IntakeQuery,
  legacyIds: readonly string[],
  intakeIds: readonly string[],
): Promise<Array<{ legacy: string; intake: string }>> {
  if (legacyIds.length === 0 || intakeIds.length === 0) return [];
  const { rows } = await q.query<{ legacy: string; intake: string }>(
    `SELECT DISTINCT l.post_idea_id::text AS legacy, i.post_idea_id::text AS intake
       FROM reels.idea_sources_v l
       JOIN reels.idea_sources_v i ON i.url = l.url
      WHERE l.origin = 'legacy' AND i.origin = 'intake'
        AND l.post_idea_id = ANY($1::uuid[]) AND i.post_idea_id = ANY($2::uuid[])
        AND l.post_idea_id <> i.post_idea_id
      ORDER BY 1, 2`,
    [[...legacyIds], [...intakeIds]],
  );
  return rows;
}

/** The ids with copy, a live or finished video job, or a schedule row that is not cancelled or failed. */
export async function readMadeIdeas(q: IntakeQuery, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await q.query<{ id: string }>(
    `SELECT t.id::text AS id
       FROM unnest($1::uuid[]) AS t(id)
      WHERE EXISTS (SELECT 1 FROM reels.idea_copy c WHERE c.post_idea_id = t.id)
         OR EXISTS (SELECT 1 FROM reels.video_jobs v WHERE v.post_idea_id = t.id AND v.status <> 'failed')
         OR EXISTS (SELECT 1 FROM ${REEL_SCHEDULE} s WHERE s.post_idea_id = t.id AND s.status IN ('scheduled', 'publishing', 'published'))`,
    [[...ids]],
  );
  return new Set(rows.map((row) => row.id));
}

/** Tonight's kept reels items as the PoolSource rows A4's news peg and B6's "tonight" list read (repository.setIntakeTonight). */
export function tonightSources(stories: readonly ScoredStory[], timelyFrom: Date): PoolSource[] {
  const out: PoolSource[] = [];
  const seen = new Set<string>();
  for (const story of stories) {
    for (const member of reelsMembers(story)) {
      if (member.lastSeenAt.getTime() < timelyFrom.getTime() || seen.has(member.key)) continue;
      seen.add(member.key);
      out.push({
        id: member.key,
        canonical_url: member.url,
        headline: member.headline,
        body: member.body,
        source_name: member.sourceName,
        source_type: (member.sourceType === 'feed' || member.sourceType === 'seed' ? 'A1' : member.sourceType) as SourceType,
        adapter_id: member.reelsSourceId ?? member.sourceId,
        bucket: 'A' as Bucket,
        publish_time: member.publishTime?.toISOString() ?? null,
        ingest_time: member.firstSeenAt.toISOString(),
        engagement: (member.engagement ?? {}) as PoolSource['engagement'],
        drop_reason: null,
        post_idea_id: story.id,
      });
    }
  }
  return out;
}
