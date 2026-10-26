import { ApiError } from '@/lib/stories/api';
import type { Queryable } from '@/lib/stories/db';
import { morningDownloadScore } from '@/lib/stories/md-score';
import type { PoolItem } from '@/lib/stories/pool';
import type { Series } from '@/lib/stories/render/types';
import { SERIES } from '@/lib/stories/settings';
import type { NumberCandidate } from '@/lib/stories/sources/carousel';
import type { StoryCandidate, ToolLead } from '@/lib/stories/sources/reels';

/**
 * Seeding a Stories idea (idea seeding spec, 2026-10-21): a person types an idea into one series' pool. A seed is an
 * ordinary pool row marked by its key (`seed:<id>`), so the nightly refresh never drops it, the cap never cuts it, and the
 * build picks it up like any idea. Nothing here calls a model or the web: a seed costs nothing, and starts no build.
 *
 *   Morning Download  a story: a headline, and a link or notes. Scored on the news scale as any story is.
 *   Guess the Number  a number: the figure and what it counts, and the story it comes from.
 *   Free vs. Paid     a tool: its name, link and what it is. The model still pairs it with its counterpart.
 *
 * Guess the Number and Free vs. Paid rank by source order, so a seed sits mid-pool: it competes, it is never bumped.
 */

export const SEED_PREFIX = 'seed:';
export const isSeedKey = (key: string): boolean => key.startsWith(SEED_PREFIX);

/** How many typed-in ideas a series may hold at once; the next is refused with a plain message. */
export const MAX_OPEN_SEEDS = 10;

const MID_RANK = 0.5;
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const link = (v: unknown): string => {
  const u = text(v, 2000);
  return /^https?:\/\//i.test(u) ? u : '';
};

export type SeedBody = Record<string, unknown> & { series?: unknown };

function mid(label: string): PoolItem['payload']['breakdown'] {
  return { formula: 'Typed in by you. It ranks mid-pool with the rest and is never put first on its own.', parts: [{ label, points: null, detail: 'Yours' }] };
}

/** The pool row for one seed, or an ApiError(400) saying what is missing. */
export function seedItem(body: SeedBody, now: Date, id: string = crypto.randomUUID()): PoolItem {
  const series = body.series;
  if (typeof series !== 'string' || !(SERIES as string[]).includes(series)) throw new ApiError(400, 'Choose a series.');
  const key = `${SEED_PREFIX}${id}`;
  if (series === 'morning_download') {
    const headline = text(body.headline, 200);
    if (!headline) throw new ApiError(400, 'Write the headline of the story.');
    const url = link(body.url);
    if (text(body.url, 2000) && !url) throw new ApiError(400, 'The link must start with http:// or https://');
    const story: StoryCandidate = { key, origin: 'reels', ref: key, headline, sourceName: 'Your seed', url, body: text(body.notes, 5000) || headline, publishedAt: now.toISOString(), nativeScore: null };
    const { score, breakdown } = morningDownloadScore(story, now);
    return { series, key, origin: 'reels', ref: key, title: headline, payload: { kind: 'story', story, story_key: key, source: 'Your seed', url: url || null, breakdown }, score };
  }
  if (series === 'guess_the_number') {
    const value = text(body.value, 40);
    const fact = text(body.fact, 300);
    if (!value || !fact) throw new ApiError(400, 'Give the number and what it counts.');
    const url = link(body.url);
    if (text(body.url, 2000) && !url) throw new ApiError(400, 'The link must start with http:// or https://');
    const storyHeadline = text(body.storyHeadline, 200) || fact;
    const number: NumberCandidate = { key, origin: 'generated', ref: key, value, fact, counts: fact, storyHeadline, sourceName: 'Your seed', url, storyKey: key };
    return { series, key, origin: 'generated', ref: key, title: `${value}: ${fact.slice(0, 140)}`, payload: { kind: 'number', number, story_key: key, source: 'Your seed', url: url || null, breakdown: mid('Your number') }, score: MID_RANK };
  }
  const name = text(body.toolName, 80);
  const url = link(body.url);
  if (!name || !url) throw new ApiError(400, 'Give the tool’s name and a link that starts with http:// or https://');
  const lead: ToolLead = { origin: 'catalog', ref: key, name, url, description: text(body.description, 300) };
  return { series: series as Series, key, origin: 'catalog', ref: key, title: name, payload: { kind: 'lead', lead, story_key: null, source: 'Your seed', url, breakdown: mid('Your tool') }, score: MID_RANK };
}

export async function openSeedCount(db: Queryable, series: Series): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM stories.pool WHERE series = $1 AND used_at IS NULL AND key LIKE 'seed:%'`, [series]);
  return Number(rows[0]?.n ?? 0);
}

/** Put a typed idea into its series' pool. Free of cost; starts nothing. */
export async function seedIdea(db: Queryable, body: SeedBody, now = new Date()): Promise<{ key: string; title: string }> {
  const item = seedItem(body, now);
  if ((await openSeedCount(db, item.series)) >= MAX_OPEN_SEEDS) throw new ApiError(409, `You have ${MAX_OPEN_SEEDS} seeded ideas waiting in this series; make or archive one first.`);
  await db.query(
    `INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, refreshed_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)`,
    [item.series, item.key, item.origin, item.ref, item.title, JSON.stringify(item.payload), item.score, now.toISOString()],
  );
  return { key: item.key, title: item.title };
}
