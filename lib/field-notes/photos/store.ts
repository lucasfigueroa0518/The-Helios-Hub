/** field_notes.pool reads and writes. The query function is injected (tests pass a fake or PGlite). */
import type { Query } from '@/lib/media-library/types';

import type { PhotoKind, PoolPhoto } from '../types';
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

/** Post `seq` used these photos: they rest. */
export async function recordUse(db: Query, photoIds: string[], seq: number): Promise<void> {
  if (photoIds.length === 0) return;
  await db(`UPDATE field_notes.pool SET status = 'resting', last_used_post_seq = $2 WHERE photo_id = ANY($1::uuid[]) AND status <> 'retired'`, [photoIds, seq]);
}

/** Resting photos whose rest is over go back to live (the same rule as `restEnded`). */
export async function releaseRested(db: Query, nextSeq: number, restPosts: number): Promise<number> {
  const { rows } = await db(
    `UPDATE field_notes.pool SET status = 'live' WHERE status = 'resting' AND last_used_post_seq IS NOT NULL AND $1::int - last_used_post_seq > $2::int RETURNING photo_id`,
    [nextSeq, restPosts],
  );
  return rows.length;
}

export async function retirePhoto(db: Query, photoId: string, reason: string): Promise<boolean> {
  const why = reason.trim();
  if (!why) throw new Error('a rejection needs a reason');
  const { rows } = await db(`UPDATE field_notes.pool SET status = 'retired', reject_reason = $2 WHERE photo_id = $1::uuid RETURNING photo_id`, [photoId, why]);
  return rows.length > 0;
}

export async function restorePhotoToPool(db: Query, photoId: string): Promise<boolean> {
  const { rows } = await db(
    `UPDATE field_notes.pool SET status = CASE WHEN last_used_post_seq IS NULL THEN 'live' ELSE 'resting' END, reject_reason = NULL
      WHERE photo_id = $1::uuid AND status = 'retired' RETURNING photo_id`,
    [photoId],
  );
  return rows.length > 0;
}

/** Change a photo's tags: its kind, whether it is a good first slide, or both. False when it is not in the pool. */
export async function setPhotoTags(db: Query, photoId: string, tags: { kind?: PhotoKind; opener?: boolean }): Promise<boolean> {
  if (tags.kind === undefined && tags.opener === undefined) throw new Error('nothing to change');
  if (tags.kind !== undefined && !PHOTO_KINDS.includes(tags.kind)) throw new Error(`kind must be one of ${PHOTO_KINDS.join(', ')}`);
  const { rows } = await db(
    `UPDATE field_notes.pool SET kind = COALESCE($2, kind), opener = COALESCE($3::boolean, opener) WHERE photo_id = $1::uuid RETURNING photo_id`,
    [photoId, tags.kind ?? null, tags.opener ?? null],
  );
  return rows.length > 0;
}
