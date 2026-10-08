/**
 * In-memory Postgres for the explainers tests: the real
 * db/explainers_schema.sql on PGlite, with no network and no Supabase project.
 */
import { openLocalDb } from '@/lib/explainers/local-db';

export { schemaSql } from '@/lib/explainers/local-db';

export function scratchExplainersDb() {
  return openLocalDb();
}
