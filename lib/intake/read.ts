/**
 * Pure reads over the intake store (lib/intake/types.ts ListStories,
 * LastRuns, the consumer switch). No scoring, no writes, no Jev.
 */
import type { FieldNotesMember, FieldNotesMeta } from './scorecards';
import { orderCovers } from './score';
import {
  INTAKE_FRESH_HOURS,
  type ConsumerSettings,
  type Family,
  type IntakeItem,
  type IntakeOrder,
  type IntakeQuery,
  type IntakeStory,
  type LastRuns,
  type ListStoriesInput,
  type OrderId,
  type ScoredStory,
  type ScorecardResult,
} from './types';

type ItemRow = {
  key: string;
  family: Family;
  source_id: string;
  source_name: string;
  source_type: string;
  headline: string;
  body: string;
  url: string;
  publish_time: Date | string | null;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  engagement: Record<string, number> | null;
  drop_reason: string | null;
  story_id: string | null;
  role: IntakeItem['role'];
  seeded_by?: string | null;
  feed_slug?: string | null;
  feed_drop_reason?: string | null;
  feed_source_name?: string | null;
  reels_source_id?: string | null;
  reels_drop_reason?: string | null;
  field_notes_source_id?: string | null;
  field_notes_meta?: FieldNotesMeta | string | null;
};

type StoryRow = {
  id: string;
  representative_key: string;
  headline: string;
  first_seen_at: Date | string;
  last_joined_at: Date | string;
  merged_into: string | null;
};

const date = (value: Date | string) => (value instanceof Date ? value : new Date(value));

export function toItem(row: ItemRow): IntakeItem {
  return {
    key: row.key,
    family: row.family,
    sourceId: row.source_id,
    sourceName: row.source_name,
    sourceType: row.source_type as IntakeItem['sourceType'],
    headline: row.headline,
    body: row.body,
    url: row.url,
    publishTime: row.publish_time ? date(row.publish_time) : null,
    firstSeenAt: date(row.first_seen_at),
    lastSeenAt: date(row.last_seen_at),
    engagement: row.engagement ?? null,
    dropReason: row.drop_reason,
    feedSlug: row.feed_slug ?? null,
    feedDropReason: row.feed_drop_reason ?? null,
    feedSourceName: row.feed_source_name ?? null,
    reelsSourceId: row.reels_source_id ?? null,
    reelsDropReason: row.reels_drop_reason ?? null,
    storyId: row.story_id,
    role: row.role,
    // Phase 2 (helper type FieldNotesMember): the Field Notes registry entry id and metadata, when a Field Notes source carries it.
    ...(row.field_notes_source_id != null
      ? {
          fieldNotesSourceId: row.field_notes_source_id,
          fieldNotesMeta: typeof row.field_notes_meta === 'string' ? (JSON.parse(row.field_notes_meta) as FieldNotesMeta) : (row.field_notes_meta ?? null),
        }
      : {}),
  } as FieldNotesMember;
}

const ITEM_COLUMNS = `key, family, source_id, source_name, source_type, headline, body, url, publish_time,
  first_seen_at, last_seen_at, engagement, drop_reason, story_id::text AS story_id, role, seeded_by,
  feed_slug, feed_drop_reason, feed_source_name, reels_source_id, reels_drop_reason, field_notes_source_id, field_notes_meta`;

/**
 * SQL twin of scorecards.ts keptIn: item `m` is a kept member of one of the families in parameter `$n` (fix 1:
 * feeds and reels membership is per list; older rows fall back to family + drop_reason).
 */
export function keptInSql(n: number, m = 'm'): string {
  const fams = `$${n}::text[]`;
  return `(('feeds' = ANY(${fams}) AND CASE WHEN ${m}.feed_slug IS NOT NULL THEN ${m}.feed_drop_reason IS NULL ELSE ${m}.family = 'feeds' AND ${m}.drop_reason IS NULL END)
      OR ('reels' = ANY(${fams}) AND CASE WHEN ${m}.reels_source_id IS NOT NULL THEN ${m}.reels_drop_reason IS NULL ELSE ${m}.family = 'reels' AND ${m}.drop_reason IS NULL END)
      OR (${m}.family IN ('search', 'seed') AND ${m}.family = ANY(${fams}) AND ${m}.drop_reason IS NULL)
      OR ('field-notes' = ANY(${fams}) AND (${m}.field_notes_source_id IS NOT NULL OR ${m}.family = 'field-notes')))`;
}

const STORY_COLUMNS = `id::text AS id, representative_key, headline, first_seen_at, last_joined_at, merged_into::text AS merged_into`;

/** Story id → whether any member is a seed (seeded_by set, or family 'seed'). */
const seededStories = new WeakMap<IntakeStory, boolean>();

async function withMembers(q: IntakeQuery, stories: StoryRow[]): Promise<IntakeStory[]> {
  if (stories.length === 0) return [];
  const { rows } = await q.query<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM intake.items
      WHERE story_id = ANY($1::uuid[])
      ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, joined_at, key`,
    [stories.map((s) => s.id)],
  );
  const members = new Map<string, IntakeItem[]>();
  const seeded = new Set<string>();
  for (const row of rows) {
    members.set(row.story_id as string, [...(members.get(row.story_id as string) ?? []), toItem(row)]);
    if (row.seeded_by || row.family === 'seed') seeded.add(row.story_id as string);
  }
  return stories.map((s) => {
    const story: IntakeStory = {
      id: s.id,
      representativeKey: s.representative_key,
      headline: s.headline,
      firstSeenAt: date(s.first_seen_at),
      lastJoinedAt: date(s.last_joined_at),
      mergedInto: s.merged_into,
      members: members.get(s.id) ?? [],
    };
    seededStories.set(story, seeded.has(s.id));
    return story;
  });
}

/** Stories by id, with members (merged-away ones included only if asked for by id). */
export async function loadStories(q: IntakeQuery, ids: readonly string[]): Promise<IntakeStory[]> {
  if (ids.length === 0) return [];
  const { rows } = await q.query<StoryRow>(
    `SELECT ${STORY_COLUMNS} FROM intake.stories WHERE id = ANY($1::uuid[]) ORDER BY last_joined_at DESC, id`,
    [[...ids]],
  );
  return withMembers(q, rows);
}

/**
 * The story's event date: a 'search' member's publish time (B6 `happened_on`, the event's own date), else the
 * EARLIEST member publish time, so an old event with fresh coverage does not pass the builder's 7-day window.
 */
export function eventDate(members: readonly IntakeItem[]): Date | null {
  const earliest = (list: readonly IntakeItem[]) => {
    let best: Date | null = null;
    for (const m of list) if (m.publishTime && (!best || m.publishTime < best)) best = m.publishTime;
    return best;
  };
  return earliest(members.filter((m) => m.family === 'search')) ?? earliest(members);
}

/** Pure read: stories active since `since`, scores joined, merged-away stories excluded. */
export async function listStories(q: IntakeQuery, input: ListStoriesInput): Promise<ScoredStory[]> {
  const params: unknown[] = [input.since];
  const where = ['s.merged_into IS NULL', '(s.last_joined_at >= $1 OR s.first_seen_at >= $1)'];
  if (input.until) {
    params.push(input.until);
    where.push(`s.first_seen_at <= $${params.length}`);
  }
  if (input.families?.length) {
    params.push([...input.families]);
    where.push(`EXISTS (SELECT 1 FROM intake.items m WHERE m.story_id = s.id AND ${keptInSql(params.length)})`);
  }
  for (const card of input.needScores ?? []) {
    params.push(card);
    where.push(`EXISTS (SELECT 1 FROM intake.scores c WHERE c.story_id = s.id AND c.scorecard = $${params.length})`);
  }
  let limit = '';
  if (input.limit != null) {
    params.push(input.limit);
    limit = `LIMIT $${params.length}`;
  }
  const { rows } = await q.query<StoryRow>(
    `SELECT s.id::text AS id, s.representative_key, s.headline, s.first_seen_at, s.last_joined_at, s.merged_into::text AS merged_into
       FROM intake.stories s
      WHERE ${where.join(' AND ')}
      ORDER BY s.last_joined_at DESC, s.id
      ${limit}`,
    params,
  );
  const stories = await withMembers(q, rows);
  if (stories.length === 0) return [];

  const { rows: scoreRows } = await q.query<{ story_id: string; scorecard: string; result: ScorecardResult }>(
    `SELECT story_id::text AS story_id, scorecard, result FROM intake.scores WHERE story_id = ANY($1::uuid[])`,
    [stories.map((s) => s.id)],
  );
  const scores = new Map<string, ScoredStory['scores']>();
  const best = new Map<string, NonNullable<ScoredStory['reelsBest']>>();
  const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  for (const row of scoreRows) {
    const into = scores.get(row.story_id) ?? {};
    const result = row.result;
    if (result.kind === 'reels-score') {
      into['reels-score'] = result.score;
      best.set(row.story_id, { net: num(result.best_net) ?? num(result.score.net), blockbuster: num(result.best_blockbuster) ?? num(result.score.blockbuster) });
    }
    else if (result.kind === 'story-scoring') into['story-scoring'] = result;
    else if (result.kind === 'major-news') into['major-news'] = result.score;
    else if (result.kind === 'story-builder') into['story-builder'] = result.score;
    else if (result.kind === 'field-notes-score') into['field-notes-score'] = result;
    scores.set(row.story_id, into);
  }

  return stories.map((story) => ({
    ...story,
    scores: scores.get(story.id) ?? {},
    reelsBest: best.get(story.id) ?? null,
    eventDate: eventDate(story.members),
    yours: seededStories.get(story) ?? story.members.some((m) => m.family === 'seed'),
  }));
}

/**
 * Successful = finished `ok` or `partial` (the cap stopped it after storing) AND its scoring stage ran (fix 3:
 * `record.scored`; a run whose cap was spent before scoring left its stories unscored, so it is not fresh).
 * A record without the flag (written before it existed) counts.
 */
const SUCCESS = `status IN ('ok', 'partial') AND COALESCE((record->>'scored')::boolean, true)`;

export const lastRuns: LastRuns = async (q) => {
  const { rows } = await q.query<{ id: string; kind: string; started_at: Date | string }>(
    `SELECT DISTINCT ON (kind) id::text AS id, kind, started_at
       FROM intake.runs
      WHERE ${SUCCESS} AND kind IN ('main', 'topup')
      ORDER BY kind, started_at DESC`,
  );
  const of = (kind: string) => {
    const row = rows.find((r) => r.kind === kind);
    return row ? { id: row.id, startedAt: date(row.started_at) } : null;
  };
  return { main: of('main'), topup: of('topup') };
};

/**
 * The start of the newest successful main run (SUCCESS above, as readConsumerMode's freshness reads it via lastRuns),
 * or null when there is none.
 */
export async function lastSuccessfulMainStart(q: IntakeQuery): Promise<Date | null> {
  return (await lastRuns(q)).main?.startedAt ?? null;
}

/** The newest successful run that fetched (for ensureIntakeFresh): a 'deposit' run fetches nothing, so it does not count. */
export async function lastSuccessfulRunAt(q: IntakeQuery): Promise<Date | null> {
  const { rows } = await q.query<{ started_at: Date | string }>(
    `SELECT started_at FROM intake.runs WHERE ${SUCCESS} AND kind <> 'deposit' ORDER BY started_at DESC LIMIT 1`,
  );
  return rows[0] ? date(rows[0].started_at) : null;
}

export async function readConsumerSettings(q: IntakeQuery): Promise<ConsumerSettings> {
  const fallback: ConsumerSettings = { lfd: 'legacy', md: 'legacy', gtn: 'legacy', fvp: 'legacy', reels: 'legacy', carousel: 'legacy', 'field-notes': 'legacy' };
  const { rows } = await q.query<{ value: Partial<ConsumerSettings> | string }>(
    `SELECT value FROM intake.settings WHERE key = 'consumers'`,
  );
  const raw = rows[0]?.value;
  const value = (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {};
  const out = { ...fallback };
  for (const id of Object.keys(fallback) as OrderId[]) if (value[id] === 'intake') out[id] = 'intake';
  return out;
}

/**
 * Which path a type takes for this build. 'intake' only when the switch says
 * so AND a main run succeeded within INTAKE_FRESH_HOURS; otherwise
 * 'stale-fallback' (switch on, intake stale) or 'legacy'. Never throws: any
 * read error is 'legacy'.
 */
export async function readConsumerMode(q: IntakeQuery, order: OrderId, now: Date): Promise<'intake' | 'legacy' | 'stale-fallback'> {
  try {
    const settings = await readConsumerSettings(q);
    if (settings[order] !== 'intake') return 'legacy';
    const { main } = await lastRuns(q);
    if (!main) return 'stale-fallback';
    if (now.getTime() - main.startedAt.getTime() > INTAKE_FRESH_HOURS * 3_600_000) return 'stale-fallback';
    // Per order (Phase 2): the order's own sources were fetched by a successful run in the window. An order closed at
    // midnight (Field Notes with auto_run off) has nothing fresh, so a later manual build takes the legacy path.
    return (await orderFetchedSince(q, order, new Date(now.getTime() - INTAKE_FRESH_HOURS * 3_600_000))) ? 'intake' : 'stale-fallback';
  } catch {
    return 'legacy';
  }
}

/** Orders every run fetched before run records listed their orders (Phase 1). */
const PHASE1_ORDERS: readonly OrderId[] = ['lfd', 'md', 'gtn', 'fvp'];

/** Whether a successful run that fetched (not a deposit) since `since` had this order open, so fetched its sources. */
export async function orderFetchedSince(q: IntakeQuery, order: OrderId, since: Date): Promise<boolean> {
  const { rows } = await q.query<{ orders: unknown }>(
    `SELECT record->'orders' AS orders FROM intake.runs
      WHERE ${SUCCESS} AND kind <> 'deposit' AND started_at >= $1
      ORDER BY started_at DESC LIMIT 50`,
    [since],
  );
  return rows.some((row) => {
    const raw = typeof row.orders === 'string' ? (JSON.parse(row.orders) as unknown) : row.orders;
    return Array.isArray(raw) ? raw.includes(order) : PHASE1_ORDERS.includes(order);
  });
}

/* ── Phase 2 reads ────────────────────────────────────────────────────── */

/** How deep resolveStoryId follows merged_into (a guard; real chains are one or two links). */
const MAX_MERGE_CHAIN = 25;

/**
 * The surviving story for an id: follows `merged_into` to the end of the chain (the Reels idea id of a merged
 * story is the story it was merged into). Null when the id is not an intake story (e.g. a legacy Reels idea id).
 */
export async function resolveStoryId(q: IntakeQuery, id: string): Promise<string | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { rows } = await q.query<{ id: string; merged_into: string | null; depth: number }>(
    `WITH RECURSIVE chain AS (
       SELECT id, merged_into, 0 AS depth FROM intake.stories WHERE id = $1::uuid
       UNION ALL
       SELECT s.id, s.merged_into, c.depth + 1 FROM intake.stories s JOIN chain c ON s.id = c.merged_into
        WHERE c.depth < $2)
     SELECT id::text AS id, merged_into::text AS merged_into, depth FROM chain ORDER BY depth DESC LIMIT 1`,
    [id, MAX_MERGE_CHAIN],
  );
  return rows[0]?.id ?? null;
}

/** The member families an order's sources can reach (seeds always: an order's own seeds are covered). */
export function orderFamilies(order: Pick<IntakeOrder, 'sources'>): Family[] {
  const out = new Set<Family>(['seed']);
  for (const source of order.sources) {
    if (source === 'feeds:*' || source.startsWith('feed:')) out.add('feeds');
    else if (source === 'field-notes:*' || source.startsWith('field-notes:')) out.add('field-notes');
    else {
      out.add('reels');
      out.add('search');
    }
  }
  return [...out];
}

export type ListOrderStoriesInput = Omit<ListStoriesInput, 'families'>;

/**
 * listStories for one order: only stories with a member the order's sources cover and keep (kept memberships,
 * per list), its own seeds included. A thin wrapper: no scoring, no writes.
 */
export async function listOrderStories(q: IntakeQuery, order: OrderId | IntakeOrder, input: ListOrderStoriesInput): Promise<ScoredStory[]> {
  const resolved = typeof order === 'string' ? (await import('./orders')).orderById(order) : order;
  if (!resolved) throw new Error(`unknown intake order ${String(order)}`);
  const stories = await listStories(q, { ...input, families: orderFamilies(resolved) });
  return stories.filter((story) => story.members.some((m) => orderCovers(resolved, m)));
}

/**
 * The items one source stored since `since`, newest first (fix 6: Free vs. Paid's GitHub Trending, as the legacy
 * read did: by source and first-seen date, no drop filter, grouped or not). A bounded read: one source, a window
 * and a limit; never a sweep.
 */
export async function listSourceItems(q: IntakeQuery, sourceId: string, since: Date, limit: number): Promise<IntakeItem[]> {
  const { rows } = await q.query<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM intake.items
      WHERE (source_id = $1 OR reels_source_id = $1) AND first_seen_at > $2
      ORDER BY first_seen_at DESC, key
      LIMIT $3`,
    [sourceId, since, limit],
  );
  return rows.map(toItem);
}
