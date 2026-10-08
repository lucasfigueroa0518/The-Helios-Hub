import { Pool } from 'pg';

import { liveExplainersDb, type ExplainersDb, type Queryable } from '@/lib/explainers/db';
import { DEFAULT_LOCAL_DIR, openLocalDb } from '@/lib/explainers/local-db';

const cache = globalThis as typeof globalThis & {
  __explainersDb?: Promise<ExplainersDb>;
};

/** A Postgres URL of our own (the local Postgres from `npm run explainers:db`). */
export function urlExplainersDb(connectionString: string): ExplainersDb {
  const pool = new Pool({ connectionString, max: 5 });
  return {
    async query<T>(text: string, params?: unknown[]) {
      const result = await pool.query(text, params);
      return { rows: result.rows as T[] };
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: Queryable = {
          async query<T>(text: string, params?: unknown[]) {
            const result = await client.query(text, params);
            return { rows: result.rows as T[] };
          },
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * The database the app and the worker use for Explainer Reels.
 *
 * - `EXPLAINERS_DATABASE_URL` set → that Postgres. Locally this is the
 *   embedded Postgres from `npm run explainers:db`, which the dev server and
 *   the worker share.
 * - `EXPLAINERS_DB=supabase` → the shared Supabase pool. Stays off until a run
 *   validates the product.
 * - Neither → a single-process PGlite folder (`EXPLAINERS_LOCAL_DIR`, default
 *   `.explainers-local/pgdata`). Fine for the app alone; the worker refuses it.
 *
 * Cached on globalThis so dev hot reloads reuse one connection.
 */
export function explainersDb(): Promise<ExplainersDb> {
  if (!cache.__explainersDb) {
    const url = process.env.EXPLAINERS_DATABASE_URL?.trim();
    if (url) cache.__explainersDb = Promise.resolve(urlExplainersDb(url));
    else if (process.env.EXPLAINERS_DB === 'supabase') cache.__explainersDb = Promise.resolve(liveExplainersDb);
    else {
      cache.__explainersDb = openLocalDb(process.env.EXPLAINERS_LOCAL_DIR || DEFAULT_LOCAL_DIR).then(
        ({ db }) => db,
      );
    }
  }
  return cache.__explainersDb;
}
