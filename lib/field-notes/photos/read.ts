/**
 * field_notes.pool reads only, apart from the writes in ./store.ts, so read-only code (the Social Hub's Photo Bank)
 * can list the pool without reaching a write. The query function is injected (tests pass a fake or PGlite).
 */
import type { Query } from '@/lib/media-library/types';

import type { PoolPhoto } from '../types';
import { PHOTO_KINDS, POOL_STATUSES } from '../types';

type PoolRow = { photo_id: string; uploaded_by: string; uploaded_at: Date | string; status: string; last_used_post_seq: number | null; reject_reason: string | null; kind: string; opener: boolean; faces_result?: string | null; faces_checked_at?: Date | string | null };

/**
 * Where a photo's face check stands (db/field_notes_schema.sql, faces_*): 'pending' = queued at upload and not
 * checked yet, 'faces' / 'none' = checked, 'unavailable' = the check could not run. null = never queued (a photo
 * from before the face check; its tags stay as they were).
 */
export type FaceCheckState = 'pending' | 'faces' | 'none' | 'unavailable' | null;
/** A pool photo as listPool returns it: the pool fields plus its face check. */
export type PoolPhotoWithFaces = PoolPhoto & { facesCheck: FaceCheckState };

export function faceCheckOf(result: string | null | undefined, checkedAt: Date | string | null | undefined): FaceCheckState {
  if (!result) return null;
  if (result === 'pending') return checkedAt ? null : 'pending';
  if (result === 'faces' || result === 'none') return result;
  return result.startsWith('unavailable') ? 'unavailable' : null;
}

const toPhoto = (r: PoolRow): PoolPhotoWithFaces => ({
  photoId: r.photo_id,
  uploadedBy: r.uploaded_by,
  uploadedAt: new Date(r.uploaded_at).toISOString(),
  status: POOL_STATUSES.find((s) => s === r.status) ?? 'retired',
  lastUsedPostSeq: r.last_used_post_seq,
  rejectReason: r.reject_reason,
  kind: PHOTO_KINDS.find((k) => k === r.kind) ?? 'working',
  opener: r.opener === true,
  facesCheck: faceCheckOf(r.faces_result, r.faces_checked_at),
});

/** Every pool member, newest upload first. The pool is about 25 live photos, so this is small. */
export async function listPool(db: Query): Promise<PoolPhotoWithFaces[]> {
  const { rows } = await db(
    `SELECT photo_id::text AS photo_id, uploaded_by, uploaded_at, status, last_used_post_seq, reject_reason, kind, opener, faces_result, faces_checked_at
       FROM field_notes.pool ORDER BY uploaded_at DESC, photo_id`,
  );
  return (rows as PoolRow[]).map(toPhoto);
}
