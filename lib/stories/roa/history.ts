/**
 * What Real or AI? has already shown or seen (CONTRACT.md §3: an image key is
 * never in a published set). Read only from the series' own rows:
 *
 *   readRoaHistory   image keys in built real_or_ai sets (payload.roa.rounds): published ones for good, live ones
 *                    (ready, approved, scheduled, publishing) too, so the next post day never repeats a set waiting to go out
 *   readRoaKnown     image keys, source URLs and recent specs in the pool (any state) and the archive, so the daily run
 *                    never fetches, screens or pays for the same image twice
 *
 * CLAUDE.md rule 2: nothing is swept; these are lookups.
 */
import type { Queryable } from '@/lib/stories/db';

import { ROA_SERIES, type Provenance, type RoaRound } from './types';
import { bareImageKey } from './validate';

const LIVE = ['ready', 'approved', 'scheduled', 'publishing'];
/** How many recent specs the writer sees, to vary from. */
export const RECENT_SPECS = 30;

export type RoaHistory = { usedKeys: Set<string> };

export async function readRoaHistory(db: Queryable, opts: { excludeSetId?: string | null } = {}): Promise<RoaHistory> {
  const { rows } = await db.query<{ rounds: RoaRound[] | null }>(
    `SELECT payload->'roa'->'rounds' AS rounds FROM stories.sets
      WHERE series = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
        AND jsonb_typeof(payload->'roa'->'rounds') = 'array'
        AND (status = 'published' OR status = ANY($3::text[]))`,
    [ROA_SERIES, opts.excludeSetId ?? null, LIVE],
  );
  const usedKeys = new Set<string>();
  for (const r of rows) for (const round of Array.isArray(r.rounds) ? r.rounds : []) if (round?.key) usedKeys.add(bareImageKey(round.key));
  return { usedKeys };
}

export type RoaKnown = { keys: Set<string>; urls: Set<string>; recent: string[] };

type Row = { key: string; prov: Provenance | null; words: string | null; at: string | Date | null };

export async function readRoaKnown(db: Queryable): Promise<RoaKnown> {
  const pool = await db.query<Row>(
    `SELECT key, payload->'c'->'provenance' AS prov, payload->>'specText' AS words, refreshed_at AS at
       FROM stories.pool WHERE series = $1 AND key LIKE 'roa:%'`,
    [ROA_SERIES],
  );
  let archived: Row[] = [];
  try {
    archived = (await db.query<Row>(`SELECT key, payload->'c'->'provenance' AS prov, payload->>'specText' AS words, archived_at AS at FROM stories.roa_archive`)).rows;
  } catch {
    // No archive table yet (schema not applied): the pool alone.
  }
  const keys = new Set<string>();
  const urls = new Set<string>();
  const specs: Array<{ words: string; at: number }> = [];
  for (const r of [...pool.rows, ...archived]) {
    keys.add(bareImageKey(r.key));
    const p = r.prov;
    if (p && 'url' in p && typeof p.url === 'string') urls.add(p.url);
    // SS-23: the image URL a real photo was downloaded from, so the next run never fetches it again.
    if (p && 'src' in p && typeof p.src === 'string') urls.add(p.src);
    if (r.words) specs.push({ words: r.words, at: r.at ? new Date(r.at).getTime() : 0 });
  }
  const recent = [...new Set(specs.sort((a, b) => b.at - a.at).map((s) => s.words))].slice(0, RECENT_SPECS);
  return { keys, urls, recent };
}
