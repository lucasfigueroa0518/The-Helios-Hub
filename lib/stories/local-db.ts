import fs from 'node:fs';
import path from 'node:path';

import { PGlite, type Transaction } from '@electric-sql/pglite';

import type { Queryable, StoriesDb } from '@/lib/stories/db';

/**
 * Local Postgres for Stories (PGlite: Postgres compiled to WASM). In-memory
 * for tests; a data directory on disk for local runs before the `stories`
 * schema is applied to Supabase. One process owns a data directory at a time.
 */

export const SCHEMA_PATH = path.join(process.cwd(), 'db', 'stories_schema.sql');
export const DEFAULT_LOCAL_DIR = path.join(process.cwd(), '.stories-local', 'pgdata');

/** The schema file minus psql meta-commands (`\set ...`), which PGlite cannot run. */
export function schemaSql(): string {
  return fs
    .readFileSync(SCHEMA_PATH, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
}

function wrap(target: PGlite | Transaction): Queryable {
  return {
    async query<T>(text: string, params?: unknown[]) {
      const result = await target.query<T>(text, params);
      return { rows: result.rows };
    },
  };
}

export function pgliteDb(pg: PGlite): StoriesDb {
  return { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) };
}

/** Open PGlite and apply the schema (idempotent). `dataDir` undefined means in-memory. */
export async function openLocalStoriesDb(dataDir?: string): Promise<{ db: StoriesDb; pg: PGlite }> {
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.exec(schemaSql());
  return { db: pgliteDb(pg), pg };
}
