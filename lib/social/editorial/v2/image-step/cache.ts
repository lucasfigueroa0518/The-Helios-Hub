/**
 * helios_social.image_cache read/write.
 *
 * One row per Wikidata entity. 30-day TTL — after that, re-resolve and
 * re-choose so newer/better Commons files can win.
 *
 * Never sweeps the DB (CLAUDE.md Rule 2 — DB is a lookup source). Reads
 * are primary-key lookups; writes only happen when the image step has
 * just picked a new image for a subject.
 */

import { dbQuery } from '@/lib/db';

export const CACHE_TTL_DAYS = 30;

export type ImageCacheRow = {
  wikidataId: string;
  subject: string;
  commonsFile: string;
  storagePath: string;
  storageUrl: string;
  license: string;
  licenseUrl: string | null;
  author: string;
  credit: string;
  width: number;
  height: number;
  isPortrait: boolean;
  chosenAt: Date;
};

/** Row shape returned by pg. Snake case → camelCase mapping below. */
type RawRow = {
  wikidata_id: string;
  subject: string;
  commons_file: string;
  storage_path: string;
  storage_url: string;
  license: string;
  license_url: string | null;
  author: string;
  credit: string;
  width: number;
  height: number;
  is_portrait: boolean;
  chosen_at: Date;
};

function fromRow(row: RawRow): ImageCacheRow {
  return {
    wikidataId: row.wikidata_id,
    subject: row.subject,
    commonsFile: row.commons_file,
    storagePath: row.storage_path,
    storageUrl: row.storage_url,
    license: row.license,
    licenseUrl: row.license_url,
    author: row.author,
    credit: row.credit,
    width: row.width,
    height: row.height,
    isPortrait: row.is_portrait,
    chosenAt: row.chosen_at,
  };
}

/**
 * Look up a cached image by Wikidata Q-id. Returns null on miss OR when
 * the cached row is older than CACHE_TTL_DAYS.
 */
export async function getCachedImage(wikidataId: string): Promise<ImageCacheRow | null> {
  const { rows } = await dbQuery<RawRow>(
    `SELECT wikidata_id, subject, commons_file, storage_path, storage_url,
            license, license_url, author, credit, width, height, is_portrait,
            chosen_at
       FROM helios_social.image_cache
      WHERE wikidata_id = $1
        AND chosen_at > now() - ($2 || ' days')::interval`,
    [wikidataId, String(CACHE_TTL_DAYS)],
  );
  const row = rows[0];
  return row ? fromRow(row) : null;
}

/**
 * Upsert a fresh image cache row. Called after the storage upload has
 * succeeded so the cached URL is always valid.
 */
export async function putCachedImage(row: Omit<ImageCacheRow, 'chosenAt'>): Promise<void> {
  // Test-run safety: --no-persist sets HELIOS_V2_NO_STORAGE_UPLOAD=1 in
  // the test runner. When set, skip the DB write to helios_social.image_cache
  // — same reason as storage.ts: test runs must not touch the prod DB.
  if (process.env.HELIOS_V2_NO_STORAGE_UPLOAD === '1') return;
  await dbQuery(
    `INSERT INTO helios_social.image_cache
       (wikidata_id, subject, commons_file, storage_path, storage_url,
        license, license_url, author, credit, width, height, is_portrait,
        chosen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
     ON CONFLICT (wikidata_id) DO UPDATE SET
       subject      = EXCLUDED.subject,
       commons_file = EXCLUDED.commons_file,
       storage_path = EXCLUDED.storage_path,
       storage_url  = EXCLUDED.storage_url,
       license      = EXCLUDED.license,
       license_url  = EXCLUDED.license_url,
       author       = EXCLUDED.author,
       credit       = EXCLUDED.credit,
       width        = EXCLUDED.width,
       height       = EXCLUDED.height,
       is_portrait  = EXCLUDED.is_portrait,
       chosen_at    = now()`,
    [
      row.wikidataId, row.subject, row.commonsFile, row.storagePath, row.storageUrl,
      row.license, row.licenseUrl, row.author, row.credit, row.width, row.height,
      row.isPortrait,
    ],
  );
}
