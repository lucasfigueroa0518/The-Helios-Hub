import fs from 'node:fs';
import path from 'node:path';

import type { PGlite, Transaction } from '@electric-sql/pglite';

import { TEMPLATE_CATALOG } from './catalog';
import { dhash } from './phash';

/**
 * The meme lab's database (planning/Memes/BUILD_PLAN.md M0): the `memes`
 * schema on local PGlite (Postgres compiled to WASM), the pattern Stories
 * used before its schema reached Supabase. In-memory for tests; a data
 * directory on disk for the lab. One process owns a data directory at a time.
 * The schema is applied to Supabase only when Lucas says so.
 */
export type Queryable = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type MemesDb = Queryable & {
  transaction<R>(fn: (tx: Queryable) => Promise<R>): Promise<R>;
};

export const SCHEMA_PATH = path.join(process.cwd(), 'db', 'memes_schema.sql');
export const DEFAULT_LOCAL_DIR = path.join(process.cwd(), '.memes-local', 'pgdata');

function wrap(target: PGlite | Transaction): Queryable {
  return {
    async query<T>(text: string, params?: unknown[]) {
      const result = await target.query<T>(text, params);
      return { rows: result.rows };
    },
  };
}

export function pgliteDb(pg: PGlite): MemesDb {
  return { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) };
}

/** Open PGlite, apply the schema (idempotent) and sync the catalog. `dataDir` undefined means in-memory. */
export async function openLocalMemesDb(dataDir?: string): Promise<{ db: MemesDb; pg: PGlite }> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const db = pgliteDb(pg);
  await syncCatalog(db, await catalogHashes());
  return { db, pg };
}

let hashCache: Promise<Record<string, string>> | null = null;

/** Every catalog image's perceptual hash (ME-45's safety net), computed once per process. */
export function catalogHashes(): Promise<Record<string, string>> {
  hashCache ??= Promise.all(
    TEMPLATE_CATALOG.map(async (t) => [t.id, await dhash(path.join(process.cwd(), 'lib/memes/assets/templates', t.image))] as const),
  ).then(Object.fromEntries);
  return hashCache;
}

/**
 * Write the approved cards into memes.templates (upsert by id). The file is
 * the source of truth; the table is what SQL (the 90-day gate) joins on.
 * `hashes` are the images' perceptual hashes, when known (M1).
 */
export async function syncCatalog(db: Queryable, hashes: Record<string, string> = {}): Promise<number> {
  for (const t of TEMPLATE_CATALOG) {
    await db.query(
      `INSERT INTO memes.templates (id, imgflip_id, name, family_key, status, source, image_path, image_hash, card, synced_at)
       VALUES ($1, $2, $3, $4, 'approved', 'classic', $5, $6, $7::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET imgflip_id = EXCLUDED.imgflip_id, name = EXCLUDED.name, family_key = EXCLUDED.family_key,
         status = EXCLUDED.status, image_path = EXCLUDED.image_path, image_hash = COALESCE(EXCLUDED.image_hash, memes.templates.image_hash),
         card = EXCLUDED.card, synced_at = now()`,
      [t.id, t.imgflipId, t.name, t.family, `lib/memes/assets/templates/${t.image}`, hashes[t.id] ?? null, JSON.stringify(t)],
    );
  }
  return TEMPLATE_CATALOG.length;
}
