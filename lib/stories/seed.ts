import { intakeRef } from '@/lib/intake/pool-stories';
import type { AddIntakeSeed, IntakeJev, IntakeQuery, ListStories, OrderId } from '@/lib/intake/types';
import { ApiError } from '@/lib/stories/api';
import type { Queryable } from '@/lib/stories/db';
import { morningDownloadScore } from '@/lib/stories/md-score';
import type { PoolItem } from '@/lib/stories/pool';
import type { Series } from '@/lib/stories/render/types';
import { SERIES } from '@/lib/stories/settings';
import type { StoryCandidate, ToolLead } from '@/lib/stories/sources/reels';

/**
 * Seeding a Stories idea (idea seeding spec, 2026-10-21): a person types an idea into one series' pool. A seed is an
 * ordinary pool row marked by its key (`seed:<id>`), so the nightly refresh never drops it, the cap never cuts it, and the
 * build picks it up like any idea. Nothing here calls a model or the web: a seed costs nothing, and starts no build.
 *
 *   Morning Download  a story: a headline, and a link or notes. Scored on the news scale as any story is.
 *   Free vs. Paid     a tool: its name, link and what it is. The model still pairs it with its counterpart.
 *
 * Free vs. Paid ranks by source order, so a seed sits mid-pool: it competes, it is never bumped. AI Trivia takes no
 * seeds: its questions come from the content map.
 *
 * Central intake (Phase 1): while Morning Download reads the intake (consumer switch 'intake'), a story seed with a
 * link is also handed to addIntakeSeed, which reads the page and scores it on entry (major-news and story-builder,
 * a few Jev calls, the person's click being the go-ahead), so the build's lead queue reads its stored scores. That
 * hand-off never refuses or fails the seed: on any error the seed stays as it always was. Tool seeds are not
 * stories and stay Stories-only.
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
  // AI Trivia writes its own questions from the content map (AT-14): it takes no typed-in idea.
  if (series === 'ai_trivia') throw new ApiError(400, 'AI Trivia writes its own questions; it takes no seeds.');
  const name = text(body.toolName, 80);
  const url = link(body.url);
  if (!name || !url) throw new ApiError(400, 'Give the tool’s name and a link that starts with http:// or https://');
  const lead: ToolLead = { origin: 'catalog', ref: key, name, url, description: text(body.description, 300) };
  return { series: series as Series, key, origin: 'catalog', ref: key, title: name, payload: { kind: 'lead', lead, story_key: null, source: 'Your seed', url, breakdown: mid('Your tool') }, score: MID_RANK };
}

export async function openSeedCount(db: Queryable, series: Series): Promise<number> {
  // Seeds a person archived free their place. A database without the moves table counts them all.
  try {
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM stories.pool p
        WHERE p.series = $1 AND p.used_at IS NULL AND p.key LIKE 'seed:%'
          AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a WHERE a.vertical = 'stories' AND a.kind = 'archive' AND a.idea_id = 'stories:pool:' || p.series || ':' || p.key)`,
      [series],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM stories.pool WHERE series = $1 AND used_at IS NULL AND key LIKE 'seed:%'`, [series]);
    return Number(rows[0]?.n ?? 0);
  }
}

/** The intake hand-off for a Morning Download seed (see the header). Tests stub every part. */
export type SeedIntake = {
  q: IntakeQuery;
  seededBy: string;
  readMode: (q: IntakeQuery, order: OrderId, now: Date) => Promise<'intake' | 'legacy' | 'stale-fallback'>;
  addSeed: AddIntakeSeed;
  jev: () => IntakeJev;
  listStories: ListStories;
  log?: (line: string) => void;
};

/** How far back the seeded story is looked up for its stored scores (Morning Download's pool window). */
const SEED_LOOKUP_MS = 4 * 86_400_000;

/** Put a typed idea into its series' pool. Starts nothing; free unless a Morning Download story seed goes to the intake. */
export async function seedIdea(db: Queryable, body: SeedBody, now = new Date(), intake?: SeedIntake): Promise<{ key: string; title: string }> {
  const item = seedItem(body, now);
  if ((await openSeedCount(db, item.series)) >= MAX_OPEN_SEEDS) throw new ApiError(409, `You have ${MAX_OPEN_SEEDS} seeded ideas waiting in this series; make or archive one first.`);
  await db.query(
    `INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, refreshed_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)`,
    [item.series, item.key, item.origin, item.ref, item.title, JSON.stringify(item.payload), item.score, now.toISOString()],
  );
  if (intake && item.payload.kind === 'story' && item.payload.url) await seedIntoIntake(db, item, intake, now);
  return { key: item.key, title: item.title };
}

async function seedIntoIntake(db: Queryable, item: PoolItem, intake: SeedIntake, now: Date): Promise<void> {
  try {
    if ((await intake.readMode(intake.q, 'md', now)) !== 'intake' || item.payload.kind !== 'story') return;
    const story = item.payload.story;
    const { storyId } = await intake.addSeed(intake.q, intake.jev(), { order: 'md', url: story.url, seededBy: intake.seededBy, headline: story.headline, body: story.body }, now);
    const found = (await intake.listStories(intake.q, { since: new Date(now.getTime() - SEED_LOOKUP_MS), families: ['seed'] })).find((s) => s.id === storyId);
    const ref = found ? intakeRef(found) : { storyId, major: null, builder: null, eventDate: null };
    await db.query(`UPDATE stories.pool SET payload = jsonb_set(payload, '{story,intake}', $3::jsonb) WHERE series = $1 AND key = $2`, [item.series, item.key, JSON.stringify(ref)]);
  } catch (err) {
    intake.log?.(`seed ${item.key}: intake hand-off failed, kept as a Stories seed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
