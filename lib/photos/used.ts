/**
 * The one used-photo ledger (CI-32). A photo published by any post, of any content type, can't be used again by any
 * post for 20 days. "Used" means published: rows are written when a post goes out (the app's own publish, or the
 * nightly Instagram read in ./ig-sync.ts), never when a post is built. Matched by URL and by perceptual hash (DCT
 * pHash from the harvest, and the photo bank's dHash), so a resized copy or another URL for the same picture counts.
 * Brand assets (logos, meme templates, AI Drama character cutouts) are exempt and never logged.
 *
 * The ledger lives in social.used_photos. Its new columns (phash, dhash, vertical, media_id) come from
 * db/social_used_photos_v2.sql; until that file is applied the reader falls back to URL-only rows.
 *
 * CONTRACT (frozen for the CI-32 build): every picker reads `readUsedLedger` and refuses what `usedMatch` names;
 * every publish path writes through `recordUsedPhotos`.
 *
 * Bald-Eagle D3 (the photo hold): `readUsedLedger` also holds the photos of every item that is built but not yet
 * posted, of any type (./pending.ts), so two items waiting for review never share a picture. An item rebuilding or
 * re-rendering its own photos passes `excludeItem`, so its own picks don't block it. Nothing is written for them.
 */
import type { Query } from '@/lib/social/store/pg';

export {
  EMPTY_LEDGER,
  USED_PHOTO_DAYS,
  isBrandAsset,
  ledgerStoryId,
  mediaLibraryKey,
  usedMatch,
  type UsedLedger,
  type UsedPhotoEntry,
  type UsedVertical,
} from './used-match';
import { EMPTY_LEDGER, USED_PHOTO_DAYS, isBrandAsset, ledgerStoryId, type UsedLedger, type UsedPhotoEntry, type UsedVertical } from './used-match';

/**
 * Rows that mean "published". Rows from before CI-32 count only when a publish path wrote them (`lfd:` and
 * `stories:` story ids); the carousel pipeline's old build-time rows don't.
 */
const PUBLISHED_ROWS = `(vertical IS NOT NULL OR story_id LIKE 'lfd:%' OR story_id LIKE 'stories:%')`;
const LEGACY_ROWS = `(story_id LIKE 'lfd:%' OR story_id LIKE 'stories:%')`;

const isMissingColumn = (err: unknown) => (err as { code?: string } | null)?.code === '42703';

/**
 * Options for a ledger read (Bald-Eagle D3). `excludeItem`: the item being rebuilt (or the waiting items a remake
 * replaces), whose own photos don't count.
 */
export type LedgerReadOptions = { excludeItem?: { vertical: string; id: string } | readonly { vertical: string; id: string }[] | null };

/**
 * The ledger as of `now`: photos published in the last `days` days, plus the photos of every item built in that
 * window and still waiting to post (Bald-Eagle D3, ./pending.ts), except `excludeItem`'s own.
 */
export async function readUsedLedger(query: Query, now: Date, days = USED_PHOTO_DAYS, opts: LedgerReadOptions = {}): Promise<UsedLedger> {
  const published = await readPublishedLedger(query, now, days);
  const { pendingPhotos } = await import('./pending');
  return mergeLedgers(published, await pendingPhotos(query, now, { days, excludeItem: opts.excludeItem ?? null }));
}

/** Both ledgers in one: every URL, every hash once. */
export function mergeLedgers(a: UsedLedger, b: UsedLedger): UsedLedger {
  if (!b.urls.size && !b.phashes.length && !b.dhashes.length) return a;
  return {
    urls: new Set([...a.urls, ...b.urls]),
    phashes: [...new Set([...a.phashes, ...b.phashes])],
    dhashes: [...new Set([...a.dhashes, ...b.dhashes])],
    pendingUrls: new Set([...(a.pendingUrls ?? []), ...[...b.urls].filter((u) => !a.urls.has(u))]),
  };
}

/** Photos published in the last `days` days only (the CI-32 rule, without the waiting items). */
export async function readPublishedLedger(query: Query, now: Date, days = USED_PHOTO_DAYS): Promise<UsedLedger> {
  const params = [now.toISOString(), days];
  let rows: Array<{ url: string | null; phash?: string | null; dhash?: string | null }>;
  try {
    ({ rows } = await query(
      `SELECT url, phash, dhash FROM social.used_photos
        WHERE used_at <= $1 AND used_at > $1::timestamptz - make_interval(days => $2) AND ${PUBLISHED_ROWS}`,
      params,
    ));
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    ({ rows } = await query(
      `SELECT url FROM social.used_photos
        WHERE used_at <= $1 AND used_at > $1::timestamptz - make_interval(days => $2) AND ${LEGACY_ROWS}`,
      params,
    ));
  }
  const urls = new Set<string>();
  const phashes: string[] = [];
  const dhashes: string[] = [];
  for (const r of rows) {
    if (r.url) urls.add(r.url);
    if (r.phash) phashes.push(r.phash);
    if (r.dhash) dhashes.push(r.dhash);
  }
  return { urls, phashes, dhashes };
}

/** Hashing an image lives in ./used-hash.ts (server only: it loads sharp). */

/** True when the ledger already holds rows for this post (a post is logged once). */
export async function postLogged(query: Query, vertical: UsedVertical, postId: string): Promise<boolean> {
  const { rows } = await query(`SELECT 1 FROM social.used_photos WHERE story_id = $1 LIMIT 1`, [ledgerStoryId(vertical, postId)]);
  return rows.length > 0;
}

/**
 * Writes published photos. Brand assets must already be filtered out by the caller. Falls back to the pre-CI-32
 * columns when the migration isn't applied yet. Returns the rows offered.
 */
export async function recordUsedPhotos(query: Query, entries: readonly UsedPhotoEntry[]): Promise<number> {
  let legacy = false;
  for (const e of entries) {
    const base = [e.url, e.usedAt.toISOString(), ledgerStoryId(e.vertical, e.postId), e.slide, e.source ?? null, e.qid ?? null, e.subject ?? null, e.credit ?? null, e.scene ?? null];
    if (!legacy) {
      try {
        await query(
          `INSERT INTO social.used_photos (url, used_at, story_id, slide, source, qid, subject, credit, scene, vertical, media_id, phash, dhash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (url, used_at, story_id, slide) DO NOTHING`,
          [...base, e.vertical, e.mediaId ?? null, e.phash ?? null, e.dhash ?? null],
        );
        continue;
      } catch (err) {
        if (!isMissingColumn(err)) throw err;
        legacy = true;
      }
    }
    await query(
      `INSERT INTO social.used_photos (url, used_at, story_id, slide, source, qid, subject, credit, scene)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (url, used_at, story_id, slide) DO NOTHING`,
      base,
    );
  }
  return entries.length;
}
