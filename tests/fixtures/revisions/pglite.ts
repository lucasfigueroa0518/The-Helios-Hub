/** Shared PGlite setup for the revisions tests: real schema files, one carousels content item. */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import type { Query } from '@/lib/social/store/pg';
import { schemaSql } from '@/lib/stories/local-db';

export async function setupRevisionsDb(): Promise<{ q: Query; itemId: string }> {
  const pg = new PGlite();
  await pg.exec(schemaSql(path.join(process.cwd(), 'db', 'social_hub_schema.sql')));
  await pg.exec(schemaSql(path.join(process.cwd(), 'db', 'revisions_schema.sql')));
  const q: Query = async (text, params) => ({ rows: (await pg.query<Record<string, unknown>>(text, params)).rows });
  const { rows } = await q(
    `INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('carousels', 'feed', 'p1') RETURNING id`,
  );
  return { q, itemId: String(rows[0].id) };
}
