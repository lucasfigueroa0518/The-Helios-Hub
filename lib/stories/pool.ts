/**
 * The Stories idea pool. Each series keeps an open, ranked list, refreshed
 * from the pools it draws on:
 *
 *   Morning Download   the reels slate's timely ideas + the carousel run's qualified stories
 *   Guess the Number   carousel brief numbers + shortlisted stories without a brief + reels The Number ideas
 *   Free vs. Paid      Ball Knowledge ideas, GitHub Trending, a catalog sample
 *
 * Used ideas stay used. An unused idea the latest refresh did not bring back
 * leaves, the way a reels slate replaces the night before. A series whose
 * sources could not be read keeps its list, and its rows age out after the
 * series' freshness window.
 *
 * The builds (the 4:00 AM auto set and Generate) draw from this pool. This
 * pass only reads the other pools (CLAUDE.md rule 2: nothing else in the
 * database is swept). It does not score with a model. Morning Download scores
 * every story on one news scale (lib/stories/md-score.ts); the other series
 * keep each source's own rank. Each row carries its breakdown for the hub.
 */
import type { Queryable } from '@/lib/stories/db';
import type { ScoreBreakdown } from '@/lib/social-hub/types';
import { morningDownloadScore, rankBreakdown } from '@/lib/stories/md-score';
import type { Series } from '@/lib/stories/render/types';
import { carouselNumbers, morningDownloadCarousel, shortlistWithoutBrief, type NumberCandidate } from '@/lib/stories/sources/carousel';
import { dedupe, freeToolLeads, morningDownloadReels, storyKey, theNumberIdeas, type StoryCandidate, type ToolLead } from '@/lib/stories/sources/reels';

export type PoolEntry = { kind: 'story'; story: StoryCandidate } | { kind: 'number'; number: NumberCandidate } | { kind: 'lead'; lead: ToolLead };

export type PoolItem = {
  series: Series;
  key: string;
  origin: 'reels' | 'carousel' | 'catalog' | 'github' | 'generated';
  ref: string;
  title: string;
  /** The source record the build needs, plus `story_key` (what stories.history records for the series). */
  payload: PoolEntry & { story_key: string | null; source: string | null; url: string | null; breakdown: ScoreBreakdown | null };
  score: number | null;
};

export const POOL_SERIES: Series[] = ['morning_download', 'guess_the_number', 'free_vs_paid'];

/** An unused row no refresh has touched in this long leaves, even when its sources could not be read. */
export const FRESH_MS: Record<Series, number> = {
  morning_download: 3 * 86_400_000,
  guess_the_number: 7 * 86_400_000,
  free_vs_paid: 14 * 86_400_000,
};

/** The pool turns over at 4:00 AM New York (the Stories hour, after the 3 AM carousel run). */
export const POOL_DAY_STARTS_HOUR = 4;

export type PoolReads = {
  morning: () => Promise<{ reels: StoryCandidate[]; carousel: StoryCandidate[] }>;
  numbers: () => Promise<{ numbers: NumberCandidate[]; unbriefed: StoryCandidate[] }>;
  leads: () => Promise<ToolLead[]>;
};

/** The live reads, all from the shared database (read only). */
export function livePoolReads(sourceDb: Queryable, now: Date): PoolReads {
  const ny = nyDateOf(now);
  return {
    morning: async () => {
      const [reels, carousel] = await Promise.all([morningDownloadReels(sourceDb, ny), morningDownloadCarousel(sourceDb, now)]);
      return { reels, carousel };
    },
    numbers: async () => {
      const [numbers, shortlist, theNumber] = await Promise.all([carouselNumbers(sourceDb, now), shortlistWithoutBrief(sourceDb, now), theNumberIdeas(sourceDb, ny)]);
      return { numbers, unbriefed: dedupe([...shortlist, ...theNumber]) };
    },
    leads: () => freeToolLeads(sourceDb, ny),
  };
}

type Ranked<T> = [T, number, ScoreBreakdown];

/** Rank within one source list: its first item 1, its last near 0. A source's own order is its ranking. */
function sourceRank<T>(list: T[], label: string): Array<Ranked<T>> {
  return list.map((item, i) => [item, Number(((list.length - i) / list.length).toFixed(4)), rankBreakdown(label, i, list.length)]);
}

/** Every series' fresh list, and which series were read in full (only those drop what they no longer return). */
export async function gatherPool(reads: PoolReads, now: Date = new Date()): Promise<{ items: PoolItem[]; refreshed: Series[]; errors: string[] }> {
  const items: PoolItem[] = [];
  const refreshed: Series[] = [];
  const errors: string[] = [];
  const read = async (series: Series, run: () => Promise<PoolItem[]>) => {
    try {
      const got = await run();
      const seen = new Set<string>();
      items.push(...got.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true))));
      refreshed.push(series);
    } catch (err) {
      // One series unread leaves the others. A refresh never fails the night.
      errors.push(`${series}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  await read('morning_download', async () => {
    const { reels, carousel } = await reads.morning();
    // Carousel first: on a shared key its photo comes along (S-29). One news scale for both sources.
    return [...carousel, ...reels].map((c) => {
      const { score, breakdown } = morningDownloadScore(c, now);
      return storyItem('morning_download', c, c.key, score, breakdown);
    });
  });
  await read('guess_the_number', async () => {
    const { numbers, unbriefed } = await reads.numbers();
    return [
      ...sourceRank(numbers, 'Carousel brief numbers').map(([n, score, b]) => numberItem(n, score, b)),
      ...sourceRank(unbriefed, 'Stories without a brief').map(([c, score, b]) => storyItem('guess_the_number', c, `story:${c.key}`, score, b)),
    ];
  });
  await read('free_vs_paid', async () => {
    const leads = (await reads.leads()).filter((l) => l.url);
    // Each source's own order: reels and GitHub newest first, the catalog a daily sample.
    const byOrigin = (o: ToolLead['origin']) => sourceRank(leads.filter((l) => l.origin === o), originLabel(o));
    return [...byOrigin('reels'), ...byOrigin('github'), ...byOrigin('catalog')].map(([lead, score, breakdown]) => ({
      series: 'free_vs_paid' as const,
      key: storyKey(lead.url),
      origin: lead.origin,
      ref: lead.ref,
      title: lead.name,
      payload: { kind: 'lead' as const, lead, story_key: null, source: originLabel(lead.origin), url: lead.url, breakdown },
      score,
    }));
  });
  return { items, refreshed, errors };
}

function storyItem(series: Series, c: StoryCandidate, key: string, score: number, breakdown: ScoreBreakdown): PoolItem {
  return { series, key, origin: c.origin, ref: c.ref, title: c.headline, payload: { kind: 'story', story: c, story_key: c.key, source: c.sourceName, url: c.url, breakdown }, score };
}

function numberItem(n: NumberCandidate, score: number, breakdown: ScoreBreakdown): PoolItem {
  return {
    series: 'guess_the_number',
    key: n.key,
    origin: n.origin,
    ref: n.ref,
    title: `${n.value}: ${(n.fact || n.storyHeadline).slice(0, 140)}`,
    payload: { kind: 'number', number: n, story_key: n.storyKey, source: n.sourceName, url: n.url || null, breakdown },
    score,
  };
}

const originLabel = (o: string) => ({ reels: 'Text on Screen', carousel: 'Carousel', catalog: 'Catalog', github: 'GitHub', generated: 'Generated' })[o] ?? o;

/**
 * Write a fresh gather into stories.pool:
 *   1. upsert each returned idea (a used row is never touched)
 *   2. anything stories.history has shown is used
 *   3. a fully read series drops its unused rows the refresh did not return
 *   4. any unused row past its series' freshness window drops
 */
export async function writePool(db: Queryable, gathered: { items: PoolItem[]; refreshed: Series[] }, now: Date): Promise<{ upserted: number; dropped: number }> {
  const { items, refreshed } = gathered;
  for (const item of items) {
    await db.query(
      `INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, refreshed_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)
       ON CONFLICT (series, key) DO UPDATE SET
         origin = EXCLUDED.origin, ref = EXCLUDED.ref, title = EXCLUDED.title,
         payload = EXCLUDED.payload, score = EXCLUDED.score, refreshed_at = EXCLUDED.refreshed_at
       WHERE stories.pool.used_at IS NULL`,
      [item.series, item.key, item.origin, item.ref, item.title, JSON.stringify(item.payload), item.score, now.toISOString()],
    );
  }
  await db.query(
    `UPDATE stories.pool p SET used_at = $1::timestamptz
      WHERE p.used_at IS NULL
        AND EXISTS (SELECT 1 FROM stories.history h WHERE h.series = p.series AND (h.key = p.key OR h.key = p.payload->>'story_key'))`,
    [now.toISOString()],
  );
  let dropped = 0;
  for (const series of POOL_SERIES) {
    const cutoff = new Date(now.getTime() - FRESH_MS[series]).toISOString();
    const keys = refreshed.includes(series) ? items.filter((i) => i.series === series).map((i) => i.key) : null;
    const { rows } = await db.query<{ id: string }>(
      `DELETE FROM stories.pool
        WHERE series = $1 AND used_at IS NULL
          AND (refreshed_at < $2::timestamptz OR ($3::text[] IS NOT NULL AND NOT (key = ANY($3::text[]))))
        RETURNING id`,
      [series, cutoff, keys],
    );
    dropped += rows.length;
  }
  return { upserted: items.length, dropped };
}

export async function refreshStoryPool(db: Queryable, reads: PoolReads, now: Date): Promise<{ upserted: number; dropped: number; errors: string[] }> {
  const gathered = await gatherPool(reads, now);
  const r = await writePool(db, gathered, now);
  await db.query(
    `INSERT INTO stories.settings (key, value, updated_by, updated_at) VALUES ('pool_refreshed', $1::jsonb, 'worker', now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify({ day: poolDay(now), at: now.toISOString(), upserted: r.upserted, dropped: r.dropped, errors: gathered.errors })],
  );
  return { ...r, errors: gathered.errors };
}

/** The pool's day: the New York date, turning over at 4:00 AM instead of midnight. */
export function poolDay(now: Date): string {
  return nyDateOf(new Date(now.getTime() - POOL_DAY_STARTS_HOUR * 3_600_000));
}

/** Refresh once per pool day: the first worker pass after 4:00 AM, or the first build before it if the pool has none for the day. */
export async function refreshPoolIfDue(db: Queryable, reads: () => PoolReads, now: Date): Promise<Awaited<ReturnType<typeof refreshStoryPool>> | null> {
  const { rows } = await db.query<{ value: { day?: string } | null }>(`SELECT value FROM stories.settings WHERE key = 'pool_refreshed'`);
  if (rows[0]?.value?.day === poolDay(now)) return null;
  return refreshStoryPool(db, reads(), now);
}

export type OpenPool = { stories: StoryCandidate[]; numbers: NumberCandidate[]; unbriefed: StoryCandidate[]; leads: ToolLead[] };

/** One series' open ideas, best first: what its build chooses from. */
export async function openPool(db: Queryable, series: Series): Promise<OpenPool> {
  const { rows } = await db.query<{ payload: PoolItem['payload'] }>(
    `SELECT payload FROM stories.pool WHERE series = $1 AND used_at IS NULL ORDER BY score DESC NULLS LAST, title`,
    [series],
  );
  const out: OpenPool = { stories: [], numbers: [], unbriefed: [], leads: [] };
  for (const { payload: p } of rows) {
    if (p?.kind === 'story' && p.story) (series === 'guess_the_number' ? out.unbriefed : out.stories).push(p.story);
    else if (p?.kind === 'number' && p.number) out.numbers.push(p.number);
    else if (p?.kind === 'lead' && p.lead) out.leads.push(p.lead);
  }
  return out;
}

/** A built set's ideas are used: by pool key, or by the story key stories.history records. */
export async function markPoolUsed(db: Queryable, series: Series, keys: readonly string[], now: Date): Promise<number> {
  if (!keys.length) return 0;
  const { rows } = await db.query<{ id: string }>(
    `UPDATE stories.pool SET used_at = $3::timestamptz
      WHERE series = $1 AND used_at IS NULL AND (key = ANY($2::text[]) OR payload->>'story_key' = ANY($2::text[]))
      RETURNING id`,
    [series, [...keys], now.toISOString()],
  );
  return rows.length;
}

/** Free vs. Paid: the leads a chosen pair came from (the pair is the model's, the leads are the pool's). */
export function leadKeysForPair(leads: readonly ToolLead[], pair: { paid_tool?: unknown; free_tool?: unknown; paid_price_url?: unknown; free_url?: unknown }): string[] {
  const names = [pair.paid_tool, pair.free_tool].filter((v): v is string => typeof v === 'string' && v.trim().length > 2).map((v) => v.trim().toLowerCase());
  const hosts = [pair.paid_price_url, pair.free_url].filter((v): v is string => typeof v === 'string').map(hostOf).filter((h): h is string => Boolean(h) && h !== 'github.com');
  return leads
    .filter((l) => {
      const name = l.name.toLowerCase();
      const host = hostOf(l.url);
      return names.some((n) => name.includes(n)) || (host != null && hosts.includes(host));
    })
    .map((l) => storyKey(l.url));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function nyDateOf(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(at);
}
