/**
 * Score cache (Owner B). Runs every scorecard an open order names, on ONLY
 * the stories handed in (CLAUDE.md Rule 2: the caller passes the stories a new
 * item joined this run, or one seed; nothing here reads the store to find
 * stories). A (story, scorecard) pair is skipped when intake.scores already
 * holds the same scorecard version AND the same member hash; otherwise it is
 * scored and upserted.
 */
import { createHash } from 'node:crypto';

import { mapPool } from '@/lib/async-pool';

import { IntakeCapReached } from './jev';
import { keptFamilies, membersOf } from './scorecards';
import type { IntakeItem, IntakeJev, IntakeOrder, IntakeQuery, IntakeStory, Scorecard, ScorecardId } from './types';

export const SCORE_CONCURRENCY = 8;

export type ScoringTally = Record<ScorecardId, { scored: number; cached: number; usd: number }>;

export type ScoreOptions = {
  log?: (line: string) => void;
  /** Called once when the Jev's cap error stops scoring (the run records stopReason 'cap'). */
  onCapReached?: () => void;
  /** Filled with the ids of stories that still had a (story, scorecard) pair to score when the cap stopped scoring. */
  unscored?: Set<string>;
  /** Filled with per-scorecard counts of pairs that failed with a non-cap error (fix 11: the run record shows them). */
  failures?: Partial<Record<ScorecardId, number>>;
};

const emptyTally = (): ScoringTally => ({
  'reels-screen': { scored: 0, cached: 0, usd: 0 },
  'reels-score': { scored: 0, cached: 0, usd: 0 },
  'story-scoring': { scored: 0, cached: 0, usd: 0 },
  'major-news': { scored: 0, cached: 0, usd: 0 },
  'story-builder': { scored: 0, cached: 0, usd: 0 },
});

/** sha1 of the sorted member keys (the cache key's member part). */
export function memberHash(members: readonly Pick<IntakeItem, 'key'>[]): string {
  return createHash('sha1').update([...members.map((m) => m.key)].sort().join('\n')).digest('hex');
}

type CoverItem = Pick<IntakeItem, 'family' | 'sourceId'> &
  Partial<Pick<IntakeItem, 'dropReason' | 'feedSlug' | 'feedDropReason' | 'reelsSourceId' | 'reelsDropReason'>>;

/**
 * Whether an order's sources cover an item, through any list that keeps it (fix 1: a URL can be on a reels adapter
 * and a feed): `'reels:*'` covers reels adapters and Claude web search finds (family 'search'); `'feeds:*'` covers
 * every feed; an explicit id covers that source; a seed is covered by its own order.
 */
export function orderCovers(order: Pick<IntakeOrder, 'id' | 'sources'>, item: CoverItem): boolean {
  const kept = keptFamilies({ ...item, dropReason: item.dropReason ?? null });
  return kept.some((family) => {
    if (family === 'seed') return item.sourceId === `seed:${order.id}`;
    if (family === 'feeds') {
      const id = item.feedSlug ? `feed:${item.feedSlug}` : item.sourceId;
      return order.sources.includes(id) || order.sources.includes('feeds:*');
    }
    const id = family === 'reels' ? item.reelsSourceId ?? item.sourceId : item.sourceId;
    return order.sources.includes(id) || order.sources.includes('reels:*');
  });
}

/** The scorecards the open orders want for this story (an order counts when it covers at least one kept member). */
export function wantedScorecards(story: IntakeStory, openOrders: readonly IntakeOrder[]): Set<ScorecardId> {
  const out = new Set<ScorecardId>();
  for (const o of openOrders) {
    if (story.members.some((m) => orderCovers(o, m))) for (const s of o.scorecards) out.add(s);
  }
  return out;
}

/** The Jev's cap error (lib/intake/jev.ts IntakeCapReached; matched by name too, for stubs). */
export function isCapReached(err: unknown): boolean {
  if (err instanceof IntakeCapReached) return true;
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; constructor?: { name?: unknown } };
  return e.name === 'IntakeCapReached' || e.constructor?.name === 'IntakeCapReached';
}

type Task = { story: IntakeStory; card: Scorecard; hash: string };

/**
 * Score the handed-in stories with every scorecard an open order names.
 * `orders` are the orders open this run (openOrders()). Up to 8 at once. On the
 * cap error, in-flight work finishes, nothing new starts, and the tally so far
 * is returned. Any other per-pair error is logged and that pair is left unscored.
 */
export async function scoreForStories(
  q: IntakeQuery,
  jev: IntakeJev,
  stories: readonly IntakeStory[],
  orders: readonly IntakeOrder[],
  scorecards: readonly Scorecard[],
  opts: ScoreOptions = {},
): Promise<ScoringTally> {
  const tally = emptyTally();
  if (stories.length === 0 || orders.length === 0) return tally;

  const tasks: Task[] = [];
  for (const story of stories) {
    const wanted = wantedScorecards(story, orders);
    for (const card of scorecards) {
      if (!wanted.has(card.id)) continue;
      const members = membersOf(story, card.families);
      if (members.length === 0) continue; // no row for an empty family subset
      tasks.push({ story, card, hash: memberHash(members) });
    }
  }
  if (tasks.length === 0) return tally;

  // The cached rows for the handed-in stories only.
  const ids = [...new Set(tasks.map((t) => t.story.id))];
  const { rows } = await q.query<{ story_id: string; scorecard: string; version: string; member_hash: string }>(
    `SELECT story_id::text AS story_id, scorecard, version, member_hash FROM intake.scores WHERE story_id = ANY($1::uuid[])`,
    [ids],
  );
  const cached = new Set(rows.map((r) => `${r.story_id}|${r.scorecard}|${r.version}|${r.member_hash}`));

  const todo: Task[] = [];
  for (const t of tasks) {
    if (cached.has(`${t.story.id}|${t.card.id}|${t.card.version}|${t.hash}`)) tally[t.card.id].cached += 1;
    else todo.push(t);
  }

  let capped = false;
  await mapPool(todo, SCORE_CONCURRENCY, async (t) => {
    if (capped) {
      opts.unscored?.add(t.story.id);
      return;
    }
    try {
      const out = await t.card.score(t.story, jev);
      await upsertScore(q, t, out);
      tally[t.card.id].scored += 1;
      tally[t.card.id].usd += out.usd;
    } catch (err) {
      if (isCapReached(err)) {
        opts.unscored?.add(t.story.id);
        if (!capped) {
          capped = true;
          opts.log?.(`intake scoring: cap reached; ${t.card.id} on ${t.story.id} not scored, nothing new starts`);
          opts.onCapReached?.();
        }
        return;
      }
      if (opts.failures) opts.failures[t.card.id] = (opts.failures[t.card.id] ?? 0) + 1;
      opts.log?.(`intake scoring: ${t.card.id} on ${t.story.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return tally;
}

/**
 * A reels-score result carries `best_net` / `best_blockbuster`: the greatest over every re-score of the story (the
 * LFD reels lane ranks by the best, as legacy did across nights); `score` stays the latest (Stories read it).
 */
export function withBest(result: Awaited<ReturnType<Scorecard['score']>>['result']): typeof result {
  if (result.kind !== 'reels-score') return result;
  const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return { ...result, best_net: num(result.score.net), best_blockbuster: num(result.score.blockbuster) };
}

async function upsertScore(q: IntakeQuery, t: Task, out: Awaited<ReturnType<Scorecard['score']>>): Promise<void> {
  // One row per (story, scorecard): the latest version and member set replace the old row; a reels-score keeps the
  // best net / blockbuster any earlier score reached (GREATEST ignores nulls).
  await q.query(
    `INSERT INTO intake.scores (story_id, scorecard, version, member_hash, answers, result, usd, scored_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, now())
     ON CONFLICT (story_id, scorecard) DO UPDATE SET version = EXCLUDED.version, member_hash = EXCLUDED.member_hash,
       answers = EXCLUDED.answers, usd = EXCLUDED.usd, scored_at = EXCLUDED.scored_at,
       result = CASE WHEN EXCLUDED.scorecard = 'reels-score' THEN EXCLUDED.result || jsonb_build_object(
           'best_net', GREATEST((intake.scores.result->>'best_net')::float8, (intake.scores.result->'score'->>'net')::float8, (EXCLUDED.result->>'best_net')::float8),
           'best_blockbuster', GREATEST((intake.scores.result->>'best_blockbuster')::float8, (intake.scores.result->'score'->>'blockbuster')::float8, (EXCLUDED.result->>'best_blockbuster')::float8))
         ELSE EXCLUDED.result END`,
    [t.story.id, t.card.id, t.card.version, t.hash, JSON.stringify(out.answers), JSON.stringify(withBest(out.result)), out.usd],
  );
}
