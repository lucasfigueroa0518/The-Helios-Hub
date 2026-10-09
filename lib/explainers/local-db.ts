import fs from 'node:fs';
import path from 'node:path';

import { PGlite, type Transaction } from '@electric-sql/pglite';

import type { ExplainersDb, Queryable } from '@/lib/explainers/db';

/**
 * Local Postgres for Explainer Reels. Until a run validates the product, the
 * `explainers` schema lives only here, never in Supabase. PGlite is Postgres
 * compiled to WASM: in-memory for tests, a data directory on disk for dev.
 *
 * One process owns a data directory at a time. The dev server and a local
 * worker cannot open the same directory concurrently.
 */

export const SCHEMA_PATH = path.join(process.cwd(), 'db', 'explainers_schema.sql');
/** The lifecycle spine Explainers schedule and publish on (D36). Self-contained, so it applies here too. */
export const SPINE_SCHEMA_PATH = path.join(process.cwd(), 'db', 'social_hub_schema.sql');
export const DEFAULT_LOCAL_DIR = path.join(process.cwd(), '.explainers-local', 'pgdata');

/** A schema file minus psql meta-commands (`\set ...`), which PGlite cannot run. */
export function schemaSql(file: string = SCHEMA_PATH): string {
  return fs
    .readFileSync(file, 'utf8')
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

export function pgliteDb(pg: PGlite): ExplainersDb {
  return {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
  };
}

/**
 * Open a PGlite database and apply the schema (idempotent). `dataDir`
 * undefined means in-memory.
 */
export async function openLocalDb(dataDir?: string): Promise<{ db: ExplainersDb; pg: PGlite }> {
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.exec(schemaSql());
  await pg.exec(schemaSql(SPINE_SCHEMA_PATH));
  return { db: pgliteDb(pg), pg };
}
