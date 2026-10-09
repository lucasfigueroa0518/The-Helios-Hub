import { dbQuery, dbTransaction } from '@/lib/db';

/**
 * The slice of a Postgres client the Stories repository needs. The live
 * implementation is the shared pg pool; tests (and local runs before the
 * schema is applied to Supabase) pass PGlite so the SQL runs for real.
 * Same shape as the explainers' (copied, not imported: S-31).
 */
export type Queryable = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type StoriesDb = Queryable & {
  transaction<R>(fn: (tx: Queryable) => Promise<R>): Promise<R>;
};

export const liveStoriesDb: StoriesDb = {
  async query<T>(text: string, params?: unknown[]) {
    const result = await dbQuery(text, params);
    return { rows: result.rows as T[] };
  },
  transaction(fn) {
    return dbTransaction((client) =>
      fn({
        async query<T>(text: string, params?: unknown[]) {
          const result = await client.query(text, params);
          return { rows: result.rows as T[] };
        },
      }),
    );
  },
};
