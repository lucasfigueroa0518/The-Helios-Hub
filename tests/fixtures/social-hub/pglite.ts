/**
 * Offline database for Social Hub read-query tests: PGlite loaded with the
 * real, unmodified schema files of every vertical (read from db/, never
 * edited). Tests insert fixture rows here; hub code only SELECTs.
 */
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { HubQuery } from '@/lib/social-hub/db';

const SCHEMAS = ['reels', 'explainers', 'social', 'stories'] as const;

function schemaSql(file: string): string {
  return readFileSync(path.join(process.cwd(), 'db', file), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
}

/** The account-insight tables the P2-M1 sweep fills; the "not applied yet" states are tested without them. */
const ACCOUNT_TABLES = ['account_insights_daily', 'account_demographics_daily', 'online_followers_daily', 'refreshes', 'publishing_quota'];

/**
 * The lifecycle spine (social_hub content_items … media_insights) is always
 * there: Carousels live on it (D36). `withHubSchema: false` leaves out only
 * the account tables.
 */
export async function openHubTestDb(opts: { withHubSchema?: boolean } = {}): Promise<{ pg: PGlite; query: HubQuery }> {
  const pg = new PGlite({ extensions: { pg_trgm } });
  for (const schema of SCHEMAS) await pg.exec(schemaSql(`${schema}_schema.sql`));
  await pg.exec(schemaSql('social_hub_schema.sql'));
  if (!opts.withHubSchema) {
    for (const table of ACCOUNT_TABLES) await pg.exec(`DROP TABLE social_hub.${table}`);
  }
  const query: HubQuery = async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] });
  return { pg, query };
}
