/**
 * The used-photo ledger's pure parts (types, keys and the match check), split from ./used.ts so browser code can
 * import them without pulling in the ledger's readers, the photo hold (./pending.ts) and, through them, sharp.
 * ./used.ts re-exports everything here; server code keeps importing ./used.
 */
import { hamming, NEAR_DUPLICATE } from './hash-distance';

/** How long a published photo stays off limits, for every content type. */
export const USED_PHOTO_DAYS = 20;

/**
 * The content types whose published posts carry photos. Story ids in the ledger are `<vertical>:<post id>`.
 * Stories Split (SS-23): AI Trivia's and Real or AI?'s sets log under their own types; Morning Download keeps `stories`.
 */
export type UsedVertical = 'lfd' | 'stories' | 'ai_trivia' | 'real_or_ai' | 'carousels' | 'reel_ai_drama' | 'field_notes' | 'ai_events';

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
  /** Bald-Eagle D3: the URLs held only because an item waiting to post chose them (for the refusal's wording). */
  pendingUrls?: ReadonlySet<string>;
};

export const EMPTY_LEDGER: UsedLedger = { urls: new Set(), phashes: [], dhashes: [] };

export const ledgerStoryId = (vertical: UsedVertical, postId: string) => `${vertical}:${postId}`;

/** Why a candidate is off limits, or null when it may be used. Pass whatever the candidate has. */
export function usedMatch(ledger: UsedLedger, c: { url?: string | null; phash?: string | null; dhash?: string | null }): string | null {
  const why = `published in the last ${USED_PHOTO_DAYS} days`;
  if (c.url && ledger.pendingUrls?.has(c.url)) return `chosen by an item waiting to post (same URL)`;
  if (c.url && ledger.urls.has(c.url)) return `${why} (same URL)`;
  if (c.phash && ledger.phashes.some((h) => hamming(h, c.phash!) <= NEAR_DUPLICATE)) return `${why} (same picture)`;
  if (c.dhash && ledger.dhashes.some((h) => hamming(h, c.dhash!) <= NEAR_DUPLICATE)) return `${why} (same picture)`;
  return null;
}
