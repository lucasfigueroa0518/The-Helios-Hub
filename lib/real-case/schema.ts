import fs from 'node:fs';
import path from 'node:path';

import type { Queryable } from '@/lib/explainers/db';

/**
 * Real Case Reels share Explainer Reels' database connection (`explainersDb()`), so they can read
 * explainers.topics, and keep every table of their own in the `real_case` schema (RC-01). The
 * schema is applied here, by this route, so the Explainer schema loader is never touched.
 */

export const REAL_CASE_SCHEMA_PATH = path.join(process.cwd(), 'db', 'real_case_schema.sql');

/**
 * The schema file as single statements, minus psql meta-commands (`\set ...`) and comment lines.
 * One statement per call keeps it working on PGlite's `query` as well as on pg. The file has no
 * dollar-quoted bodies, so a statement ends at a line ending in `;`.
 */
export function realCaseStatements(file: string = REAL_CASE_SCHEMA_PATH): string[] {
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
  if (current.join('').trim()) throw new Error('real_case_schema.sql ends without a semicolon');
  return statements;
}

const applied = new WeakSet<object>();

/** Apply the schema once per connection (idempotent SQL, so a second apply is harmless). */
export async function ensureRealCaseSchema(db: Queryable): Promise<void> {
  if (applied.has(db)) return;
  for (const sql of realCaseStatements()) await db.query(sql);
  applied.add(db);
}
