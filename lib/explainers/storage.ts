import fs from 'node:fs';
import path from 'node:path';

/**
 * Where render outputs live. Local disk until a run validates the product
 * (Lucas, 2026-10-07); the Supabase bucket and size limit are E-22's decision.
 * Keys look like `jobs/<jobId>/video.mp4`.
 */
export interface ArtifactStore {
  put(key: string, sourcePath: string): Promise<{ storagePath: string; bytes: number }>;
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
