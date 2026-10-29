import fs from 'node:fs';
import path from 'node:path';

import type { Queryable } from '@/lib/explainers/db';

/**
 * Reel AI Drama keeps its own `reel_ai_drama` schema on the explainers connection (MD-10). Applied
 * here, once per connection, so no other schema loader is touched.
 */

export const REEL_AI_DRAMA_SCHEMA_PATH = path.join(process.cwd(), 'db', 'reel_ai_drama_schema.sql');

/** The schema file as single statements, minus psql meta-commands and comment lines (no `$$` bodies). */
export function reelAiDramaStatements(file: string = REEL_AI_DRAMA_SCHEMA_PATH): string[] {
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\') && !line.trim().startsWith('--'));
  const statements: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    current.push(line);
    if (line.trimEnd().endsWith(';')) {
      const sql = current.join('\n').trim();
      if (sql) statements.push(sql);
      current = [];
    }
  }
  if (current.join('').trim()) throw new Error('reel_ai_drama_schema.sql ends without a semicolon');
  return statements;
}

const applied = new WeakSet<object>();

export async function ensureReelAiDramaSchema(db: Queryable): Promise<void> {
  if (applied.has(db)) return;
  for (const sql of reelAiDramaStatements()) await db.query(sql);
  applied.add(db);
}
