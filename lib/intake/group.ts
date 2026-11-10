/**
 * grouping-v2 (lib/reels/pipeline/grouping.ts) on the intake's own tables.
 *
 * The algorithm is unchanged: candidates are the headline shortlist (the
 * pg_trgm `greatest(similarity, word_similarity both ways)` measure, here as
 * a pure function so PGlite needs no extension) plus content candidates
 * (buildMatchPool / nearestSources over the 72 h pool); every candidate is
 * judged with the GROUPING set and `resolveAction`, the strongest acceptable
 * one wins, a story holds at most GROUP_SIZE_CAP distinct angles, and an
 * idea-merge pass (IDEA_MERGE set, `resolveIdeaMerge`) fuses stories about
 * one event. Pair decisions are cached in `intake.pair_decisions` by sorted
 * URL pair and never re-asked.
 *
 * Rule 2: only items new to the store and still ungrouped (inside the 72 h
 * pool) are placed, and the idea merge only considers pairs that include a
 * story touched in this run. Nothing iterates the store.
 */
import {
  GROUP_SIZE_CAP,
  IDEA_MERGE_EXCERPT_CHARS,
  IDEA_MERGE_MAX_PAIRS,
  IDEA_MERGE_PASSES,
  IDEA_MERGE_SIMILARITY_FLOOR,
  REFERENCE_POOL_HOURS,
  SHORTLIST_LIMIT,
  SHORTLIST_SIMILARITY_FLOOR,
} from '@/lib/reels/config';
import { buildMatchPool, contentIdeaPairs, nearestSources, type MatchPool } from '@/lib/reels/grouping/content-candidates';
import { storyTerms } from '@/lib/reels/grouping/story-terms';
import { GROUPING } from '@/lib/reels/jev/questions/grouping';
import { IDEA_MERGE } from '@/lib/reels/jev/questions/idea-merge';
import type { JevRunner } from '@/lib/reels/jev/runner';
import { excerpt } from '@/lib/reels/jev/state';
import { resolveAction, resolveIdeaMerge, storedAction } from '@/lib/reels/pipeline/grouping';
import type { GroupingAction } from '@/lib/reels/types';

import { isIntakeCapReached } from './jev';
import type { IntakeQuery, IntakeRunRecord } from './types';

/* ── pg_trgm, as pure functions ───────────────────────────────────────── */

export type Trigrams = { list: string[]; set: Set<string> };

/** pg_trgm's trigrams: lower-cased alphanumeric words, each padded with two spaces before and one after. */
export function trigrams(text: string): Trigrams {
  const list: string[] = [];
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) list.push(padded.slice(i, i + 3));
  }
  return { list, set: new Set(list) };
}

function shared(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const t of a) if (b.has(t)) count += 1;
  return count;
}

/** pg_trgm `similarity(a, b)`: shared trigrams over the union. */
export function trigramSimilarity(a: Trigrams, b: Trigrams): number {
  const count = shared(a.set, b.set);
  const union = a.set.size + b.set.size - count;
  return union === 0 ? 0 : count / union;
}

/**
 * pg_trgm `word_similarity(a, b)`: the best similarity between a's trigram set
 * and any continuous extent of b's ordered trigrams.
 */
export function wordSimilarity(a: Trigrams, b: Trigrams): number {
  if (a.set.size === 0) return 0;
  const positions: number[] = [];
  for (let i = 0; i < b.list.length; i += 1) if (a.set.has(b.list[i])) positions.push(i);
  if (positions.length === 0) return 0;
  let best = 0;
  for (const start of positions) {
    const extent = new Set<string>();
    let found = 0;
    for (let i = start; i < b.list.length; i += 1) {
      const t = b.list[i];
      if (!extent.has(t)) {
        extent.add(t);
        if (a.set.has(t)) found += 1;
      }
      if (a.set.has(t)) best = Math.max(best, found / (a.set.size + extent.size - found));
    }
  }
  return best;
}

/** The reels shortlist measure: greatest(similarity, word_similarity(a, b), word_similarity(b, a)). */
export function headlineSimilarity(a: Trigrams, b: Trigrams): number {
  return Math.max(trigramSimilarity(a, b), wordSimilarity(a, b), wordSimilarity(b, a));
}

/** Cheap upper bound of headlineSimilarity, to skip the extent search for pairs that cannot clear a floor. */
function similarityBound(a: Trigrams, b: Trigrams): number {
  const count = shared(a.set, b.set);
  if (count === 0) return 0;
  return Math.max(count / Math.max(1, a.set.size), count / Math.max(1, b.set.size));
}

/* ── pool ─────────────────────────────────────────────────────────────── */

type PoolRow = {
  key: string;
  headline: string;
  body: string;
  source_name: string;
  source_type: string;
  publish_time: Date | string | null;
  story_id: string | null;
  first_seen_at: Date | string;
  trg: Trigrams;
};

export type GroupingResult = IntakeRunRecord['grouping'] & {
  /** Stories created or joined in this run: the only ones scored (Rule 2). */
  touched: Set<string>;
  failures: string[];
  /** The cap refused a pair call: from then on only cached decisions were used (fix 3). */
  capped?: boolean;
};

export type GroupOptions = {
  /**
   * The run's cap is already spent (fix 3): place items with cached pair decisions only, 0 pair calls; an item with
   * no cached match gets its own story (its key alone). Also switched on when the cap refuses a call mid-grouping.
   */
  noAsk?: boolean;
};

type Ctx = {
  q: IntakeQuery;
  jev: JevRunner;
  runId: string;
  now: Date;
  rows: Map<string, PoolRow>;
  pool: MatchPool;
  summary: GroupingResult;
  placed: Set<string>;
  noAsk: boolean;
};

async function loadPool(q: IntakeQuery, now: Date): Promise<PoolRow[]> {
  const cutoff = new Date(now.getTime() - REFERENCE_POOL_HOURS * 3_600_000);
  const { rows } = await q.query<Omit<PoolRow, 'trg'>>(
    `SELECT i.key, i.headline, left(i.body, 4000) AS body, i.source_name, i.source_type,
            i.publish_time, i.story_id::text AS story_id, i.first_seen_at
       FROM intake.items i
       LEFT JOIN intake.stories s ON s.id = i.story_id
      WHERE i.drop_reason IS NULL
        AND i.first_seen_at > $1
        AND (i.story_id IS NULL OR (s.merged_into IS NULL AND s.last_joined_at > $1))
      ORDER BY i.first_seen_at, i.key`,
    [cutoff],
  );
  return rows.map((row) => ({ ...row, trg: trigrams(row.headline) }));
}

function orderPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

type StoredDecision = { action: GroupingAction; same_event_p: number | null; confidence: number | null };

async function findDecision(q: IntakeQuery, a: string, b: string): Promise<StoredDecision | null> {
  const [left, right] = orderPair(a, b);
  const { rows } = await q.query<StoredDecision>(
    `SELECT action, same_event_p, confidence FROM intake.pair_decisions WHERE left_key = $1 AND right_key = $2`,
    [left, right],
  );
  return rows[0] ?? null;
}

async function recordDecision(
  q: IntakeQuery,
  input: { a: string; b: string; action: GroupingAction; sameEventP: number | null; confidence: number | null; runId: string },
): Promise<void> {
  const [left, right] = orderPair(input.a, input.b);
  if (left === right) return;
  await q.query(
    `INSERT INTO intake.pair_decisions (left_key, right_key, action, same_event_p, confidence, run_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (left_key, right_key) DO UPDATE
        SET action = EXCLUDED.action, same_event_p = EXCLUDED.same_event_p,
            confidence = EXCLUDED.confidence, run_id = EXCLUDED.run_id, decided_at = now()`,
    [left, right, input.action, input.sameEventP, input.confidence, input.runId],
  );
}

async function createStory(ctx: Ctx, primary: PoolRow): Promise<string> {
  const { rows } = await ctx.q.query<{ id: string }>(
    `INSERT INTO intake.stories (representative_key, headline, first_seen_at, last_joined_at, created_run_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
    [primary.key, primary.headline, new Date(primary.first_seen_at), ctx.now, ctx.runId],
  );
  const id = rows[0].id;
  await ctx.q.query(`UPDATE intake.items SET story_id = $2, role = 'primary', joined_at = $3 WHERE key = $1`, [primary.key, id, ctx.now]);
  primary.story_id = id;
  ctx.summary.created += 1;
  ctx.summary.touched.add(id);
  ctx.placed.add(primary.key);
  return id;
}

async function countCappedMembers(q: IntakeQuery, storyId: string): Promise<number> {
  const { rows } = await q.query<{ count: string | number }>(
    `SELECT count(*) AS count FROM intake.items WHERE story_id = $1 AND role <> 'merged_duplicate'`,
    [storyId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function attach(ctx: Ctx, candidate: PoolRow, item: PoolRow, role: 'supporting' | 'merged_duplicate'): Promise<boolean> {
  // The match is another item from tonight that nothing has placed yet: it becomes the primary.
  const storyId = candidate.story_id ?? (await createStory(ctx, candidate));
  if (role === 'supporting' && (await countCappedMembers(ctx.q, storyId)) >= GROUP_SIZE_CAP) return false;
  await ctx.q.query(`UPDATE intake.items SET story_id = $2, role = $3, joined_at = $4 WHERE key = $1`, [item.key, storyId, role, ctx.now]);
  await ctx.q.query(`UPDATE intake.stories SET last_joined_at = $2 WHERE id = $1`, [storyId, ctx.now]);
  item.story_id = storyId;
  ctx.summary.touched.add(storyId);
  return true;
}

const published = (row: PoolRow) => (row.publish_time ? new Date(row.publish_time).toISOString() : null);

async function decide(ctx: Ctx, item: PoolRow, candidate: PoolRow): Promise<{ action: GroupingAction; strength: number }> {
  const stored = await findDecision(ctx.q, item.key, candidate.key);
  if (stored) {
    ctx.summary.cacheHits += 1;
    return { action: storedAction(stored), strength: stored.same_event_p ?? 0 };
  }
  if (ctx.noAsk) return { action: 'leave', strength: 0 };
  let answers: Awaited<ReturnType<typeof askGrouping>>;
  try {
    answers = await askGrouping(ctx, item, candidate);
  } catch (error) {
    if (!isIntakeCapReached(error)) throw error;
    capReached(ctx);
    return { action: 'leave', strength: 0 };
  }
  ctx.summary.pairCalls += 1;
  const action = resolveAction(answers.sameEvent.noul, answers.relationship);
  await recordDecision(ctx.q, {
    a: item.key,
    b: candidate.key,
    action,
    sameEventP: answers.sameEvent.noul,
    confidence: answers.relationship.confidence,
    runId: ctx.runId,
  });
  return { action, strength: answers.sameEvent.noul };
}

/** The cap refused a call: no more asking this run; cached decisions still place items. */
function capReached(ctx: Ctx): void {
  ctx.noAsk = true;
  ctx.summary.capped = true;
}

async function askGrouping(ctx: Ctx, item: PoolRow, candidate: PoolRow) {
  const { answers } = await ctx.jev.ask({
    component: 'grouping',
    state: {
      item_a: { headline: item.headline, source: item.source_name, source_type: item.source_type, published: published(item), untrusted_content: excerpt(item.body) },
      item_b: { headline: candidate.headline, source: candidate.source_name, source_type: candidate.source_type, published: published(candidate), untrusted_content: excerpt(candidate.body) },
    },
    sets: [GROUPING],
    questions: GROUPING.questions,
    runId: ctx.runId,
  });
  return answers;
}

/** The headline shortlist plus content candidates, each item once (unionCandidates' order). */
export function candidatesFor(
  item: { key: string; headline: string; body: string; trg?: Trigrams },
  rows: Iterable<{ key: string; trg: Trigrams }>,
  pool: MatchPool | null,
): string[] {
  const trg = item.trg ?? trigrams(item.headline);
  const headline: Array<{ key: string; similarity: number }> = [];
  for (const row of rows) {
    if (row.key === item.key) continue;
    if (similarityBound(trg, row.trg) <= SHORTLIST_SIMILARITY_FLOOR) continue;
    const similarity = headlineSimilarity(row.trg, trg);
    if (similarity > SHORTLIST_SIMILARITY_FLOOR) headline.push({ key: row.key, similarity });
  }
  headline.sort((a, b) => b.similarity - a.similarity || a.key.localeCompare(b.key));
  const content = pool ? nearestSources(pool, storyTerms(item.headline, item.body), item.key).map((n) => n.sourceId) : [];
  return [...new Set([...headline.slice(0, SHORTLIST_LIMIT).map((h) => h.key), ...content])];
}

async function placeItem(ctx: Ctx, item: PoolRow): Promise<void> {
  let best: { candidate: PoolRow; action: GroupingAction; strength: number } | null = null;
  for (const key of candidatesFor(item, ctx.rows.values(), ctx.pool)) {
    const candidate = ctx.rows.get(key);
    if (!candidate) continue;
    // Two of tonight's items already in one story need no second look.
    if (candidate.story_id && candidate.story_id === item.story_id) continue;
    const verdict = await decide(ctx, item, candidate);
    if (verdict.action === 'leave') continue;
    if (!best || verdict.strength > best.strength) best = { candidate, ...verdict };
  }

  if (best) {
    const role = best.action === 'merge' ? 'merged_duplicate' : 'supporting';
    if (await attach(ctx, best.candidate, item, role)) {
      ctx.summary.joined += 1;
      ctx.placed.add(item.key);
      return;
    }
  }
  await createStory(ctx, item);
}

/* ── idea merge ───────────────────────────────────────────────────────── */

type StorySummary = { id: string; primary_key: string | null; member_count: number; headlines: string[]; excerpt: string | null };

async function summarizeStory(q: IntakeQuery, id: string): Promise<StorySummary | null> {
  const { rows } = await q.query<{ key: string; headline: string; body: string; merged_into: string | null }>(
    `SELECT i.key, i.headline, i.body, s.merged_into::text AS merged_into
       FROM intake.stories s
       JOIN intake.items i ON i.story_id = s.id
      WHERE s.id = $1
      ORDER BY CASE i.role WHEN 'primary' THEN 0 ELSE 1 END, i.joined_at, i.key`,
    [id],
  );
  if (rows.length === 0 || rows[0].merged_into) return null;
  return { id, primary_key: rows[0].key, member_count: rows.length, headlines: rows.map((r) => r.headline), excerpt: rows[0].body };
}

function membership(rows: Iterable<PoolRow>): Map<string, PoolRow[]> {
  const out = new Map<string, PoolRow[]>();
  for (const row of rows) if (row.story_id) out.set(row.story_id, [...(out.get(row.story_id) ?? []), row]);
  return out;
}

/** Story pairs worth asking about: headline pairs across members plus content pairs, each including a touched story. */
export function ideaMergeCandidates(
  members: ReadonlyMap<string, ReadonlyArray<{ key: string; trg: Trigrams }>>,
  pool: MatchPool | null,
  touched: ReadonlySet<string>,
): Array<{ left: string; right: string }> {
  const ids = [...members.keys()].sort();
  const headline: Array<{ left: string; right: string; similarity: number }> = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (!touched.has(ids[i]) && !touched.has(ids[j])) continue;
      let best = 0;
      for (const a of members.get(ids[i]) ?? []) {
        for (const b of members.get(ids[j]) ?? []) {
          if (similarityBound(a.trg, b.trg) <= Math.max(best, IDEA_MERGE_SIMILARITY_FLOOR)) continue;
          best = Math.max(best, headlineSimilarity(a.trg, b.trg));
        }
      }
      if (best > IDEA_MERGE_SIMILARITY_FLOOR) headline.push({ left: ids[i], right: ids[j], similarity: best });
    }
  }
  headline.sort((a, b) => b.similarity - a.similarity);

  const content = pool
    ? contentIdeaPairs(pool, new Map([...members].map(([id, rows]) => [id, rows.map((r) => r.key)])), Number.MAX_SAFE_INTEGER)
        .filter((p) => touched.has(p.left_id) || touched.has(p.right_id))
        .map((p) => ({ left: p.left_id, right: p.right_id }))
    : [];

  const seen = new Set<string>();
  const out: Array<{ left: string; right: string }> = [];
  for (const pair of [...headline.slice(0, IDEA_MERGE_MAX_PAIRS), ...content.slice(0, IDEA_MERGE_MAX_PAIRS)]) {
    const [left, right] = orderPair(pair.left, pair.right);
    if (seen.has(`${left}|${right}`)) continue;
    seen.add(`${left}|${right}`);
    out.push({ left, right });
  }
  return out;
}

async function askIdeaMerge(ctx: Ctx, left: StorySummary, right: StorySummary): Promise<boolean> {
  const { answers } = await ctx.jev.ask({
    component: 'idea-merge',
    state: {
      group_a: { headlines: left.headlines, untrusted_content: excerpt(left.excerpt ?? '', IDEA_MERGE_EXCERPT_CHARS) },
      group_b: { headlines: right.headlines, untrusted_content: excerpt(right.excerpt ?? '', IDEA_MERGE_EXCERPT_CHARS) },
    },
    sets: [IDEA_MERGE],
    questions: IDEA_MERGE.questions,
    runId: ctx.runId,
  });
  ctx.summary.pairCalls += 1;
  const merge = resolveIdeaMerge(answers.sameEvent.noul, answers.action);
  await recordDecision(ctx.q, {
    a: left.primary_key as string,
    b: right.primary_key as string,
    action: merge ? 'merge' : 'leave',
    sameEventP: answers.sameEvent.noul,
    confidence: answers.action.confidence,
    runId: ctx.runId,
  });
  return merge;
}

/** Fuse `absorbed` into `target` (reels mergeIdeas): its primary becomes supporting, past the cap folds into duplicates. */
async function mergeStories(ctx: Ctx, targetId: string, absorbedId: string): Promise<void> {
  const { q } = ctx;
  await q.query(
    `UPDATE intake.items SET story_id = $1, role = CASE WHEN role = 'primary' THEN 'supporting' ELSE role END
      WHERE story_id = $2`,
    [targetId, absorbedId],
  );
  await q.query(
    `WITH ranked AS (
       SELECT key, row_number() OVER (ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, joined_at, key) AS position
         FROM intake.items WHERE story_id = $1 AND role <> 'merged_duplicate')
     UPDATE intake.items i SET role = 'merged_duplicate' FROM ranked
      WHERE i.key = ranked.key AND ranked.position > $2`,
    [targetId, GROUP_SIZE_CAP],
  );
  await q.query(
    `UPDATE intake.stories t
        SET last_joined_at = greatest(t.last_joined_at, a.last_joined_at),
            first_seen_at = least(t.first_seen_at, a.first_seen_at)
       FROM intake.stories a
      WHERE t.id = $1 AND a.id = $2`,
    [targetId, absorbedId],
  );
  await q.query(`UPDATE intake.stories SET merged_into = $1 WHERE id = $2`, [targetId, absorbedId]);
  for (const row of ctx.rows.values()) if (row.story_id === absorbedId) row.story_id = targetId;
  ctx.summary.touched.delete(absorbedId);
  ctx.summary.touched.add(targetId);
}

async function mergeSameEventStories(ctx: Ctx): Promise<void> {
  for (let pass = 0; pass < IDEA_MERGE_PASSES; pass += 1) {
    const pairs = ideaMergeCandidates(membership(ctx.rows.values()), ctx.pool, ctx.summary.touched);
    let mergedThisPass = 0;
    for (const pair of pairs) {
      try {
        const [left, right] = await Promise.all([summarizeStory(ctx.q, pair.left), summarizeStory(ctx.q, pair.right)]);
        // A merge earlier in this pass may have already absorbed one of them.
        if (!left || !right || !left.primary_key || !right.primary_key) continue;
        const stored = await findDecision(ctx.q, left.primary_key, right.primary_key);
        if (stored) {
          ctx.summary.cacheHits += 1;
          if (storedAction(stored) === 'leave') continue;
        } else if (ctx.noAsk || !(await askIdeaMerge(ctx, left, right))) {
          continue;
        }
        const [target, absorbed] = left.member_count >= right.member_count ? [left, right] : [right, left];
        await mergeStories(ctx, target.id, absorbed.id);
        ctx.summary.merges += 1;
        mergedThisPass += 1;
      } catch (error) {
        if (isIntakeCapReached(error)) {
          capReached(ctx);
          continue;
        }
        ctx.summary.failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (mergedThisPass === 0) break;
  }
}

/* ── entry ────────────────────────────────────────────────────────────── */

/**
 * Place every new, ungrouped item, then fuse same-event stories. When the
 * cap is spent (before or during), asking stops and only cached pair
 * decisions are used: every item is still placed (its own story when no
 * cached decision matches), with 0 further pair calls (fix 3).
 */
export async function groupIntake(
  q: IntakeQuery,
  jev: JevRunner,
  runId: string,
  now: Date,
  partial?: GroupingResult,
  opts: GroupOptions = {},
): Promise<GroupingResult> {
  const summary: GroupingResult = partial ?? { created: 0, joined: 0, merges: 0, pairCalls: 0, cacheHits: 0, touched: new Set(), failures: [] };
  const poolRows = await loadPool(q, now);
  const rows = new Map(poolRows.map((row) => [row.key, row]));
  let pool: MatchPool | null = null;
  try {
    pool = buildMatchPool(poolRows.map((row) => ({ id: row.key, headline: row.headline, body: row.body })));
  } catch (error) {
    summary.failures.push(`Content pool: ${error instanceof Error ? error.message : String(error)}`);
  }
  const ctx: Ctx = { q, jev, runId, now, rows, pool: pool ?? buildMatchPool([]), summary, placed: new Set(), noAsk: Boolean(opts.noAsk) };
  if (opts.noAsk) summary.capped = true;

  for (const item of poolRows.filter((row) => row.story_id == null)) {
    if (ctx.placed.has(item.key) || item.story_id) continue;
    try {
      await placeItem(ctx, item);
    } catch (error) {
      if (isIntakeCapReached(error)) {
        capReached(ctx);
        continue;
      }
      summary.failures.push(`${item.headline}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await mergeSameEventStories(ctx);
  return summary;
}
