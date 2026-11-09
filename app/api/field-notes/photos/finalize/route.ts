import type { NextRequest } from 'next/server';

import { dbQuery } from '@/lib/db';
import { detectFacePhotoLive } from '@/lib/field-notes/photos/faces';
import { facesInline, ingestPhoto } from '@/lib/field-notes/photos/ingest';
import { mediaBucket } from '@/lib/media-bucket';
import { PHOTO_BANK_BUCKET } from '@/lib/media-library/types';
import { getSession } from '@/lib/session';

import { finalizeUploadRoute } from '../handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Step 2 of a photo upload: JSON `{path, name, kind}` (kind: working | scenery | event). Downloads the uploaded object,
 * converts HEIC, dedupes (exact and near), strips location from the stored copies, writes a pool row, removes the
 * incoming object. No model API call.
 *
 * Faces: Vercel has no Chromium, so no detector runs here. The row is stored with the uploader's kind and queued
 * (faces_result 'pending'); the helios-social worker checks it shortly after (lib/field-notes/photos/faces-worker.ts)
 * and tags a clear face `people` with the opener. For local dev only, FIELD_NOTES_FACES_INLINE=1 runs the detector
 * here (a failed inline check still leaves the row pending for the worker).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const bucket = mediaBucket(PHOTO_BANK_BUCKET);
  return finalizeUploadRoute(
    {
      session: getSession,
      download: (path) => bucket.download(path),
      remove: (paths) => bucket.remove(paths),
      ingest: (upload) =>
        ingestPhoto(
          { db: (text, params) => dbQuery(text, params as never) as never, bucket, deferFaces: true, detectFaces: facesInline() ? detectFacePhotoLive : undefined },
          upload,
        ),
    },
    body,
  );
}
