import { dbQuery } from '@/lib/db';
import type { Adapter } from '@/lib/reels/types';

/**
 * D-264. A source that stops producing usually does it quietly: the feed
 * moves, starts answering 200 with nothing in it, or blocks the worker so
 * every article drops. The fetch never throws, so the night still reads ok.
 * This names each watched source with nothing kept for its window.
 */

export type SourceActivity = {
  /** Newest item from this source that entered the pool. */
  lastKept: Date | null;
  /** Oldest row of any kind from this source, kept or dropped. */
  firstSeen: Date | null;
};

const DAY_MS = 86_400_000;

/** Pure. Names of watched adapters with nothing kept for `quietAfterDays`. */
export function quietSources(
  adapters: readonly Adapter[],
  activity: ReadonlyMap<string, SourceActivity>,
  now: Date,
): string[] {
  const quiet: string[] = [];
  for (const adapter of adapters) {
    const days = adapter.quietAfterDays;
    if (days == null) continue;
    const seen = activity.get(adapter.id);
    // A source with no history yet has nothing to compare against.
    const since = seen?.lastKept ?? seen?.firstSeen ?? null;
    if (since == null) continue;
    if (now.getTime() - since.getTime() >= days * DAY_MS) quiet.push(adapter.name);
  }
  return quiet;
}

export function quietSourcesNote(names: readonly string[]): string | undefined {
  if (names.length === 0) return undefined;
  return `No new stories kept from ${names.join(', ')} in their watch window; check the feed.`;
}

export async function loadSourceActivity(adapterIds: readonly string[]): Promise<Map<string, SourceActivity>> {
  const { rows } = await dbQuery<{ adapter_id: string; last_kept: string | null; first_seen: string | null }>(
    `SELECT adapter_id,
            max(ingest_time) FILTER (WHERE drop_reason IS NULL) AS last_kept,
            min(ingest_time) AS first_seen
       FROM reels.sources
      WHERE adapter_id = ANY($1)
      GROUP BY adapter_id`,
    [adapterIds],
  );
  return new Map(
    rows.map((row) => [
      row.adapter_id,
      {
        lastKept: row.last_kept ? new Date(row.last_kept) : null,
        firstSeen: row.first_seen ? new Date(row.first_seen) : null,
      },
    ]),
  );
}
