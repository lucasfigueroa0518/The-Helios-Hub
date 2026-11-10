/**
 * The Stories idea pool. Each series keeps an open, ranked list, refreshed
 * from the pools it draws on:
 *
 *   Morning Download   the reels slate's timely ideas + the carousel run's qualified stories
 *   Free vs. Paid      Ball Knowledge ideas and GitHub Trending (optional hints)
 *   AI Trivia          no refresh: the daily writer (lib/stories/trivia/daily.ts) adds its
 *                      questions itself. `trivia:` rows never leave for not being returned
 *                      or for age; the series holds TRIVIA_POOL_CAP (20) and a row the cap
 *                      drops frees its content-map cell (AT-11)
 *
 * Guess the Number is retired: nothing refreshes it, and its old rows stay as they are.
 *
 * Each series reads either today's sources (legacy) or the central intake
 * (lib/intake/pool-stories.ts: the same shapes and selection rules, no
 * dependency on Reels or Carousels having run), per the consumer switch
 * (lib/stories/pool-intake.ts). The refresh record says which.
 *
 * Used ideas stay used. An unused idea the latest refresh did not bring back
 * leaves, the way a reels slate replaces the night before. A series whose
 * sources could not be read keeps its list, and its rows age out after the
 * series' freshness window.
 *
 * The builds (the 3:00 AM auto set and Generate) draw from this pool. This
 * pass only reads the other pools (CLAUDE.md rule 2: nothing else in the
 * database is swept). It does not score with a model. Morning Download scores
 * every story on one news scale (lib/stories/md-score.ts); the other series
 * keep each source's own rank. Each row carries its breakdown for the hub.
 */
import type { Queryable } from '@/lib/stories/db';
import { POOL_CAP, QUEUE_LIVE } from '@/lib/social-hub/queue';
import type { ScoreBreakdown } from '@/lib/social-hub/types';
import { morningDownloadScore, rankBreakdown } from '@/lib/stories/md-score';
import type { Series } from '@/lib/stories/render/types';
import { latestCarouselRunAt, morningDownloadCarousel } from '@/lib/stories/sources/carousel';
import { freeToolLeads, morningDownloadReels, storyKey, type StoryCandidate, type ToolLead } from '@/lib/stories/sources/reels';
import { freeCell } from '@/lib/stories/trivia/cells';
import { TRIVIA_KEY_PREFIX, type TriviaPoolPayload } from '@/lib/stories/trivia/types';

export type PoolEntry = { kind: 'story'; story: StoryCandidate } | { kind: 'lead'; lead: ToolLead } | TriviaPoolPayload;

export type PoolItem = {
  series: Series;
  key: string;
  origin: 'reels' | 'carousel' | 'catalog' | 'github' | 'generated' | 'model';
  ref: string;
  title: string;
  /** The source record the build needs, plus `story_key` (what stories.history records for the series). */
  payload: PoolEntry & { story_key: string | null; source: string | null; url: string | null; breakdown: ScoreBreakdown | null };
  score: number | null;
};

export const POOL_SERIES: Series[] = ['morning_download', 'free_vs_paid', 'ai_trivia'];

/**
 * An unused row no refresh has touched in this long leaves, even when its sources could not be read. Guess the Number is
 * retired (not in POOL_SERIES); AI Trivia's `trivia:` rows are exempt from this drop (its value is only a placeholder).
 */
export const FRESH_MS: Record<Series, number> = {
  morning_download: 3 * 86_400_000,
  guess_the_number: 7 * 86_400_000,
  free_vs_paid: 14 * 86_400_000,
  ai_trivia: 365 * 86_400_000,
};

/** AI Trivia's pool holds at most this many open questions (AT-11); the other series hold POOL_CAP. */
export const TRIVIA_POOL_CAP = 20;

/** The pool turns over at 3:00 AM New York (the Stories hour, night schedule v2: after the 2:40 intake top-up). */
export const POOL_DAY_STARTS_HOUR = 3;

/**
 * Where a series' ideas were read: the intake, today's sources, today's sources because the intake is stale (no main
 * run in 26 h), or today's sources because the intake read failed for that series ('error-fallback').
 */
export type SeriesSource = 'intake' | 'legacy' | 'stale-fallback' | 'error-fallback';
export type PoolModes = { md: SeriesSource; fvp: SeriesSource };

export type PoolReads = {
  morning: () => Promise<{ reels: StoryCandidate[]; carousel: StoryCandidate[] }>;
  leads: () => Promise<ToolLead[]>;
  /** When the newest carousel run finished: a run newer than the last refresh saw makes the pool due again. */
  carouselRunAt?: () => Promise<string | null>;
  /** Which source each series read (the consumer switch); recorded with the refresh. */
  modes?: () => Promise<PoolModes>;
};

/** The live reads, all from the shared database (read only). */
export function livePoolReads(sourceDb: Queryable, now: Date): PoolReads {
  const ny = nyDateOf(now);
  return {
    morning: async () => {
      const [reels, carousel] = await Promise.all([morningDownloadReels(sourceDb, ny), morningDownloadCarousel(sourceDb, now)]);
      return { reels, carousel };
    },
    leads: () => freeToolLeads(sourceDb, ny),
    carouselRunAt: () => latestCarouselRunAt(sourceDb),
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
  await read('free_vs_paid', async () => {
    const leads = (await reads.leads()).filter((l) => l.url);
    // Each source's own order: reels and GitHub newest first.
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

const originLabel = (o: string) => ({ reels: 'Text on Screen', carousel: 'Carousel', catalog: 'Catalog', github: 'GitHub', generated: 'Generated', model: 'AI Trivia writer' })[o] ?? o;

/**
 * Write a fresh gather into stories.pool:
 *   1. upsert each returned idea (a used row is never touched)
 *   2. anything stories.history has shown is used
 *   3. a fully read series drops its unused rows the refresh did not return
 *   4. any unused row past its series' freshness window drops
 *      (a person's own seeds, keyed `seed:`, are never dropped by 3, 4 or 5; AI Trivia's `trivia:` rows never by 3 or 4)
 *   5. an unused series holds at most POOL_CAP open ideas (idea pool standard, 2026-10-21; AI Trivia TRIVIA_POOL_CAP): the
 *      lowest-scored go, never one a person pinned or dragged; ideas a person archived do not count
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
          AND key NOT LIKE 'seed:%' AND key NOT LIKE 'trivia:%'
          AND (refreshed_at < $2::timestamptz OR ($3::text[] IS NOT NULL AND NOT (key = ANY($3::text[]))))
        RETURNING id`,
      [series, cutoff, keys],
    );
    dropped += rows.length;
    dropped += series === 'ai_trivia' ? (await capTriviaPool(db, now)).length : (await capSeries(db, series)).length;
  }
  return { upserted: items.length, dropped };
}

/**
 * Hold AI Trivia to TRIVIA_POOL_CAP (AT-11, whether or not the shared queue is live): every question it drops goes to
 * stories.trivia_archive (reason 'cap') and its content-map cell opens again. Returns the dropped keys. Without the moves
 * table it caps on score alone.
 */
export async function capTriviaPool(db: Queryable, now: Date = new Date()): Promise<string[]> {
  let dropped: Dropped[];
  try {
    dropped = await capSeries(db, 'ai_trivia', TRIVIA_POOL_CAP, true);
  } catch {
    const { rows } = await db.query<Dropped>(
      `DELETE FROM stories.pool p
        WHERE p.series = 'ai_trivia' AND p.used_at IS NULL
          AND p.id IN (SELECT r.id FROM (SELECT p2.id, row_number() OVER (ORDER BY p2.score DESC NULLS LAST, p2.title) AS n
                         FROM stories.pool p2 WHERE p2.series = 'ai_trivia' AND p2.used_at IS NULL) r WHERE r.n > $1)
        RETURNING p.key, p.payload`,
      [TRIVIA_POOL_CAP],
    );
    dropped = rows;
  }
  for (const { key, payload } of dropped) {
    if (!key.startsWith(TRIVIA_KEY_PREFIX)) continue;
    const cellId = key.slice(TRIVIA_KEY_PREFIX.length);
    await db.query(`INSERT INTO stories.trivia_archive (key, cell_id, payload, reason, archived_at) VALUES ($1, $2, $3::jsonb, 'cap', $4::timestamptz)`, [key, cellId, JSON.stringify(payload ?? {}), now.toISOString()]);
    await freeCell(db, key);
  }
  return dropped.map((d) => d.key);
}

type Dropped = { key: string; payload: unknown };

/**
 * Hold one series to its cap; the dropped keys. Never throws unless `rethrow`: a database without the moves table keeps its
 * pool as it is.
 */
async function capSeries(db: Queryable, series: Series, cap: number = POOL_CAP, rethrow = false): Promise<Dropped[]> {
  if (!rethrow && !QUEUE_LIVE.has('stories')) return [];
  try {
    const { rows } = await db.query<Dropped>(
      `DELETE FROM stories.pool p
        WHERE p.series = $1 AND p.used_at IS NULL AND p.key NOT LIKE 'seed:%'
          AND p.id IN (
            SELECT r.id FROM (
              SELECT p2.id, row_number() OVER (ORDER BY p2.score DESC NULLS LAST, p2.title) AS n
                FROM stories.pool p2
               WHERE p2.series = $1 AND p2.used_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a WHERE a.vertical = 'stories' AND a.kind = 'archive' AND a.idea_id = 'stories:pool:' || p2.series || ':' || p2.key)
            ) r WHERE r.n > $2)
          AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a
                           WHERE a.vertical = 'stories' AND a.consumed_at IS NULL AND a.kind IN ('pin', 'promote', 'place')
                             AND a.idea_id = 'stories:pool:' || p.series || ':' || p.key)
        RETURNING p.key, p.payload`,
      [series, cap],
    );
    return rows;
  } catch (err) {
    if (rethrow) throw err;
    return [];
  }
}

export async function refreshStoryPool(db: Queryable, reads: PoolReads, now: Date): Promise<{ upserted: number; dropped: number; errors: string[]; intake?: PoolModes }> {
  // Read the carousel marker before gathering: a run that finishes mid-gather is newer than this and refreshes again.
  const carouselAt = await reads.carouselRunAt?.().catch(() => null) ?? null;
  const gathered = await gatherPool(reads, now);
  const modes = (await reads.modes?.().catch(() => null)) ?? null;
  const r = await writePool(db, gathered, now);
  await db.query(
    `INSERT INTO stories.settings (key, value, updated_by, updated_at) VALUES ('pool_refreshed', $1::jsonb, 'worker', now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify({ day: poolDay(now), at: now.toISOString(), carousel_at: carouselAt, upserted: r.upserted, dropped: r.dropped, errors: gathered.errors, ...(modes ? { intake: modes } : {}) })],
  );
  return { ...r, errors: gathered.errors, ...(modes ? { intake: modes } : {}) };
}

/** The pool's day: the New York date, turning over at 3:00 AM instead of midnight. */
export function poolDay(now: Date): string {
  return nyDateOf(new Date(now.getTime() - POOL_DAY_STARTS_HOUR * 3_600_000));
}

/**
 * Refresh once per pool day (the first worker pass after 3:00 AM, or the first build before it if the
 * pool has none for the day), and again whenever a carousel run (or, for a series on the intake, an
 * intake run) has started since the last refresh read it. The second case is how a late or manually
 * started run's stories reach Morning Download.
 */
export async function refreshPoolIfDue(db: Queryable, reads: () => PoolReads, now: Date): Promise<Awaited<ReturnType<typeof refreshStoryPool>> | null> {
  const { rows } = await db.query<{ value: { day?: string; carousel_at?: string | null } | null }>(`SELECT value FROM stories.settings WHERE key = 'pool_refreshed'`);
  const last = rows[0]?.value;
  const source = reads();
  if (last?.day === poolDay(now)) {
    const latest = await source.carouselRunAt?.().catch(() => null);
    const seen = last.carousel_at ? Date.parse(last.carousel_at) : 0;
    if (!latest || Date.parse(latest) <= seen) return null;
  }
  return refreshStoryPool(db, source, now);
}

/** A pool entry's key and score, parallel to the lists of an OpenPool (the pool standard's order needs both). */
export type PoolMeta = { key: string; score: number | null };

export type OpenPool = {
  stories: StoryCandidate[]; leads: ToolLead[];
  /** AI Trivia's open questions, best first (absent on a pool built by hand). */
  trivia?: TriviaPoolPayload[];
  /** Each list's entries' pool key and score, in the same order (set by openPool; a pool built by hand may omit it). */
  meta?: { stories: PoolMeta[]; leads: PoolMeta[]; trivia?: PoolMeta[] };
};

/** One series' open ideas, best first: what its build chooses from. */
export async function openPool(db: Queryable, series: Series): Promise<OpenPool> {
  const { rows } = await db.query<{ key: string; score: string | number | null; payload: PoolItem['payload'] }>(
    `SELECT key, score, payload FROM stories.pool WHERE series = $1 AND used_at IS NULL ORDER BY score DESC NULLS LAST, title`,
    [series],
  );
  const out = { stories: [] as StoryCandidate[], leads: [] as ToolLead[], trivia: [] as TriviaPoolPayload[], meta: { stories: [] as PoolMeta[], leads: [] as PoolMeta[], trivia: [] as PoolMeta[] } };
  for (const { key, score, payload: p } of rows) {
    const meta: PoolMeta = { key, score: score == null ? null : Number(score) };
    if (p?.kind === 'story' && p.story) {
      out.stories.push(p.story);
      out.meta.stories.push(meta);
    } else if (p?.kind === 'lead' && p.lead) {
      out.leads.push(p.lead);
      out.meta.leads.push(meta);
    } else if (p?.kind === 'trivia' && p.q) {
      out.trivia.push(p);
      out.meta.trivia.push(meta);
    }
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
    .map((l) => (l.ref.startsWith('seed:') ? l.ref : storyKey(l.url)));
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
