/**
 * Trial Reels as a source (plan §2, §5; S-19 read-only). Stories reads
 * `reels.*`; it never writes there and never sweeps or backfills it
 * (CLAUDE.md rule 2): every read is today's pool for one build.
 */
import type { Queryable } from '@/lib/stories/db';

/** One news story a Stories build can use. */
export type StoryCandidate = {
  /** Stable key for repeat checks and merging (the canonical URL). */
  key: string;
  origin: 'reels' | 'carousel';
  /** Post idea id, or the carousel group id / post slug. */
  ref: string;
  headline: string;
  sourceName: string;
  url: string;
  body: string;
  publishedAt: string | null;
  /** Native score that let it into the pool (reels net, carousel passes). */
  nativeScore: number | null;
  blockbuster?: number;
  /** A photo the carousel already placed for this story (S-29). */
  photo?: { url: string; credit: string } | null;
  /** Other sources merged into this one (S-03 merge). */
  alsoFrom?: string[];
};

export const storyKey = (url: string) => {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$/.test(p)) u.searchParams.delete(p);
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
};

type IdeaRow = { post_idea_id: string; net: number | null; blockbuster: number; chosen_bucket: string | null; headline: string; source_name: string; canonical_url: string; body: string; publish_time: string | null };

const IDEA_SQL = (where: string) => `
  SELECT s.post_idea_id, s.net, s.blockbuster, s.chosen_bucket, src.headline, src.source_name, src.canonical_url, src.body,
         src.publish_time::text AS publish_time
    FROM reels.idea_scores s
    JOIN reels.score_slates sl ON sl.id = s.slate_id
    JOIN reels.post_idea_members m ON m.post_idea_id = s.post_idea_id AND m.role = 'primary'
    JOIN reels.sources src ON src.id = m.source_id
   WHERE ${where}`;

const toCandidate = (r: IdeaRow): StoryCandidate => ({
  key: storyKey(r.canonical_url),
  origin: 'reels',
  ref: r.post_idea_id,
  headline: r.headline,
  sourceName: r.source_name,
  url: r.canonical_url,
  body: r.body,
  publishedAt: r.publish_time,
  nativeScore: r.net,
  blockbuster: r.blockbuster,
});

/**
 * Text on Screen buckets that are an angle, not news: a warning about the
 * viewer's own behavior, or a stance against a practice. They skew to fear and
 * opinion, so Morning Download leaves them to Text on Screen (Lucas, 2026-10-09).
 */
export const NOT_NEWS_BUCKETS = ['the_warning', 'the_callout'] as const;

/** How many Text on Screen ideas Morning Download takes by net; the carousel is its main news source. */
export const MD_REELS_TOP = 10;

/** Morning Download pool, reels side (plan §5.1): the latest slate's timely news ideas, top 10 by net, plus every blockbuster. */
export async function morningDownloadReels(db: Queryable, nyDate: string): Promise<StoryCandidate[]> {
  const { rows: all } = await db.query<IdeaRow>(
    `${IDEA_SQL(`s.origin = 'timely' AND sl.id = (SELECT id FROM reels.score_slates WHERE ny_date <= $1 ORDER BY ny_date DESC, scored_at DESC LIMIT 1)`)}
     ORDER BY s.net DESC NULLS LAST`,
    [nyDate],
  );
  const rows = all.filter((r) => !(NOT_NEWS_BUCKETS as readonly string[]).includes(r.chosen_bucket ?? ''));
  const top = rows.slice(0, MD_REELS_TOP);
  const extra = rows.slice(MD_REELS_TOP).filter((r) => r.blockbuster > 0);
  return [...top, ...extra].map(toCandidate);
}

/** Guess the Number, reels side (S-10, S-26): ideas bucketed as The Number in the last 7 days. */
export async function theNumberIdeas(db: Queryable, nyDate: string): Promise<StoryCandidate[]> {
  const { rows } = await db.query<IdeaRow>(
    `${IDEA_SQL(`s.chosen_bucket = 'the_number' AND sl.ny_date > $1::date - 7 AND sl.ny_date <= $1::date`)} ORDER BY sl.ny_date DESC, s.net DESC NULLS LAST LIMIT 20`,
    [nyDate],
  );
  return dedupe(rows.map(toCandidate));
}

export type ToolLead = { origin: 'reels' | 'catalog' | 'github'; ref: string; name: string; url: string; description: string };

/**
 * Free vs. Paid leads (plan §5.3): Ball Knowledge ideas from the last 14 days,
 * GitHub Trending sources, and a sample of the curated-list catalog. Read only:
 * the catalog's own `last_considered` is the reels pipeline's, never touched.
 */
export async function freeToolLeads(db: Queryable, nyDate: string, opts: { catalogSample?: number } = {}): Promise<ToolLead[]> {
  const ideas = await db.query<IdeaRow>(
    `${IDEA_SQL(`s.chosen_bucket = 'ball_knowledge' AND sl.ny_date > $1::date - 14 AND sl.ny_date <= $1::date`)} ORDER BY sl.ny_date DESC LIMIT 15`,
    [nyDate],
  );
  const trending = await db.query<{ id: string; headline: string; canonical_url: string; body: string }>(
    `SELECT id, headline, canonical_url, left(body, 600) AS body FROM reels.sources
      WHERE adapter_id = 'github-trending' AND ingest_time > $1::date - 14 ORDER BY ingest_time DESC LIMIT 15`,
    [nyDate],
  );
  const catalog = await db.query<{ id: string; entry_name: string; entry_url: string; description: string | null }>(
    `SELECT id, entry_name, entry_url, description FROM reels.list_catalog
      WHERE description IS NOT NULL ORDER BY md5(id::text || $1) LIMIT $2`,
    [nyDate, opts.catalogSample ?? 30],
  );
  return [
    ...ideas.rows.map((r) => ({ origin: 'reels' as const, ref: r.post_idea_id, name: r.headline, url: r.canonical_url, description: r.body.slice(0, 600) })),
    ...trending.rows.map((r) => ({ origin: 'github' as const, ref: r.id, name: r.headline, url: r.canonical_url, description: r.body })),
    ...catalog.rows.map((r) => ({ origin: 'catalog' as const, ref: r.id, name: r.entry_name, url: r.entry_url, description: r.description ?? '' })),
  ];
}

export function dedupe<T extends { key: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
}
