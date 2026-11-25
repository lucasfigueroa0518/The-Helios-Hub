/**
 * The face check for new uploads, on the helios-social worker (Tommy, 2026-11-06: "Face tagging can run on the
 * worker"). Vercel has no Chromium, so finalize stores each new photo with faces_result 'pending' and
 * faces_checked_at NULL (./ingest.ts, `deferFaces`). Each worker poll runs `runFacesStep` once:
 *
 *   1. claim up to `limit` pending rows (FOR UPDATE SKIP LOCKED plus a lease, so two workers never check one photo);
 *   2. open one detector (one headless browser) for the whole batch, only when something was claimed;
 *   3. per photo: download its master from the photo bucket, run the detector (./faces.ts, the same strict gates);
 *      a clear face sets kind 'people' and opener true, anything else leaves the kind; faces_checked_at and
 *      faces_result are always set;
 *   4. a failure (no browser, timeout, unreadable master) is retried on a later poll, at most FACES_MAX_ATTEMPTS
 *      claims in all, then the row is marked 'unavailable: <reason>' and keeps its kind.
 *
 * Only pending rows are ever claimed: rows from before the face-check columns have faces_result NULL and are never
 * touched (Rule 2: no sweep, no backfill), and a checked row is never written again. No model call, no spend.
 */
import type { Query } from '@/lib/media-library/types';

import { DETECT_TIMEOUT_MS, withTimeout, type DetectFacePhoto } from './faces';
import { unavailableResult } from './ingest';

/** Photos checked per poll. */
export const FACES_BATCH = 10;
/** Claims a photo gets in all; after the last failed one it is marked unavailable. */
export const FACES_MAX_ATTEMPTS = 2;
/** A claim older than this belongs to a worker that died mid-batch: the row is claimed again. */
export const FACES_LEASE_MINUTES = 10;

export type ClaimedPhoto = { photoId: string; masterPath: string; attempts: number };

/** An open detector for one batch. `close` releases its browser. */
export type FaceDetectorSession = { detect: DetectFacePhoto; close: () => Promise<void> };

export type FacesStepDeps = {
  db: Query;
  /** The master JPEG from the photo bucket. */
  download: (path: string) => Promise<Buffer>;
  /** Called once per batch, only when a photo was claimed. */
  openDetector: () => Promise<FaceDetectorSession>;
  limit?: number;
};

export type FacesStepResult = { claimed: number; faces: number; none: number; unavailable: number; retrying: number; released: number; ms: number };

/** Up to `limit` pending, unchecked, unleased pool rows, oldest upload first, leased to this caller. */
export async function claimPendingFacePhotos(db: Query, limit = FACES_BATCH, leaseMinutes = FACES_LEASE_MINUTES): Promise<ClaimedPhoto[]> {
  const { rows } = await db(
    `UPDATE field_notes.pool f
        SET faces_claimed_at = now(), faces_attempts = f.faces_attempts + 1
       FROM media_library.photos p
      WHERE p.id = f.photo_id
        AND f.photo_id IN (
          SELECT photo_id FROM field_notes.pool
           WHERE faces_result = 'pending' AND faces_checked_at IS NULL AND status <> 'retired'
             AND (faces_claimed_at IS NULL OR faces_claimed_at < now() - make_interval(mins => $2::int))
           ORDER BY uploaded_at, photo_id
           LIMIT $1::int
           FOR UPDATE SKIP LOCKED)
      RETURNING f.photo_id::text AS photo_id, p.master_path, f.faces_attempts`,
    [limit, leaseMinutes],
  );
  return (rows as { photo_id: string; master_path: string; faces_attempts: number }[]).map((r) => ({ photoId: r.photo_id, masterPath: r.master_path, attempts: Number(r.faces_attempts) }));
}

/** The final answer for a claimed row. Guarded on pending + unchecked, so a checked row is never written again. */
async function settle(db: Query, photoId: string, result: string, face: boolean): Promise<void> {
  await db(
    `UPDATE field_notes.pool
        SET faces_checked_at = now(), faces_result = $2, faces_claimed_at = NULL,
            kind = CASE WHEN $3::boolean THEN 'people' ELSE kind END,
            opener = CASE WHEN $3::boolean THEN true ELSE opener END
      WHERE photo_id = $1::uuid AND faces_result = 'pending' AND faces_checked_at IS NULL`,
    [photoId, result, face],
  );
}

/** Drop the lease so a later poll tries again. `refund` gives back the attempt (the photo was never tried). */
async function release(db: Query, photoId: string, refund: boolean): Promise<void> {
  await db(
    `UPDATE field_notes.pool SET faces_claimed_at = NULL, faces_attempts = GREATEST(faces_attempts - $2::int, 0)
      WHERE photo_id = $1::uuid AND faces_result = 'pending' AND faces_checked_at IS NULL`,
    [photoId, refund ? 1 : 0],
  );
}

/** One batch: claim, check each photo with one shared detector, settle or release every claimed row. Never throws past the claim. */
export async function runFacesStep(deps: FacesStepDeps): Promise<FacesStepResult> {
  const started = Date.now();
  const out: FacesStepResult = { claimed: 0, faces: 0, none: 0, unavailable: 0, retrying: 0, released: 0, ms: 0 };
  const claimed = await claimPendingFacePhotos(deps.db, deps.limit ?? FACES_BATCH);
  out.claimed = claimed.length;
  if (claimed.length === 0) return out;

  /** A failed try: again on a later poll while attempts remain, else unavailable for good. */
  const failed = async (photo: ClaimedPhoto, reason: string) => {
    if (photo.attempts < FACES_MAX_ATTEMPTS) {
      await release(deps.db, photo.photoId, false);
      out.retrying++;
    } else {
      await settle(deps.db, photo.photoId, unavailableResult(`${reason} (after ${photo.attempts} tries)`), false);
      out.unavailable++;
    }
  };

  // Claimed again after a worker died mid-check, with no tries left: give up without opening a browser for it.
  const todo: ClaimedPhoto[] = [];
  for (const photo of claimed) {
    if (photo.attempts > FACES_MAX_ATTEMPTS) {
      await settle(deps.db, photo.photoId, unavailableResult(`gave up after ${FACES_MAX_ATTEMPTS} tries`), false);
      out.unavailable++;
    } else todo.push(photo);
  }
  if (todo.length === 0) return { ...out, ms: Date.now() - started };

  let session: FaceDetectorSession | null = null;
  try {
    try {
      session = await deps.openDetector();
    } catch (error) {
      const why = `face detector unavailable: ${errorText(error)}`;
      for (const photo of todo) await failed(photo, why);
      return out;
    }
    for (let i = 0; i < todo.length; i++) {
      const photo = todo[i]!;
      let jpeg: Buffer;
      try {
        jpeg = await deps.download(photo.masterPath);
      } catch (error) {
        await failed(photo, `master not readable: ${errorText(error)}`);
        continue;
      }
      let verdict;
      try {
        verdict = await withTimeout(session.detect(jpeg), DETECT_TIMEOUT_MS);
      } catch (error) {
        // A thrown detector (timeout, crashed page) is not trusted for the rest of the batch: this photo counts a
        // try, the ones after it go back untried for the next poll's fresh browser.
        await failed(photo, `face detector failed: ${errorText(error)}`);
        for (const rest of todo.slice(i + 1)) {
          await release(deps.db, rest.photoId, true);
          out.released++;
        }
        break;
      }
      if (verdict.unavailable === true) await failed(photo, verdict.reason);
      else if (verdict.face === true) {
        await settle(deps.db, photo.photoId, 'faces', true);
        out.faces++;
      } else {
        await settle(deps.db, photo.photoId, 'none', false);
        out.none++;
      }
    }
    return out;
  } finally {
    await session?.close().catch(() => undefined);
    out.ms = Date.now() - started;
  }
}

/** The live detector for one batch: one headless Chromium, one page reused for every photo, closed after. */
export async function openLiveFaceDetector(): Promise<FaceDetectorSession> {
  const { chromium } = await import(/* webpackIgnore: true */ 'playwright');
  const { createFacePhotoDetector } = await import('./faces');
  // Playwright's own launch timeout applies (a launch cut off here would leave a browser running).
  const browser = await chromium.launch();
  const detector = createFacePhotoDetector(browser);
  return {
    detect: detector,
    close: async () => {
      await detector.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 160);
}
