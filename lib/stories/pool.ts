/**
 * The Stories idea pool. Each series keeps an open, ranked list, refreshed
 * from the pools it draws on:
 *
 *   Morning Download   the reels slate's timely ideas + the carousel run's qualified stories
 *   Free vs. Paid      Ball Knowledge ideas and GitHub Trending (optional hints)
 *   AI Trivia          no refresh: the daily writer (lib/stories/trivia/daily.ts) adds its
 *                      questions itself. `trivia:` rows never leave for not being returned
 *                      or for age; the unused bank holds TRIVIA_POOL_CAP (50), served questions TRIVIA_SERVED_CAP (40), and a row the cap
 *                      drops frees its content-map cell (AT-11)
 *   Real or AI?        no refresh: the daily run (lib/stories/roa/daily.ts) adds its images
 *                      itself. `roa:` rows never leave for not being returned or for age; the
 *                      series holds ROA_POOL_CAP (40) by difficulty and a row the cap drops goes
 *                      to stories.roa_archive (reason 'cap')
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
import { POOL_CAP } from '@/lib/social-hub/queue';
import { verticalOfSeries } from '@/lib/social-hub/story-types';
import type { ScoreBreakdown } from '@/lib/social-hub/types';
import { morningDownloadScore } from '@/lib/stories/md-score';
import type { Series } from '@/lib/stories/render/types';
import { latestCarouselRunAt, morningDownloadCarousel } from '@/lib/stories/sources/carousel';
import { freeToolLeads, morningDownloadReels, storyKey, type StoryCandidate, type ToolLead } from '@/lib/stories/sources/reels';
import { cellOfKey, TRIVIA_KEY_PREFIX, type TriviaPoolPayload } from '@/lib/stories/trivia/types';
import { ROA_KEY_PREFIX, ROA_POOL_CAP, ROA_SERIES, type RoaPoolPayload } from '@/lib/stories/roa/types';

export type PoolEntry = { kind: 'story'; story: StoryCandidate } | { kind: 'lead'; lead: ToolLead } | TriviaPoolPayload | RoaPoolPayload;

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

/** The series the pool keeps. Free vs. Paid is retired (SS-27): the refresh no longer reads its leads; its rows stay as history. */
export const POOL_SERIES: Series[] = ['morning_download', 'ai_trivia', 'real_or_ai'];

/**
 * An unused row no refresh has touched in this long leaves, even when its sources could not be read. Guess the Number and
 * Free vs. Paid are retired (not in POOL_SERIES); AI Trivia's `trivia:` and Real or AI?'s `roa:` rows are exempt from this drop (their
 * values are only placeholders).
 */
export const FRESH_MS: Record<Series, number> = {
  morning_download: 3 * 86_400_000,
  guess_the_number: 7 * 86_400_000,
  free_vs_paid: 14 * 86_400_000,
  ai_trivia: 365 * 86_400_000,
  real_or_ai: 365 * 86_400_000,
};

/**
 * AI Trivia's unused bank holds at most this many questions (AT-11; 50 since 2026-11-22): open pool questions no game
 * day holds, the ones the game can still play. The other series hold POOL_CAP.
 */
export const TRIVIA_POOL_CAP = 50;
/** Open questions the game already served (a past locked day's, handed back to the IG story): held apart, at most this many. */
export const TRIVIA_SERVED_CAP = 40;

/** Keys a locked game day holds: the game has served them or will on that date. */
const TRIVIA_GAME_KEYS = `SELECT q->>'key' FROM stories.trivia_game_days d, jsonb_array_elements(d.questions) q WHERE d.status = 'locked'`;

/** Keys of the questions a locked game day holds (the game served them or will on that date). */
export async function servedTriviaKeys(db: Queryable): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string | null }>(`SELECT DISTINCT k AS key FROM (${TRIVIA_GAME_KEYS}) AS g(k)`);
  return new Set(rows.map((r) => r.key).filter((k): k is string => !!k));
}

/** The unused bank: open AI Trivia pool questions that no locked game day holds (a draft's questions are reserved, so not open). */
export async function unusedTriviaCount(db: Queryable): Promise<number> {
  const live = (await hasArchiveColumn(db)) ? 'AND archived_at IS NULL' : '';
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM stories.pool WHERE series = 'ai_trivia' AND used_at IS NULL ${live} AND key NOT IN (${TRIVIA_GAME_KEYS})`,
  );
  return rows[0]?.n ?? 0;
}

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
  // Free vs. Paid is retired (SS-27): its tool leads are no longer read into the pool.
  return { items, refreshed, errors };
}

function storyItem(series: Series, c: StoryCandidate, key: string, score: number, breakdown: ScoreBreakdown): PoolItem {
  return { series, key, origin: c.origin, ref: c.ref, title: c.headline, payload: { kind: 'story', story: c, story_key: c.key, source: c.sourceName, url: c.url, breakdown }, score };
}

/**
 * Write a fresh gather into stories.pool:
 *   1. upsert each returned idea (a used row is never touched, except Morning Download's: a story the
 *      intake still returns is reopened, because new articles keep joining the same intake story and
 *      md-development.ts decides whether it is news again; Bald-Eagle D2)
 *   2. anything stories.history has shown is used (not Morning Download, for the same reason)
 *   3. a fully read series archives its unused rows the refresh did not return
 *   4. any unused row past its series' freshness window is archived
 *      (a person's own seeds, keyed `seed:` or carrying payload.seed = true, are never archived by 3, 4 or 5; AI Trivia's `trivia:` and Real or AI?'s `roa:`
 *      rows never by 3 or 4)
 *   5. an unused series holds at most POOL_CAP open ideas (idea pool standard, 2026-10-21): the lowest-scored are archived,
 *      except AI Trivia (TRIVIA_POOL_CAP) and Real or AI? (ROA_POOL_CAP), whose over-cap rows move to their own archive tables;
 *      never one a person pinned or dragged; ideas a person archived do not count
 *
 * Archive, not delete (Tommy, 2026-11-16: "Yes, archive them"): steps 3 to 5 stamp `archived_at` and why. A row the
 * refresh itself archived (stale, not-returned, over-cap) is reopened when the intake returns it again, as a deleted
 * row used to be re-inserted. A person's Archive lives in social_hub.idea_adjustments, not here: it keeps the idea out
 * of the hub's list (dayRanking), the build's order (inQueueOrder) and openPool whatever this row says. An archived
 * row is never offered to a build (openPool) and never counts toward the cap. Until db/stories_pool_archive.sql is
 * applied the column is missing and the rows are deleted as before. `upserted` counts the rows actually written.
 */
export async function writePool(db: Queryable, gathered: { items: PoolItem[]; refreshed: Series[] }, now: Date): Promise<{ upserted: number; dropped: number }> {
  const { items, refreshed } = gathered;
  const archive = await hasArchiveColumn(db);
  let upserted = 0;
  for (const item of items) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, refreshed_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)
       ON CONFLICT (series, key) DO UPDATE SET
         origin = EXCLUDED.origin, ref = EXCLUDED.ref, title = EXCLUDED.title,
         payload = EXCLUDED.payload, score = EXCLUDED.score, refreshed_at = EXCLUDED.refreshed_at,
         used_at = CASE WHEN stories.pool.series = 'morning_download' THEN NULL ELSE stories.pool.used_at END${archive ? `,
         archived_at = NULL, archived_reason = NULL` : ''}
       WHERE ${archive ? `(stories.pool.archived_at IS NULL OR stories.pool.archived_reason IN (${REFRESH_ARCHIVE_REASONS.map((r) => `'${r}'`).join(', ')})) AND ` : ''}(stories.pool.used_at IS NULL OR stories.pool.series = 'morning_download')
       RETURNING id`,
      [item.series, item.key, item.origin, item.ref, item.title, JSON.stringify(item.payload), item.score, now.toISOString()],
    );
    upserted += rows.length;
  }
  await db.query(
    `UPDATE stories.pool p SET used_at = $1::timestamptz
      WHERE p.used_at IS NULL AND p.series <> 'morning_download'
        AND EXISTS (SELECT 1 FROM stories.history h WHERE h.series = p.series AND (h.key = p.key OR h.key = p.payload->>'story_key'))`,
    [now.toISOString()],
  );
  let dropped = 0;
  for (const series of POOL_SERIES) {
    const cutoff = new Date(now.getTime() - FRESH_MS[series]).toISOString();
    const keys = refreshed.includes(series) ? items.filter((i) => i.series === series).map((i) => i.key) : null;
    const stale = `series = $1 AND used_at IS NULL
          AND key NOT LIKE 'seed:%' AND key NOT LIKE 'trivia:%' AND key NOT LIKE 'roa:%'
          AND COALESCE(payload->>'seed', 'false') <> 'true'
          AND (refreshed_at < $2::timestamptz OR ($3::text[] IS NOT NULL AND NOT (key = ANY($3::text[]))))`;
    const { rows } = archive
      ? await db.query<{ id: string }>(
        `UPDATE stories.pool SET archived_at = $4::timestamptz,
                archived_reason = CASE WHEN refreshed_at < $2::timestamptz THEN 'stale' ELSE 'not-returned' END
          WHERE archived_at IS NULL AND ${stale}
          RETURNING id`,
        [series, cutoff, keys, now.toISOString()],
      )
      : await db.query<{ id: string }>(`DELETE FROM stories.pool WHERE ${stale} RETURNING id`, [series, cutoff, keys]);
    dropped += rows.length;
    dropped +=
      series === 'ai_trivia' ? (await capTriviaPool(db, now)).length
      : series === ROA_SERIES ? (await capRoaPool(db, now)).length
      : await capSeries(db, series, archive ? now : null);
  }
  return { upserted, dropped };
}

/**
 * Hold AI Trivia's open questions to two caps (AT-11, whether or not the shared queue is live), each by score: the unused
 * bank to TRIVIA_POOL_CAP and the questions the game already served to TRIVIA_SERVED_CAP, so served questions never
 * crowd out the ones the game can still play. Every question dropped goes to stories.trivia_archive (reason 'cap'), where
 * the repeat check still sees it. Returns the dropped keys. Without the moves table it caps on score alone.
 */
export async function capTriviaPool(db: Queryable, now: Date = new Date()): Promise<string[]> {
  const ranked = (exempt: string) => `
    SELECT r.id FROM (
      SELECT p2.id, (p2.key IN (${TRIVIA_GAME_KEYS})) AS served,
             row_number() OVER (PARTITION BY (p2.key IN (${TRIVIA_GAME_KEYS})) ORDER BY p2.score DESC NULLS LAST, p2.title) AS n
        FROM stories.pool p2
       WHERE p2.series = 'ai_trivia' AND p2.used_at IS NULL ${exempt}
    ) r WHERE r.n > CASE WHEN r.served THEN $2::int ELSE $1::int END`;
  let dropped: Dropped[];
  try {
    const { rows } = await db.query<Dropped>(
      `DELETE FROM stories.pool p
        WHERE p.series = 'ai_trivia' AND p.used_at IS NULL AND p.key NOT LIKE 'seed:%' AND COALESCE(p.payload->>'seed', 'false') <> 'true'
          AND p.id IN (${ranked(`AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a WHERE a.vertical = $3 AND a.kind = 'archive' AND a.idea_id = 'stories:pool:' || p2.series || ':' || p2.key)`)})
          AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a
                           WHERE a.vertical = $3 AND a.consumed_at IS NULL AND a.kind IN ('pin', 'promote', 'place')
                             AND a.idea_id = 'stories:pool:' || p.series || ':' || p.key)
        RETURNING p.key, p.payload`,
      [TRIVIA_POOL_CAP, TRIVIA_SERVED_CAP, verticalOfSeries('ai_trivia')],
    );
    dropped = rows;
  } catch {
    const { rows } = await db.query<Dropped>(
      `DELETE FROM stories.pool p
        WHERE p.series = 'ai_trivia' AND p.used_at IS NULL AND p.key NOT LIKE 'seed:%' AND COALESCE(p.payload->>'seed', 'false') <> 'true'
          AND p.id IN (${ranked('')}) RETURNING p.key, p.payload`,
      [TRIVIA_POOL_CAP, TRIVIA_SERVED_CAP],
    );
    dropped = rows;
  }
  for (const { key, payload } of dropped) {
    if (!key.startsWith(TRIVIA_KEY_PREFIX)) continue;
    const cellId = cellOfKey(key);
    await db.query(`INSERT INTO stories.trivia_archive (key, cell_id, payload, reason, archived_at) VALUES ($1, $2, $3::jsonb, 'cap', $4::timestamptz)`, [key, cellId, JSON.stringify(payload ?? {}), now.toISOString()]);
  }
  return dropped.map((d) => d.key);
}

/**
 * Hold Real or AI? to ROA_POOL_CAP by difficulty (the row's score), whether or not the shared queue is live: every image
 * it drops goes to stories.roa_archive (reason 'cap'). Returns the dropped keys. Without the moves table it caps on
 * difficulty alone.
 */
export async function capRoaPool(db: Queryable, now: Date = new Date()): Promise<string[]> {
  let dropped: Dropped[];
  try {
    dropped = await capDeleting(db, ROA_SERIES, ROA_POOL_CAP);
  } catch {
    const { rows } = await db.query<Dropped>(
      `DELETE FROM stories.pool p
        WHERE p.series = $1 AND p.used_at IS NULL AND p.key NOT LIKE 'seed:%' AND COALESCE(p.payload->>'seed', 'false') <> 'true'
          AND p.id IN (SELECT r.id FROM (SELECT p2.id, row_number() OVER (ORDER BY p2.score DESC NULLS LAST, p2.title) AS n
                         FROM stories.pool p2 WHERE p2.series = $1 AND p2.used_at IS NULL) r WHERE r.n > $2)
        RETURNING p.key, p.payload`,
      [ROA_SERIES, ROA_POOL_CAP],
    );
    dropped = rows;
  }
  for (const { key, payload } of dropped) if (key.startsWith(ROA_KEY_PREFIX)) await archiveRoa(db, key, payload, 'cap', now);
  return dropped.map((d) => d.key);
}

/** Why a Real or AI? candidate left: the cap, the Jev screen (or nothing to teach), or provenance failing at build. */
export type RoaArchiveReason = 'cap' | 'screen' | 'provenance';

/** One row in stories.roa_archive (CONTRACT.md §2). */
export async function archiveRoa(db: Queryable, key: string, payload: unknown, reason: RoaArchiveReason, now: Date = new Date()): Promise<void> {
  await db.query(`INSERT INTO stories.roa_archive (key, payload, reason, archived_at) VALUES ($1, $2::jsonb, $3, $4::timestamptz)`, [key, JSON.stringify(payload ?? {}), reason, now.toISOString()]);
}

type Dropped = { key: string; payload: unknown };

/**
 * Hold AI Trivia or Real or AI? to its own cap by deleting the rows past it and returning them (key and payload), so the
 * caller can file them in the type's archive table. Throws when the moves table is missing (the callers fall back).
 */
async function capDeleting(db: Queryable, series: Series, cap: number): Promise<Dropped[]> {
  // The hub files a series' moves under its type (SS-21).
  const vertical = verticalOfSeries(series);
  const { rows } = await db.query<Dropped>(
    `DELETE FROM stories.pool p
      WHERE p.series = $1 AND p.used_at IS NULL AND p.key NOT LIKE 'seed:%' AND COALESCE(p.payload->>'seed', 'false') <> 'true'
        AND p.id IN (
          SELECT r.id FROM (
            SELECT p2.id, row_number() OVER (ORDER BY p2.score DESC NULLS LAST, p2.title) AS n
              FROM stories.pool p2
             WHERE p2.series = $1 AND p2.used_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a WHERE a.vertical = $3 AND a.kind = 'archive' AND a.idea_id = 'stories:pool:' || p2.series || ':' || p2.key)
          ) r WHERE r.n > $2)
        AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a
                         WHERE a.vertical = $3 AND a.consumed_at IS NULL AND a.kind IN ('pin', 'promote', 'place')
                           AND a.idea_id = 'stories:pool:' || p.series || ':' || p.key)
      RETURNING p.key, p.payload`,
    [series, cap, vertical],
  );
  return rows;
}

/** Why the refresh itself archives a row (writePool, capSeries): only these come back when the intake returns the idea. */
export const REFRESH_ARCHIVE_REASONS = ['stale', 'not-returned', 'over-cap'] as const;

/** Whether stories.pool has the archive column yet (db/stories_pool_archive.sql). */
export async function hasArchiveColumn(db: Queryable): Promise<boolean> {
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'stories' AND table_name = 'pool' AND column_name = 'archived_at'`,
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Hold one series to the pool standard's cap: the open ideas past it are archived (`archiveAt`), or deleted on a database
 * without the archive column (`archiveAt` null). Rows already archived, by the refresh or by a person, never count.
 * Never throws: a database without the moves table keeps its pool as it is.
 */
async function capSeries(db: Queryable, series: Series, archiveAt: Date | null): Promise<number> {
  // The hub files a series' moves under its type (SS-21).
  const vertical = verticalOfSeries(series);
  const live = archiveAt ? 'AND p2.archived_at IS NULL' : '';
  const v = archiveAt ? '$4' : '$3';
  const over = `p.series = $1 AND p.used_at IS NULL AND p.key NOT LIKE 'seed:%' AND COALESCE(p.payload->>'seed', 'false') <> 'true'
          AND p.id IN (
            SELECT r.id FROM (
              SELECT p2.id, row_number() OVER (ORDER BY p2.score DESC NULLS LAST, p2.title) AS n
                FROM stories.pool p2
               WHERE p2.series = $1 AND p2.used_at IS NULL ${live}
                 AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a WHERE a.vertical = ${v} AND a.kind = 'archive' AND a.idea_id = 'stories:pool:' || p2.series || ':' || p2.key)
            ) r WHERE r.n > $2)
          AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a
                           WHERE a.vertical = ${v} AND a.consumed_at IS NULL AND a.kind IN ('pin', 'promote', 'place')
                             AND a.idea_id = 'stories:pool:' || p.series || ':' || p.key)`;
  try {
    const { rows } = archiveAt
      ? await db.query<{ id: string }>(
        `UPDATE stories.pool p SET archived_at = $3::timestamptz, archived_reason = 'over-cap' WHERE p.archived_at IS NULL AND ${over} RETURNING p.id`,
        [series, POOL_CAP, archiveAt.toISOString(), vertical],
      )
      : await db.query<{ id: string }>(`DELETE FROM stories.pool p WHERE ${over} RETURNING p.id`, [series, POOL_CAP, vertical]);
    return rows.length;
  } catch {
    return 0;
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
  /** Real or AI?'s open images, hardest first (absent on a pool built by hand). */
  roa?: RoaPoolPayload[];
  /** Each list's entries' pool key and score, in the same order (set by openPool; a pool built by hand may omit it). */
  meta?: { stories: PoolMeta[]; leads: PoolMeta[]; trivia?: PoolMeta[]; roa?: PoolMeta[] };
};

/**
 * One series' open ideas, best first: what its build chooses from. Archived rows are never offered: neither one the
 * refresh archived nor one a person archived (social_hub.idea_adjustments, the hub's `stories:pool:<series>:<key>` id).
 * A database without the moves table reads the pool without that check.
 */
export async function openPool(db: Queryable, series: Series): Promise<OpenPool> {
  const live = (await hasArchiveColumn(db)) ? 'AND p.archived_at IS NULL' : '';
  type Row = { key: string; score: string | number | null; payload: PoolItem['payload'] };
  const read = (personal: string, extra: unknown[]) => db.query<Row>(
    `SELECT p.key, p.score, p.payload FROM stories.pool p WHERE p.series = $1 AND p.used_at IS NULL ${live} ${personal} ORDER BY p.score DESC NULLS LAST, p.title`,
    [series, ...extra],
  );
  const { rows } = await read(
    `AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a WHERE a.vertical = $2 AND a.kind = 'archive' AND a.idea_id = 'stories:pool:' || p.series || ':' || p.key)`,
    [verticalOfSeries(series)],
  ).catch(() => read('', []));
  const out = {
    stories: [] as StoryCandidate[], leads: [] as ToolLead[], trivia: [] as TriviaPoolPayload[], roa: [] as RoaPoolPayload[],
    meta: { stories: [] as PoolMeta[], leads: [] as PoolMeta[], trivia: [] as PoolMeta[], roa: [] as PoolMeta[] },
  };
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
    } else if (p?.kind === 'roa' && p.c) {
      out.roa.push(p);
      out.meta.roa.push(meta);
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
