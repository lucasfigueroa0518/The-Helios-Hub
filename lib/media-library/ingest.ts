/**
 * The photo bank's ingest (DECISIONS_LOG D49): the photo_sources outbox,
 * one source at a time.
 *
 *   claim     the next pending source, a failed one whose back-off is over,
 *             or one stuck in `fetching` for over 10 minutes (FOR UPDATE
 *             SKIP LOCKED: two workers never take the same row)
 *   download  20 s timeout, a Wikimedia-compliant User-Agent; refused when
 *             not image/* or over 20 MB (skipped); 404/410 → gone
 *   identify  sha256 of the original bytes, a 64-bit dHash, the true
 *             (EXIF-oriented) size (sharp)
 *   store     a master (long side ≤ 2560, JPEG q85) and a thumbnail (480 px,
 *             q72) in the private `photo-bank` bucket, only when the bytes
 *             are new; the photo row is upserted on sha256 and the source
 *             linked to it
 *
 * A failure backs off (2, 4, 8, 16 minutes) up to 5 attempts and never
 * throws out of the loop.
 */
import { createHash } from 'node:crypto';

import type { MediaBucket } from '@/lib/media-bucket';

import { refreshPhotoMeta } from './store';
import { masterPath, thumbPath, type Query } from './types';

export const MAX_BYTES = 20 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 20_000;
export const ITEM_TIMEOUT_MS = 30_000;
export const MAX_ATTEMPTS = 5;
export const STALE_FETCHING_SECONDS = 10 * 60;
export const MASTER_LONG_SIDE = 2560;
export const MASTER_QUALITY = 85;
export const THUMB_SIDE = 480;
export const THUMB_QUALITY = 72;
/** Wikimedia's User-Agent policy: a client name and version, then contact details. */
export const USER_AGENT = 'HeliosHub-PhotoBank/1.0 (https://heliosgroup.ai; helios@heliosgroup.ai) node';

export type IngestDeps = {
  query: Query;
  bucket: Pick<MediaBucket, 'upload'>;
  http: typeof fetch;
  log?: (line: string) => void;
};

export type ClaimedSource = { url: string; source: string | null; lane: string | null; credit: string | null; licence: string | null; reuse_ok: boolean; attempts: number };

export type IngestOutcome = 'stored' | 'failed' | 'gone' | 'skipped';
export type IngestStats = Record<IngestOutcome, number>;

/** Why a download can't be stored: gone (404/410) and skipped (not an image, too big) are final; retry backs off. */
export class FetchProblem extends Error {
  constructor(message: string, readonly kind: 'gone' | 'skipped' | 'retry') {
    super(message);
  }
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The body, refusing more than MAX_BYTES (checked as it streams, not trusting content-length). */
async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new FetchProblem(`over 20 MB (${declared} bytes)`, 'skipped');
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new FetchProblem('over 20 MB', 'skipped');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function download(url: string, http: typeof fetch): Promise<{ bytes: Buffer; mime: string }> {
  let res: Response;
  try {
    res = await http(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow' });
  } catch (err) {
    throw new FetchProblem(`download failed: ${errText(err)}`, 'retry');
  }
  if (res.status === 404 || res.status === 410) throw new FetchProblem(`HTTP ${res.status}`, 'gone');
  if (!res.ok) throw new FetchProblem(`HTTP ${res.status}`, 'retry');
  const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!mime.startsWith('image/')) throw new FetchProblem(`not an image (${mime || 'no content-type'})`, 'skipped');
  return { bytes: await readCapped(res), mime };
}

export const sha256Of = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** A 64-bit difference hash (9×8 greyscale, each pixel brighter than its right neighbour), as 16 hex digits. */
export async function dhashOf(bytes: Buffer): Promise<string> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(bytes).rotate().flatten({ background: '#ffffff' }).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let hex = '';
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      const left = data[(row * 9 + col) * ch]!;
      const right = data[(row * 9 + col + 1) * ch]!;
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** The bank copies: a master and a thumbnail, both JPEG. Transparency is flattened onto the logo's plate colour (dark plate → near black). */
export async function renditions(bytes: Buffer, opts: { plate?: string | null } = {}): Promise<{ width: number; height: number; master: Buffer; thumb: Buffer }> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new FetchProblem('not a readable image', 'skipped');
  const turned = (meta.orientation ?? 1) >= 5;
  const background = opts.plate === 'dark' ? '#111111' : '#ffffff';
  const master = await sharp(bytes).rotate().flatten({ background }).resize(MASTER_LONG_SIDE, MASTER_LONG_SIDE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: MASTER_QUALITY }).toBuffer();
  const thumb = await sharp(bytes).rotate().flatten({ background }).resize(THUMB_SIDE, THUMB_SIDE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: THUMB_QUALITY }).toBuffer();
  return { width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height, master, thumb };
}

/** Rows stuck in `fetching` with no attempts left: failed for good. */
export async function sweepStuck(query: Query): Promise<void> {
  await query(
    `UPDATE media_library.photo_sources SET status = 'failed', claimed_at = NULL, last_error = COALESCE(last_error || ' · ', '') || 'stuck in fetching'
      WHERE status = 'fetching' AND claimed_at < now() - make_interval(secs => $1) AND attempts >= $2`,
    [STALE_FETCHING_SECONDS, MAX_ATTEMPTS],
  );
}

/** The next source to fetch, marked `fetching` (attempts + 1), or null when the outbox is empty. */
export async function claimNext(query: Query): Promise<ClaimedSource | null> {
  const { rows } = await query(
    `UPDATE media_library.photo_sources AS s SET status = 'fetching', claimed_at = now(), attempts = s.attempts + 1
      WHERE s.url = (
        SELECT url FROM media_library.photo_sources
         WHERE attempts < $1
           AND ((status IN ('pending', 'failed') AND next_attempt_at <= now())
             OR (status = 'fetching' AND claimed_at < now() - make_interval(secs => $2)))
         ORDER BY next_attempt_at, first_seen_at, url
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      RETURNING s.url, s.source, s.lane, s.credit, s.licence, s.reuse_ok, s.attempts`,
    [MAX_ATTEMPTS, STALE_FETCHING_SECONDS],
  );
  return (rows[0] as ClaimedSource | undefined) ?? null;
}

/** The plate a logo was drawn on (its latest sighting), for flattening transparency. */
async function plateOf(query: Query, url: string): Promise<string | null> {
  const { rows } = await query(`SELECT plate FROM media_library.sightings WHERE url = $1 AND plate IS NOT NULL ORDER BY at DESC LIMIT 1`, [url]);
  return (rows[0]?.plate as string | undefined) ?? null;
}

/** The photo row for these bytes: the existing one, or a new one after its files are uploaded. */
async function photoFor(deps: IngestDeps, row: ClaimedSource, bytes: Buffer, mime: string, sha: string): Promise<string> {
  const known = await deps.query(`SELECT id FROM media_library.photos WHERE sha256 = $1`, [sha]);
  if (known.rows[0]?.id) return known.rows[0].id as string;
  const dhash = await dhashOf(bytes).catch(() => null);
  const r = await renditions(bytes, { plate: await plateOf(deps.query, row.url) });
  // Upload before the row exists: a failed upload leaves no photo without its files.
  await deps.bucket.upload(masterPath(sha), r.master, 'image/jpeg');
  await deps.bucket.upload(thumbPath(sha), r.thumb, 'image/jpeg');
  const { rows } = await deps.query(
    `INSERT INTO media_library.photos (sha256, dhash, master_path, thumb_path, mime, bytes, width, height, credit, licence, reuse_ok)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (sha256) DO UPDATE SET last_seen_at = now()
     RETURNING id`,
    [sha, dhash, masterPath(sha), thumbPath(sha), mime, bytes.byteLength, r.width, r.height, row.credit?.trim() || 'Unknown source', row.licence ?? 'unknown', Boolean(row.reuse_ok && row.licence && row.licence !== 'company')],
  );
  return rows[0]!.id as string;
}

/** New bytes being stored in this process, by sha256: two URLs with the same image upload it once. */
const storing = new Map<string, Promise<string>>();

/** Fetch one claimed source and store it. Throws a FetchProblem (or any error) on failure; the caller records it. */
export async function ingestSource(deps: IngestDeps, row: ClaimedSource): Promise<void> {
  const { bytes, mime } = await download(row.url, deps.http);
  const sha = sha256Of(bytes);
  let pending = storing.get(sha);
  if (!pending) {
    pending = photoFor(deps, row, bytes, mime, sha).finally(() => storing.delete(sha));
    storing.set(sha, pending);
  }
  const photoId = await pending;
  await deps.query(
    `UPDATE media_library.photo_sources SET photo_id = $2, status = 'stored', claimed_at = NULL, last_error = NULL, last_ok_at = now() WHERE url = $1`,
    [row.url, photoId],
  );
  await refreshPhotoMeta(deps.query, photoId);
}

/** Back-off after a failed attempt: 2, 4, 8, 16 … minutes. */
export const backoffSeconds = (attempts: number) => 60 * 2 ** Math.max(1, Math.min(attempts, 10));

async function record(deps: IngestDeps, row: ClaimedSource, err: unknown): Promise<IngestOutcome> {
  const kind = err instanceof FetchProblem ? err.kind : 'retry';
  const message = errText(err).slice(0, 500);
  if (kind === 'gone' || kind === 'skipped') {
    await deps.query(`UPDATE media_library.photo_sources SET status = $2, claimed_at = NULL, last_error = $3 WHERE url = $1`, [row.url, kind, message]);
    return kind;
  }
  await deps.query(
    `UPDATE media_library.photo_sources SET status = 'failed', claimed_at = NULL, last_error = $2, next_attempt_at = now() + make_interval(secs => $3) WHERE url = $1`,
    [row.url, message, backoffSeconds(row.attempts)],
  );
  return 'failed';
}

/** One claimed source, within `ms`; never throws. */
export async function processSource(deps: IngestDeps, row: ClaimedSource, ms = ITEM_TIMEOUT_MS): Promise<IngestOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ingestSource(deps, row),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new FetchProblem(`timed out after ${ms / 1000} s`, 'retry')), ms);
        timer.unref?.();
      }),
    ]);
    return 'stored';
  } catch (err) {
    deps.log?.(`ingest ${row.url.slice(0, 120)}: ${errText(err)}`);
    try {
      return await record(deps, row, err);
    } catch (e) {
      deps.log?.(`ingest ${row.url.slice(0, 120)}: could not record the failure: ${errText(e)}`);
      return 'failed';
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Work the outbox until it's empty (or `maxItems`, or `until()` says stop):
 * `concurrency` workers, each claiming one source at a time. Never throws.
 */
export async function runIngest(deps: IngestDeps, opts: { concurrency?: number; itemMs?: number; maxItems?: number; until?: () => boolean } = {}): Promise<IngestStats> {
  const stats: IngestStats = { stored: 0, failed: 0, gone: 0, skipped: 0 };
  try {
    await sweepStuck(deps.query);
  } catch (err) {
    deps.log?.(`ingest sweep: ${errText(err)}`);
  }
  let claimed = 0;
  const worker = async () => {
    while (!opts.until?.() && (opts.maxItems === undefined || claimed < opts.maxItems)) {
      claimed++;
      const row = await claimNext(deps.query);
      if (!row) return;
      stats[await processSource(deps, row, opts.itemMs)]++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 2) }, () => worker().catch((err) => deps.log?.(`ingest worker: ${errText(err)}`))));
  return stats;
}
