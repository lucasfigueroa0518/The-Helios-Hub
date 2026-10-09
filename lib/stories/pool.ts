/**
 * The Stories idea pool. Each series keeps an open, ranked list, refreshed
 * from the pools it draws on (reels, carousels, catalog). Used ideas stay
 * used. Anything the latest refresh did not bring back leaves, the same way
 * a reels slate replaces the night before.
 *
 * This pass only reads those pools. It does not score with a model.
 */
import type { Queryable } from '@/lib/stories/db';
import type { Series } from '@/lib/stories/render/types';
import { morningDownloadCarousel } from '@/lib/stories/sources/carousel';
import { freeToolLeads, morningDownloadReels, storyKey, theNumberIdeas, type StoryCandidate } from '@/lib/stories/sources/reels';

export type PoolItem = {
  series: Series;
  key: string;
  origin: 'reels' | 'carousel' | 'catalog' | 'github' | 'generated';
  ref: string;
  title: string;
  payload: Record<string, unknown>;
  score: number | null;
};

const FRESH_MS: Record<Series, number> = {
  morning_download: 3 * 86_400_000,
  guess_the_number: 7 * 86_400_000,
  free_vs_paid: 14 * 86_400_000,
};

export async function refreshStoryPool(db: Queryable, sourceDb: Queryable, now: Date): Promise<{ upserted: number }> {
  const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  const { items, refreshed } = await gather(sourceDb, ny, now);
  let upserted = 0;
  for (const item of items) {
    await db.query(
      `INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, refreshed_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, now())
       ON CONFLICT (series, key) DO UPDATE SET
         origin = EXCLUDED.origin,
         ref = EXCLUDED.ref,
         title = EXCLUDED.title,
         payload = EXCLUDED.payload,
         score = COALESCE(EXCLUDED.score, stories.pool.score),
         refreshed_at = now()
       WHERE stories.pool.used_at IS NULL`,
      [item.series, item.key, item.origin, item.ref, item.title, JSON.stringify(item.payload), item.score],
    );
    upserted++;
  }
  await db.query(
    `UPDATE stories.pool p SET used_at = now()
      WHERE p.used_at IS NULL
        AND EXISTS (SELECT 1 FROM stories.history h WHERE h.series = p.series AND h.key = p.key)`,
  );
  for (const series of refreshed) {
    const keys = items.filter((i) => i.series === series).map((i) => i.key);
    const cutoff = new Date(now.getTime() - FRESH_MS[series]).toISOString();
    await db.query(
      `DELETE FROM stories.pool WHERE series = $1 AND used_at IS NULL AND (NOT (key = ANY($2::text[])) OR refreshed_at < $3::timestamptz)`,
      [series, keys, cutoff],
    );
  }
  return { upserted };
}

/** A build's scored candidates join the pool. Chosen ones are marked used. */
export async function absorbBuildCandidates(
  db: Queryable,
  series: Series,
  candidates: Array<{ origin: PoolItem['origin']; ref: string; payload?: Record<string, unknown>; score?: number | null; chosen?: boolean }>,
): Promise<void> {
  for (const c of candidates) {
    const payload = c.payload ?? {};
    const title = text(payload.headline) ?? text(payload.question) ?? text(payload.paid_tool) ?? text(payload.name) ?? c.ref;
    const key = text(payload.url) ? storyKey(text(payload.url)!) : c.ref;
    await db.query(
      `INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, refreshed_at, used_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, now(), CASE WHEN $8 THEN now() ELSE NULL END)
       ON CONFLICT (series, key) DO UPDATE SET
         title = EXCLUDED.title,
         payload = EXCLUDED.payload,
         score = GREATEST(COALESCE(stories.pool.score, EXCLUDED.score), COALESCE(EXCLUDED.score, stories.pool.score)),
         refreshed_at = now(),
         used_at = COALESCE(stories.pool.used_at, EXCLUDED.used_at)`,
      [series, key, c.origin, c.ref, title, JSON.stringify(payload), c.score ?? null, Boolean(c.chosen)],
    );
  }
}

async function gather(sourceDb: Queryable, ny: string, now: Date): Promise<PoolItem[]> {
  const out: PoolItem[] = [];
  const safe = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch {
      // One source being unread leaves the others. A refresh never fails the night.
    }
  };
  await safe(async () => {
    const [reels, carousel] = await Promise.all([morningDownloadReels(sourceDb, ny), morningDownloadCarousel(sourceDb, now)]);
    for (const c of [...reels, ...carousel]) out.push(fromStory('morning_download', c));
  });
  await safe(async () => {
    for (const c of await theNumberIdeas(sourceDb, ny)) out.push(fromStory('guess_the_number', c));
  });
  await safe(async () => {
    for (const lead of await freeToolLeads(sourceDb, ny)) {
      out.push({
        series: 'free_vs_paid',
        key: storyKey(lead.url),
        origin: lead.origin,
        ref: lead.ref,
        title: lead.name,
        payload: { name: lead.name, url: lead.url, description: lead.description },
        score: null,
      });
    }
  });
  return out;
}

function fromStory(series: Series, c: StoryCandidate): PoolItem {
  return {
    series,
    key: c.key,
    origin: c.origin,
    ref: c.ref,
    title: c.headline,
    payload: { headline: c.headline, url: c.url, source: c.sourceName },
    score: c.nativeScore,
  };
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
