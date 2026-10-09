import { dbQuery } from '@/lib/db';
import { explainersDb } from '@/lib/explainers/connection';

/**
 * The only database handle hub reads use: a SELECT-only query function.
 * Live pages pass `liveHubQuery`; tests pass PGlite (tests/fixtures/social-hub/pglite.ts).
 */
export type HubQuery = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;

export const liveHubQuery: HubQuery = async <T,>(text: string, params?: unknown[]) => {
  const result = await dbQuery(text, params);
  return { rows: result.rows as T[] };
};

/**
 * Explainer Reels keep their own database handle (lib/explainers/connection.ts).
 * The hub reads it only when that handle is a real Postgres
 * (`EXPLAINERS_DATABASE_URL`, or `EXPLAINERS_DB=supabase`). In local PGlite
 * mode, opening it would create the folder and apply the schema (DDL), so the
 * hub shows a note instead (DECISIONS_LOG D19).
 */
export async function explainersHubQuery(): Promise<HubQuery> {
  const ownUrl = Boolean(process.env.EXPLAINERS_DATABASE_URL?.trim());
  if (!ownUrl && process.env.EXPLAINERS_DB !== 'supabase') {
    throw new Error('Explainer Reels use a local development database on this machine. Open /explainers to see them.');
  }
  const db = await explainersDb();
  return async <T,>(text: string, params?: unknown[]) => db.query<T>(text, params);
}
