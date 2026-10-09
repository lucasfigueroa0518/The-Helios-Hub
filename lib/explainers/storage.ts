import fs from 'node:fs';
import path from 'node:path';

import { mediaBucket, type MediaBucket } from '@/lib/media-bucket';

/**
 * Where render outputs live. Keys look like `jobs/<jobId>/video.mp4`.
 * Local disk on a dev machine; on the social worker VM (EXPLAINERS_STORAGE=bucket)
 * each file is also copied to the private `explainers` Supabase bucket under the
 * same key (E-22: a reel is ~5 MB), so the app can serve it and Meta can fetch it.
 */
export const ARTIFACT_BUCKET = 'explainers';

export type StorageLocation = 'local' | 'bucket';

export interface ArtifactStore {
  put(key: string, sourcePath: string): Promise<{ storagePath: string; bytes: number; location?: StorageLocation }>;
  /** Absolute path for serving a stored file, or null when it is not on this disk. */
  localPath(key: string): string | null;
}

export const DEFAULT_STORAGE_DIR = path.join(process.cwd(), '.explainers-local', 'storage');

function safeKey(key: string): string {
  const normalized = path.posix.normalize(key).replace(/^\/+/, '');
  if (normalized.startsWith('..') || normalized.includes('\0')) throw new Error(`bad storage key: ${key}`);
  return normalized;
}

export function localArtifactStore(root = process.env.EXPLAINERS_STORAGE_DIR || DEFAULT_STORAGE_DIR): ArtifactStore {
  return {
    async put(key, sourcePath) {
      const storagePath = safeKey(key);
      const target = path.join(root, storagePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(sourcePath, target);
      return { storagePath, bytes: fs.statSync(target).size };
    },
    localPath(key) {
      const target = path.join(root, safeKey(key));
      return fs.existsSync(target) ? target : null;
    },
  };
}

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  json: 'application/json', jsonl: 'application/x-ndjson', md: 'text/markdown', txt: 'text/plain',
};

export function contentTypeFor(key: string): string {
  return CONTENT_TYPES[key.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
}

/** Local copy (the render keeps reading it) plus the bucket copy. */
export function bucketArtifactStore(local = localArtifactStore(), bucket: MediaBucket = mediaBucket(ARTIFACT_BUCKET)): ArtifactStore {
  return {
    async put(key, sourcePath) {
      const stored = await local.put(key, sourcePath);
      await bucket.upload(stored.storagePath, fs.readFileSync(sourcePath), contentTypeFor(stored.storagePath));
      return { ...stored, location: 'bucket' };
    },
    localPath: (key) => local.localPath(key),
  };
}

/** The store the worker uses: the bucket when EXPLAINERS_STORAGE=bucket, local disk otherwise. */
export function artifactStoreFromEnv(env: Record<string, string | undefined> = process.env): ArtifactStore {
  return env.EXPLAINERS_STORAGE?.trim() === 'bucket' ? bucketArtifactStore() : localArtifactStore();
}

/** Short-lived URL for a bucket artifact (the review page and Meta). */
export function signArtifact(key: string, expiresIn = 3600): Promise<string> {
  return mediaBucket(ARTIFACT_BUCKET).sign(key, expiresIn);
}
