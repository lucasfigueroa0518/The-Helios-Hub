/**
 * One uploaded photo into the pool: convert, read EXIF, hash, dedupe, detect faces, strip location, store.
 * Follows lib/media-library/ingest.ts (same hashes, same master and thumb copies, same bucket paths)
 * and writes a media_library.photos row (licence 'own') plus a field_notes.pool row in one statement.
 * The query function, bucket and face detector are injected; nothing here reads the environment.
 *
 * Faces (Tommy, 2026-11-06): the detector alone decides `people`. A photo it is sure shows a clear face is stored as
 * kind `people` with `opener` set; anything else keeps the uploader's kind, and a `people` the uploader sent is not
 * trusted (it becomes `working`). Three ways in:
 *   - `deferFaces` (the finalize route on Vercel, which has no Chromium): no detector runs here. The photo is stored
 *     with the uploader's non-face kind, faces_result 'pending' and faces_checked_at NULL; the social worker checks it
 *     (./faces-worker.ts).
 *   - `detectFaces` (local dev with FIELD_NOTES_FACES_INLINE=1, see `facesInline`): the detector runs inline and the
 *     row is stored checked. If it cannot run and `deferFaces` is also set, the row is left pending for the worker.
 *   - neither (fixtures, tests): the tags are stored as sent and the row is never queued (faces_result NULL).
 */
import type { MediaBucket } from '@/lib/media-bucket';
import { dhashOf, renditions, sha256Of } from '@/lib/media-library/ingest';
import { masterPath, thumbPath, type Query } from '@/lib/media-library/types';

import type { PhotoKind } from '../types';
import { parseExif, type PhotoExif } from './exif';
import type { DetectFacePhoto } from './faces';
import { toJpegWithExif } from './heic';

/** Two photos whose 64-bit dhashes differ in this many bits or fewer are the same shot. */
export const NEAR_DUPLICATE_MAX_DISTANCE = 6;

export const PHOTO_CREDIT = 'Helios team';

/**
 * What the face check said about a stored photo. `checked` is false when no detector ran (or it was unavailable);
 * `pending` is set when the photo is queued for the worker's face check, which runs shortly after upload.
 */
export type FaceTagging = { checked: boolean; tagged: boolean; reason: string; pending?: true };

/** The opt-in inline face check for local dev only: FIELD_NOTES_FACES_INLINE=1. Off by default (Vercel has no Chromium). */
export function facesInline(env: Record<string, string | undefined> = process.env): boolean {
  return env.FIELD_NOTES_FACES_INLINE === '1';
}

export type IngestPhotoResult =
  | { kind: 'stored'; photoId: string; sha256: string; dhash: string; width: number; height: number; exif: PhotoExif; photoKind: PhotoKind; faces: FaceTagging }
  | { kind: 'duplicate_exact'; matchId: string; distance: 0 }
  | { kind: 'duplicate_near'; matchId: string; distance: number };

/** Differing bits between two 16-hex-digit hashes. */
export function hamming(a: string, b: string): number {
  let bits = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      bits += x & 1;
      x >>= 1;
    }
  }
  return bits;
}

async function exactMatch(db: Query, sha: string): Promise<string | null> {
  const { rows } = await db(`SELECT id::text AS id FROM media_library.photos WHERE sha256 = $1`, [sha]);
  return (rows[0]?.id as string | undefined) ?? null;
}

/** The closest own photo (pool member, retired included, so a rejected shot is not re-added) within `maxDistance`. */
async function nearMatch(db: Query, dhash: string, maxDistance: number): Promise<{ id: string; distance: number } | null> {
  const { rows } = await db(
    `SELECT p.id::text AS id, p.dhash FROM media_library.photos p JOIN field_notes.pool f ON f.photo_id = p.id WHERE p.dhash IS NOT NULL`,
  );
  let best: { id: string; distance: number } | null = null;
  for (const r of rows as { id: string; dhash: string }[]) {
    const distance = hamming(dhash, r.dhash);
    if (distance <= maxDistance && (!best || distance < best.distance)) best = { id: r.id, distance };
  }
  return best;
}

export type IngestPhotoDeps = { db: Query; bucket: Pick<MediaBucket, 'upload'>; detectFaces?: DetectFacePhoto; deferFaces?: boolean };

/** Tags plus the row's face-check columns: `result` is faces_result, `checked` sets faces_checked_at. */
type Tags = { kind: PhotoKind; opener: boolean; faces: FaceTagging; result: string | null; checked: boolean };

export const PENDING_REASON = 'queued: faces are checked shortly after upload';

/** The stored kind and opener: the detector's `people` when it is sure, else the uploader's non-face kind. */
async function tagsFor(deps: IngestPhotoDeps, jpeg: Buffer, upload: { kind?: PhotoKind; opener?: boolean }): Promise<Tags> {
  const sent = upload.kind ?? 'working';
  const fallback: PhotoKind = sent === 'people' ? 'working' : sent;
  const pending = (reason: string): Tags => ({ kind: fallback, opener: false, faces: { checked: false, tagged: false, reason, pending: true }, result: 'pending', checked: false });
  if (!deps.detectFaces) {
    if (deps.deferFaces) return pending(PENDING_REASON);
    return { kind: sent, opener: upload.opener === true, faces: { checked: false, tagged: sent === 'people', reason: 'no face detector' }, result: null, checked: false };
  }
  let verdict;
  try {
    verdict = await deps.detectFaces(jpeg);
  } catch (error) {
    verdict = { face: false, unavailable: true, reason: `face detector failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (verdict.unavailable === true) {
    if (deps.deferFaces) return pending(`${PENDING_REASON} (inline check could not run: ${verdict.reason})`);
    return { kind: fallback, opener: false, faces: { checked: false, tagged: false, reason: verdict.reason }, result: unavailableResult(verdict.reason), checked: true };
  }
  const faces = { checked: true, tagged: verdict.face === true, reason: verdict.reason };
  return verdict.face === true
    ? { kind: 'people', opener: true, faces, result: 'faces', checked: true }
    : { kind: fallback, opener: false, faces, result: 'none', checked: true };
}

/** faces_result for a check that could not run: 'unavailable: <reason>', kept short. */
export function unavailableResult(reason: string): string {
  const why = reason.replace(/\s+/g, ' ').trim().slice(0, 200);
  return why ? `unavailable: ${why}` : 'unavailable';
}

export async function ingestPhoto(
  deps: IngestPhotoDeps,
  upload: { bytes: Buffer; mime: string; uploadedBy: string; kind?: PhotoKind; opener?: boolean },
  opts: { maxNearDistance?: number } = {},
): Promise<IngestPhotoResult> {
  const sha = sha256Of(upload.bytes);
  const same = await exactMatch(deps.db, sha);
  if (same) return { kind: 'duplicate_exact', matchId: same, distance: 0 };

  const { jpeg, exif: rawExif } = await toJpegWithExif(upload.bytes, upload.mime);
  const exif = parseExif(rawExif);
  const dhash = await dhashOf(jpeg);
  const near = await nearMatch(deps.db, dhash, opts.maxNearDistance ?? NEAR_DUPLICATE_MAX_DISTANCE);
  if (near) return { kind: 'duplicate_near', matchId: near.id, distance: near.distance };

  const tags = await tagsFor(deps, jpeg, upload);
  // renditions() re-encodes from pixels and keeps no metadata: the published copy has no EXIF, no GPS.
  const r = await renditions(jpeg);
  // Upload before the row exists: a failed upload leaves no photo without its files.
  await deps.bucket.upload(masterPath(sha), r.master, 'image/jpeg');
  await deps.bucket.upload(thumbPath(sha), r.thumb, 'image/jpeg');
  const { rows } = await deps.db(
    `WITH p AS (
       INSERT INTO media_library.photos (sha256, dhash, master_path, thumb_path, mime, bytes, width, height, credit, licence, reuse_ok)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'own', false)
       ON CONFLICT (sha256) DO NOTHING
       RETURNING id)
     INSERT INTO field_notes.pool (photo_id, uploaded_by, exif, kind, opener, faces_result, faces_checked_at)
     SELECT id, $10, $11::jsonb, $12, $13::boolean, $14::text, CASE WHEN $15::boolean THEN now() END FROM p RETURNING photo_id::text AS photo_id`,
    [sha, dhash, masterPath(sha), thumbPath(sha), upload.mime, upload.bytes.byteLength, r.width, r.height, PHOTO_CREDIT, upload.uploadedBy, JSON.stringify(exif), tags.kind, tags.opener, tags.result, tags.checked],
  );
  const photoId = rows[0]?.photo_id as string | undefined;
  if (photoId) return { kind: 'stored', photoId, sha256: sha, dhash, width: r.width, height: r.height, exif, photoKind: tags.kind, faces: tags.faces };
  // A concurrent upload of the same bytes won the insert.
  const winner = await exactMatch(deps.db, sha);
  if (!winner) throw new Error('photo insert returned no row');
  return { kind: 'duplicate_exact', matchId: winner, distance: 0 };
}
