/**
 * Pure reads over the intake store (lib/intake/types.ts ListStories,
 * LastRuns, the consumer switch). No scoring, no writes, no Jev.
 */
import {
  INTAKE_FRESH_HOURS,
  type ConsumerSettings,
  type Family,
  type IntakeItem,
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
  };
}

const ITEM_COLUMNS = `key, family, source_id, source_name, source_type, headline, body, url, publish_time,
  first_seen_at, last_seen_at, engagement, drop_reason, story_id::text AS story_id, role, seeded_by,
  feed_slug, feed_drop_reason, feed_source_name, reels_source_id, reels_drop_reason`;

/**
 * SQL twin of scorecards.ts keptIn: item `m` is a kept member of one of the families in parameter `$n` (fix 1:
 * feeds and reels membership is per list; older rows fall back to family + drop_reason).
 */
export function keptInSql(n: number, m = 'm'): string {
  const fams = `$${n}::text[]`;
  return `(('feeds' = ANY(${fams}) AND CASE WHEN ${m}.feed_slug IS NOT NULL THEN ${m}.feed_drop_reason IS NULL ELSE ${m}.family = 'feeds' AND ${m}.drop_reason IS NULL END)
      OR ('reels' = ANY(${fams}) AND CASE WHEN ${m}.reels_source_id IS NOT NULL THEN ${m}.reels_drop_reason IS NULL ELSE ${m}.family = 'reels' AND ${m}.drop_reason IS NULL END)
      OR (${m}.family IN ('search', 'seed') AND ${m}.family = ANY(${fams}) AND ${m}.drop_reason IS NULL))`;
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

/** The newest successful run of any kind (for ensureIntakeFresh). */
export async function lastSuccessfulRunAt(q: IntakeQuery): Promise<Date | null> {
  const { rows } = await q.query<{ started_at: Date | string }>(
    `SELECT started_at FROM intake.runs WHERE ${SUCCESS} ORDER BY started_at DESC LIMIT 1`,
  );
  return rows[0] ? date(rows[0].started_at) : null;
}

export async function readConsumerSettings(q: IntakeQuery): Promise<ConsumerSettings> {
  const fallback: ConsumerSettings = { lfd: 'legacy', md: 'legacy', gtn: 'legacy', fvp: 'legacy' };
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
    return now.getTime() - main.startedAt.getTime() <= INTAKE_FRESH_HOURS * 3_600_000 ? 'intake' : 'stale-fallback';
  } catch {
    return 'legacy';
  }
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
