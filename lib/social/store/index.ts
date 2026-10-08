/**
 * Helios Social storage choice (spec docs/superpowers/specs/2026-10-08-social-storage.md §3).
 *
 * Postgres (`social` schema) when DATABASE_URL or DIRECT_DATABASE_URL is set
 * and SOCIAL_STORE isn't "file"; otherwise the local files, exactly as before.
 * The pipeline gets the same interfaces either way.
 */
import { createFileFeedHealthLog, type FeedHealthLog } from '@/lib/social/ingest/select/feed-health';
import { createFilePosted, type PostedStories } from '@/lib/social/ingest/select/posted';
import { createFileUsedPhotoLog, type UsedPhotoLog } from '@/lib/social/photos/used-photos';
import { createFileSetAsideLog, type SetAsideLog } from '@/lib/social/pipeline/set-aside-log';

import { createPgFeedHealthLog, createPgPosted, createPgSetAsideLog, createPgUsedPhotoLog, type Query } from './pg';

export type SocialStore = {
  kind: 'postgres' | 'file';
  usedPhotos: UsedPhotoLog;
  posted: PostedStories;
  setAsides: SetAsideLog;
  feedHealth: FeedHealthLog;
  /** Postgres only: the query function for run and post records. */
  query: Query | null;
};

export function socialStoreKind(env: Record<string, string | undefined> = process.env): 'postgres' | 'file' {
  if (env.SOCIAL_STORE?.trim().toLowerCase() === 'file') return 'file';
  return env.DATABASE_URL?.trim() || env.DIRECT_DATABASE_URL?.trim() ? 'postgres' : 'file';
}

/** The runtime query function (lib/db.ts pool), loaded only when Postgres is chosen. */
export async function socialQuery(): Promise<Query> {
  const { dbQuery } = await import('@/lib/db');
  return (text, params) => dbQuery(text, params);
}

export async function createSocialStore(env: Record<string, string | undefined> = process.env): Promise<SocialStore> {
  if (socialStoreKind(env) === 'file') {
    return { kind: 'file', usedPhotos: createFileUsedPhotoLog(), posted: createFilePosted(), setAsides: createFileSetAsideLog(), feedHealth: createFileFeedHealthLog(), query: null };
  }
  const query = await socialQuery();
  return { kind: 'postgres', usedPhotos: createPgUsedPhotoLog(query), posted: createPgPosted(query), setAsides: createPgSetAsideLog(query), feedHealth: createPgFeedHealthLog(query), query };
}
