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
 */
import type { Query } from '@/lib/social/store/pg';
import { hamming, NEAR_DUPLICATE } from './hash-distance';

/** How long a published photo stays off limits, for every content type. */
export const USED_PHOTO_DAYS = 20;

/** The content types whose published posts carry photos. Story ids in the ledger are `<vertical>:<post id>`. */
export type UsedVertical = 'lfd' | 'stories' | 'carousels' | 'reel_ai_drama' | 'field_notes' | 'ai_events';

/** Ledger key for a photo-bank photo that has no web URL (Field Notes team photos). */
export const mediaLibraryKey = (photoId: string) => `media-library:${photoId}`;

/** Photo kinds that are brand assets: exempt from the rule, never logged. */
const BRAND_KINDS = new Set(['logo', 'meme', 'template', 'meme_template', 'cutout', 'character']);
export const isBrandAsset = (kind: string | null | undefined): boolean => Boolean(kind && BRAND_KINDS.has(kind.toLowerCase()));

/** One published photo. `slide` is the photo's position in the post (any stable number). */
export type UsedPhotoEntry = {
  url: string;
  usedAt: Date;
  vertical: UsedVertical;
  postId: string;
  slide: number;
  mediaId?: string | null;
  phash?: string | null;
  dhash?: string | null;
  source?: string | null;
  credit?: string | null;
  qid?: string | null;
  subject?: string | null;
  scene?: string | null;
};

/** What was published in the window: URLs and both hash kinds. */
export type UsedLedger = {
  urls: ReadonlySet<string>;
  phashes: readonly string[];
  dhashes: readonly string[];
};

export const EMPTY_LEDGER: UsedLedger = { urls: new Set(), phashes: [], dhashes: [] };

export const ledgerStoryId = (vertical: UsedVertical, postId: string) => `${vertical}:${postId}`;

/**
 * Rows that mean "published". Rows from before CI-32 count only when a publish path wrote them (`lfd:` and
 * `stories:` story ids); the carousel pipeline's old build-time rows don't.
 */
const PUBLISHED_ROWS = `(vertical IS NOT NULL OR story_id LIKE 'lfd:%' OR story_id LIKE 'stories:%')`;
const LEGACY_ROWS = `(story_id LIKE 'lfd:%' OR story_id LIKE 'stories:%')`;

const isMissingColumn = (err: unknown) => (err as { code?: string } | null)?.code === '42703';

/** The ledger as of `now`: photos published in the last `days` days. */
export async function readUsedLedger(query: Query, now: Date, days = USED_PHOTO_DAYS): Promise<UsedLedger> {
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

/** Why a candidate is off limits, or null when it may be used. Pass whatever the candidate has. */
export function usedMatch(ledger: UsedLedger, c: { url?: string | null; phash?: string | null; dhash?: string | null }): string | null {
  const why = `published in the last ${USED_PHOTO_DAYS} days`;
  if (c.url && ledger.urls.has(c.url)) return `${why} (same URL)`;
  if (c.phash && ledger.phashes.some((h) => hamming(h, c.phash!) <= NEAR_DUPLICATE)) return `${why} (same picture)`;
  if (c.dhash && ledger.dhashes.some((h) => hamming(h, c.dhash!) <= NEAR_DUPLICATE)) return `${why} (same picture)`;
  return null;
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
