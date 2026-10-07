import { dbQuery, dbTransaction } from '@/lib/db';

/**
 * The slice of a Postgres client the explainers repository needs. The live
 * implementation is the shared pg pool; tests pass an in-process PGlite so the
 * SQL runs for real without a network or a Supabase project.
 */
export type Queryable = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type ExplainersDb = Queryable & {
  transaction<R>(fn: (tx: Queryable) => Promise<R>): Promise<R>;
};

export const liveExplainersDb: ExplainersDb = {
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
