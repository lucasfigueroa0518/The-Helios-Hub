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

export const SCHEMA_NOT_APPLIED = 'Reel AI Drama schema is not applied (npm run db:reel-ai-drama).';

export class SchemaNotAppliedError extends Error {
  constructor() {
    super(SCHEMA_NOT_APPLIED);
  }
}

/**
 * Whether this process may run the schema's DDL itself: the handle is the local PGlite (no
 * EXPLAINERS_DATABASE_URL and no EXPLAINERS_DB=supabase), a local embedded Postgres URL, or
 * REEL_AI_DRAMA_AUTO_SCHEMA=1. Production (Vercel routes, the worker) never does: its DROP/ADD
 * CONSTRAINT statements would take ACCESS EXCLUSIVE locks. Lucas applies it with `npm run db:reel-ai-drama`.
 */
export function schemaDdlAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.REEL_AI_DRAMA_AUTO_SCHEMA?.trim() === '1') return true;
  if (env.EXPLAINERS_DB?.trim() === 'supabase') return false;
  const url = env.EXPLAINERS_DATABASE_URL?.trim();
  if (!url) return true;
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Locally: apply the schema once per connection. Elsewhere: only check that it is there
 * (`to_regclass('reel_ai_drama.feedback')`, the newest table) and throw SchemaNotAppliedError when it isn't. Never DDL there.
 */
export async function ensureReelAiDramaSchema(db: Queryable, opts: { env?: Record<string, string | undefined> } = {}): Promise<void> {
  if (applied.has(db)) return;
  if (schemaDdlAllowed(opts.env)) {
    for (const sql of reelAiDramaStatements()) await db.query(sql);
  } else {
    const { rows } = await db.query<{ ready: boolean }>(`SELECT to_regclass('reel_ai_drama.feedback') IS NOT NULL AS ready`);
    if (!rows[0]?.ready) throw new SchemaNotAppliedError();
  }
  applied.add(db);
}
