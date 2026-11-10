/**
 * The nightly Instagram read (CI-32): Instagram is the source of truth for "published". It lists the account's new
 * feed posts and live stories, matches each one back to the post we built, and logs that post's photos into the
 * used-photo ledger at the Instagram timestamp. Every run lists the whole rule's window (USED_PHOTO_DAYS + 1 days)
 * and handles a post when it isn't in social.ig_media_matches yet, or when it is unmatched and newer than
 * IG_SYNC_RETRY_DAYS. Each post's row is written as soon as that post is handled, so a run cut short (a timeout)
 * resumes the rest next night; a matched post is never handled again. Newest first, at most IG_SYNC_MAX_MEDIA a run.
 *
 * Matching, strictest first: the media id our publish recorded; then the caption (normalized, exact, and only when
 * exactly one post has it); then the image (the pHash of what Instagram shows first against our render's, within
 * NEAR_DUPLICATE, and only when exactly one post is that close). Anything ambiguous stays unmatched.
 * A Story frame matches by its media id, or by image only when at least two frames Instagram posted within an hour
 * of each other each match frames of the same one set and no other set: one frame alone could be any set's.
 *
 * Bounded work: the look-back window only, never a sweep of whole tables (CLAUDE.md Rule 2). No model calls.
 */
import type { IgMedia, IgMediaListing } from '@/lib/instagram/graph';
import { hamming, NEAR_DUPLICATE } from '@/lib/reel-ai-drama/harvest/filters';
import type { Query } from '@/lib/social/store/pg';

import { entriesFor, parseStorageRef, publishedPostAdapters, withHashes, type CandidatePost, type PublishedPostAdapter } from './published-posts';
import { hashesOf, postLogged, recordUsedPhotos, USED_PHOTO_DAYS } from './used';

/** Days read back on every run: the whole rule's window, plus a day. */
export const IG_SYNC_LOOKBACK_DAYS = USED_PHOTO_DAYS + 1;
/** An unmatched post is tried again while it is this new (its media id may be recorded late); older, it stays as is. */
export const IG_SYNC_RETRY_DAYS = 3;
/** Story frames that match one set by image must be posted within this of each other. */
export const STORY_FRAME_WINDOW_MS = 3_600_000;
/** How long before the oldest Instagram post we look for the post we built. */
export const IG_SYNC_BUILT_BEFORE_DAYS = 14;
/** At most this many Instagram posts are handled in one run. */
export const IG_SYNC_MAX_MEDIA = 300;
/** A caption this short (normalized) never matches on its own: too likely to repeat. */
export const MIN_CAPTION_CHARS = 20;
/** Instagram's caption may carry extra text after ours (hashtags added by hand) when ours is at least this long. */
export const PREFIX_CAPTION_CHARS = 80;

export type IgSyncDeps = {
  query: Query;
  listing: IgMediaListing;
  fetchBytes(url: string): Promise<Buffer>;
  download(bucket: string, path: string): Promise<Buffer>;
  now(): Date;
  log(line: string): void;
  /** Defaults to publishedPostAdapters(query). */
  adapters?: PublishedPostAdapter[];
  /** Defaults to hashesOf (pHash + dHash of the bytes). */
  hash?: (bytes: Buffer) => Promise<{ phash: string; dhash: string }>;
  /** Prints matches and writes nothing. */
  dryRun?: boolean;
  /** Default IG_SYNC_MAX_MEDIA. */
  maxMedia?: number;
};

export type MatchHow = 'media_id' | 'caption' | 'image' | 'none';

export type IgSyncMatch = { mediaId: string; surface: IgMedia['surface']; timestamp: string; how: MatchHow; vertical: string | null; postId: string | null; photos: number; alreadyLogged: boolean };

export type IgSyncReport = {
  lookbackDays: number;
  seen: number;
  /** Handled in an earlier run: matched then, or unmatched and older than IG_SYNC_RETRY_DAYS. */
  skipped: number;
  /** Left for the next run by the per-run cap. */
  deferred: number;
  matched: Record<Exclude<MatchHow, 'none'>, number>;
  unmatched: number;
  alreadyLogged: number;
  photosLogged: number;
  matches: IgSyncMatch[];
  /** Set when the run could not start (e.g. db/social_used_photos_v2.sql not applied); nothing was written. */
  error?: string;
};

/** Lower case, no accents, emoji or punctuation, single spaces. */
export function normalizeCaption(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True when Instagram's caption is ours: equal, or ours (long enough) followed by extra text. */
export function captionsMatch(ig: string, ours: string): boolean {
  if (ours.length < MIN_CAPTION_CHARS) return false;
  if (ig === ours) return true;
  return ours.length >= PREFIX_CAPTION_CHARS && ig.startsWith(`${ours} `);
}

/** The image Instagram shows first: a carousel's first child, a reel's thumbnail, an image or story frame. */
export function igCoverUrl(m: IgMedia): string | null {
  const child = m.children[0];
  if (child?.mediaUrl && child.mediaType !== 'VIDEO') return child.mediaUrl;
  if (m.mediaType === 'VIDEO' || m.mediaType === 'REELS') return m.thumbnailUrl ?? null;
  return m.mediaUrl ?? m.thumbnailUrl ?? null;
}

const key = (p: { vertical: string; postId: string }) => `${p.vertical}:${p.postId}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isMissingTable = (e: unknown) => (e as { code?: string } | null)?.code === '42P01';

/** Exactly one distinct post, else null (ambiguous or none). */
function single(posts: CandidatePost[]): CandidatePost | null {
  const distinct = new Map(posts.map((p) => [key(p), p]));
  return distinct.size === 1 ? [...distinct.values()][0] : null;
}

export async function syncPublishedPhotos(deps: IgSyncDeps): Promise<IgSyncReport> {
  const { query, log } = deps;
  const now = deps.now();
  const hash = deps.hash ?? hashesOf;
  const adapters = deps.adapters ?? publishedPostAdapters(query);
  const lookbackDays = IG_SYNC_LOOKBACK_DAYS;
  const since = new Date(now.getTime() - lookbackDays * 86_400_000);
  const report: IgSyncReport = { lookbackDays, seen: 0, skipped: 0, deferred: 0, matched: { media_id: 0, caption: 0, image: 0 }, unmatched: 0, alreadyLogged: 0, photosLogged: 0, matches: [] };

  // Before Instagram is asked anything: the run keeps its state in social.ig_media_matches (db/social_used_photos_v2.sql).
  try {
    await query(`SELECT 1 FROM social.ig_media_matches LIMIT 1`);
  } catch (e) {
    report.error = isMissingTable(e) ? 'social.ig_media_matches is missing (apply db/social_used_photos_v2.sql); nothing synced' : `social.ig_media_matches unreadable: ${errorText(e)}`;
    log(report.error);
    return report;
  }

  const listed = [...(await deps.listing.feedMedia(since)), ...(await deps.listing.liveStories())]
    .filter((m) => Date.parse(m.timestamp) >= since.getTime() && Date.parse(m.timestamp) <= now.getTime())
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  report.seen = listed.length;
  if (!listed.length) return report;

  const ids = listed.map((m) => m.id);
  const before = new Map(
    (await query(`SELECT media_id, how FROM social.ig_media_matches WHERE media_id = ANY($1::text[])`, [ids])).rows.map((r) => [r.media_id as string, r.how as string]),
  );
  const retryFrom = now.getTime() - IG_SYNC_RETRY_DAYS * 86_400_000;
  const due = listed.filter((m) => !before.has(m.id) || (before.get(m.id) === 'none' && Date.parse(m.timestamp) > retryFrom));
  report.skipped = listed.length - due.length;
  // Newest first, so a run cut short leaves the older posts, which the next run picks up.
  const todo = due.reverse().slice(0, deps.maxMedia ?? IG_SYNC_MAX_MEDIA);
  report.deferred = due.length - todo.length;
  if (!todo.length) return report;
  const oldest = Math.min(...todo.map((m) => Date.parse(m.timestamp)));

  // Posts an earlier Instagram post already claimed: a feed post is published once. A Story set has many frames.
  const claimed = new Set(
    (await query(
      `SELECT vertical, post_id FROM social.ig_media_matches WHERE post_id IS NOT NULL AND media_timestamp > $1`,
      [new Date(since.getTime() - IG_SYNC_BUILT_BEFORE_DAYS * 86_400_000).toISOString()],
    )).rows.map((r) => `${r.vertical}:${r.post_id}`),
  );

  // Posts built in the window, loaded once and only when a post isn't matched by its media id.
  let pool: CandidatePost[] | null = null;
  // For one Instagram post: built before it went out (an hour's slack) and at most IG_SYNC_BUILT_BEFORE_DAYS earlier.
  const candidates = async (m: IgMedia) => {
    if (!pool) {
      const from = new Date(Math.min(oldest, ...listed.filter((x) => x.surface === 'story').map((x) => Date.parse(x.timestamp))) - IG_SYNC_BUILT_BEFORE_DAYS * 86_400_000);
      pool = (await Promise.all(adapters.map((a) => a.candidates(from, now).catch((e) => (log(`candidates ${a.vertical}: ${errorText(e)}`), []))))).flat();
    }
    const ts = Date.parse(m.timestamp);
    return pool.filter((p) => {
      const built = p.builtAt.getTime();
      return (p.vertical === 'stories' || !claimed.has(key(p))) && built <= ts + 3_600_000 && built >= ts - IG_SYNC_BUILT_BEFORE_DAYS * 86_400_000;
    });
  };

  // pHash of a render or an Instagram image, cached; null when it can't be read.
  const hashes = new Map<string, Promise<string | null>>();
  const readBytes = (ref: string) => {
    const s = parseStorageRef(ref);
    return s ? deps.download(s.bucket, s.path) : deps.fetchBytes(ref);
  };
  const phashOf = (ref: string) => {
    let hit = hashes.get(ref);
    if (!hit) {
      hit = readBytes(ref).then((b) => hash(b)).then((h) => h.phash, () => null);
      hashes.set(ref, hit);
    }
    return hit;
  };

  /** The posts whose image (a feed post's cover; any Story frame) is within NEAR_DUPLICATE of what Instagram shows. */
  async function closeTo(m: IgMedia): Promise<CandidatePost[]> {
    // Our only video posts (AI Drama reels) keep no cover render, so a video never matches by image.
    if (m.mediaType === 'VIDEO' || m.mediaType === 'REELS') return [];
    const cover = igCoverUrl(m);
    const igHash = cover ? await phashOf(cover) : null;
    if (!igHash) return [];
    const close: CandidatePost[] = [];
    for (const p of await candidates(m)) {
      if ((p.vertical === 'stories') !== (m.surface === 'story')) continue;
      const renders = p.vertical === 'stories' ? p.frameRenders ?? [] : p.coverRender ? [p.coverRender] : [];
      for (const r of renders) {
        const h = await phashOf(r);
        if (h && hamming(h, igHash) <= NEAR_DUPLICATE) {
          close.push(p);
          break;
        }
      }
    }
    return close;
  }
  const closeCache = new Map<string, Promise<CandidatePost[]>>();
  const closeOf = (m: IgMedia) => {
    let hit = closeCache.get(m.id);
    if (!hit) closeCache.set(m.id, (hit = closeTo(m)));
    return hit;
  };

  async function matchByImage(m: IgMedia): Promise<CandidatePost | null> {
    const post = single(await closeOf(m));
    if (!post || m.surface !== 'story') return post;
    // A Story frame: only with another frame, posted within the hour, that matches this same set and no other.
    const ts = Date.parse(m.timestamp);
    for (const other of listed) {
      if (other.id === m.id || other.surface !== 'story' || Math.abs(Date.parse(other.timestamp) - ts) > STORY_FRAME_WINDOW_MS) continue;
      const theirs = single(await closeOf(other));
      if (theirs && key(theirs) === key(post)) return post;
    }
    return null;
  }

  async function match(m: IgMedia): Promise<{ post: CandidatePost; how: Exclude<MatchHow, 'none'> } | null> {
    for (const a of adapters) {
      if ((a.vertical === 'stories') !== (m.surface === 'story')) continue;
      const post = await a.byMediaId(m.id);
      if (post) return { post, how: 'media_id' };
    }
    const ig = normalizeCaption(m.caption);
    if (m.surface === 'feed' && ig) {
      const post = single((await candidates(m)).filter((p) => p.vertical !== 'stories' && captionsMatch(ig, normalizeCaption(p.caption))));
      if (post) return { post, how: 'caption' };
    }
    const post = await matchByImage(m);
    return post ? { post, how: 'image' } : null;
  }

  for (const m of todo) {
    try {
      const hit = await match(m);
      const row: IgSyncMatch = { mediaId: m.id, surface: m.surface, timestamp: m.timestamp, how: hit?.how ?? 'none', vertical: hit?.post.vertical ?? null, postId: hit?.post.postId ?? null, photos: 0, alreadyLogged: false };
      if (hit) {
        report.matched[hit.how] += 1;
        claimed.add(key(hit.post));
        row.alreadyLogged = await postLogged(query, hit.post.vertical, hit.post.postId);
        if (row.alreadyLogged) report.alreadyLogged += 1;
        else if (deps.dryRun) row.photos = hit.post.photos.length;
        else {
          const photos = await withHashes(hit.post.photos, { read: readBytes, hash, log });
          const entries = entriesFor({ ...hit.post, photos }, new Date(m.timestamp), m.id);
          row.photos = entries.length ? await recordUsedPhotos(query, entries) : 0;
          report.photosLogged += row.photos;
        }
      } else {
        report.unmatched += 1;
      }
      report.matches.push(row);
      if (!deps.dryRun) {
        await query(
          `INSERT INTO social.ig_media_matches (media_id, media_timestamp, surface, vertical, post_id, how, photos_logged, checked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (media_id) DO UPDATE SET vertical = excluded.vertical, post_id = excluded.post_id, how = excluded.how,
             photos_logged = excluded.photos_logged, checked_at = excluded.checked_at`,
          [m.id, m.timestamp, m.surface, row.vertical, row.postId, row.how, row.photos, now.toISOString()],
        );
      }
    } catch (e) {
      // One post that fails is retried next night; the rest go on.
      log(`ig media ${m.id}: ${errorText(e)}`);
    }
  }
  return report;
}

/** The live wiring: the Graph listing, a bounded image fetch, and Storage reads. Reads Instagram only. */
export async function liveIgSyncDeps(query: Query, log: (line: string) => void, opts: { dryRun?: boolean } = {}): Promise<IgSyncDeps> {
  const [{ createGraph }, { mediaBucket }, { USER_AGENT, MAX_IMAGE_BYTES }] = await Promise.all([
    import('@/lib/instagram/graph'),
    import('@/lib/media-bucket'),
    import('@/lib/reel-ai-drama/harvest/fetch'),
  ]);
  const { listing } = createGraph();
  return {
    query,
    listing,
    async fetchBytes(url) {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image too large');
      return bytes;
    },
    download: (bucket, path) => mediaBucket(bucket).download(path),
    now: () => new Date(),
    log,
    dryRun: opts.dryRun,
  };
}
