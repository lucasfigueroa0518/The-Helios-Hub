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

export async function openHubTestDb(opts: { withHubSchema?: boolean } = {}): Promise<{ pg: PGlite; query: HubQuery }> {
  const pg = new PGlite({ extensions: { pg_trgm } });
  for (const schema of SCHEMAS) await pg.exec(schemaSql(`${schema}_schema.sql`));
  if (opts.withHubSchema) await pg.exec(schemaSql('social_hub_schema.sql'));
  const query: HubQuery = async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] });
  return { pg, query };
}
