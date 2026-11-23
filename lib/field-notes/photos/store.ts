/** field_notes.pool writes, plus the reads re-exported from ./read.ts. The query function is injected (tests pass a fake or PGlite). */
import type { Query } from '@/lib/media-library/types';

import type { PhotoKind } from '../types';
import { PHOTO_KINDS } from '../types';

export { faceCheckOf, listPool, type FaceCheckState, type PoolPhotoWithFaces } from './read';

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
