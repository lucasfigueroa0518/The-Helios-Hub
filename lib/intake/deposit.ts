/**
 * B6 Claude web search finds → the intake (lib/intake/types.ts DepositFind).
 * The one inbound link from Reels: its nightly web search (its own ideation,
 * exempt) deposits each find here like a seed. The find is stored ungrouped;
 * the next intake run groups and scores it. One insert, no Jev, no fetch.
 */
import { canonicalizeUrl } from '@/lib/reels/net/http';
import type { AdapterItem } from '@/lib/reels/types';

import type { DepositFind } from './types';

export const SEARCH_SOURCE_ID = 'search:b6';

/** Who deposits: B6 Claude web search (default) or A4 awesome lists. Both are family 'search'. */
export type DepositSource = { sourceId: string; sourceName: string; sourceType: 'B6' | 'A4' };
export const B6_DEPOSIT: DepositSource = { sourceId: SEARCH_SOURCE_ID, sourceName: 'Claude web search', sourceType: 'B6' };
export const A4_DEPOSIT: DepositSource = { sourceId: 'search:a4', sourceName: 'Awesome lists', sourceType: 'A4' };

export const depositFind: DepositFind = (q, item, now) => depositFindAs(q, item, now, B6_DEPOSIT);

export async function depositFindAs(
  q: Parameters<DepositFind>[0],
  item: AdapterItem,
  now: Date,
  source: DepositSource,
): Promise<{ key: string; created: boolean }> {
  const key = canonicalizeUrl(item.canonicalUrl);
  const { rows } = await q.query<{ inserted: boolean }>(
    `INSERT INTO intake.items
       (key, family, source_id, source_name, source_type, headline, body, url, author, byline,
        publish_time, first_seen_at, last_seen_at, engagement, media_urls, citation_urls)
     VALUES ($1, 'search', $2, $12, $13, $3, $4, $5, $6, $7, $8, $9, $9, NULL, $10::text[], $11::text[])
     ON CONFLICT (key) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
     RETURNING (xmax = 0) AS inserted`,
    [
      key,
      source.sourceId,
      item.headline,
      item.body ?? '',
      item.canonicalUrl,
      item.author ?? null,
      item.byline ?? null,
      item.publishTime ?? null,
      now,
      item.mediaUrls ?? [],
      item.citationUrls ?? [],
      source.sourceName,
      source.sourceType,
    ],
  );
  return { key, created: rows[0]?.inserted === true };
}

/** Deposit a batch of finds; a failure only logs and never breaks the caller (the reels run). */
export async function depositFindsQuietly(
  items: readonly AdapterItem[],
  now: Date,
  source: DepositSource = B6_DEPOSIT,
  log: (line: string) => void = console.warn,
): Promise<void> {
  try {
    const { dbQuery } = await import('@/lib/db');
    const q = { query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await dbQuery(text, params)).rows as T[] }) };
    for (const item of items) {
      try {
        await depositFindAs(q, item, now, source);
      } catch (error) {
        log(`[intake] depositFind failed for "${item.headline}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    log(`[intake] depositFind unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}
