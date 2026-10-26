/**
 * The simulation's database handle (LFD lab plan §5): Tommy's engine sees one
 * query function, and this one splits it.
 * - Every write, and every read of lfd.runs, goes to the lab's own PGlite.
 * - Every other read goes to the Hub (Supabase), read only: the real stories,
 *   carousel runs and previous posts.
 * The Hub side refuses anything that isn't a plain read, so a simulation can
 * never write to Supabase.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { HubQuery } from '@/lib/social-hub/db';

import type { Queryable } from '../db';

const READ = /^\s*(?:--[^\n]*\n\s*)*(select|with)\b/i;
const WRITE_WORDS = /\b(insert\s+into|update\s+\w|delete\s+from|truncate|alter\s|drop\s|create\s|grant\s|revoke\s)/i;

export const isRead = (sql: string) => READ.test(sql) && !WRITE_WORDS.test(sql);
const touchesRuns = (sql: string) => /\blfd\.runs\b/i.test(sql);

/** A Hub handle that only reads. */
export function readOnly(hub: HubQuery): HubQuery {
  return async <T,>(text: string, params?: unknown[]) => {
    if (!isRead(text)) throw new Error(`The LFD simulation refused to send a non-read statement to the Hub: ${text.trim().slice(0, 60)}`);
    return hub<T>(text, params);
  };
}

export function simQuery(local: Queryable, hub: HubQuery): HubQuery {
  const safeHub = readOnly(hub);
  return async <T,>(text: string, params?: unknown[]) => {
    if (!READ.test(text) || touchesRuns(text)) return local.query<T>(text, params);
    return safeHub<T>(text, params);
  };
}

/**
 * Re-apply the memes schema (idempotent): a lab server that opened its database before the LFD lab's tables
 * existed gets them without a restart.
 */
export async function ensureMemesSchema(local: Queryable): Promise<void> {
  for (const stmt of splitSql(fs.readFileSync(path.join(process.cwd(), 'db', 'memes_schema.sql'), 'utf8'))) await local.query(stmt);
}

/** Put the lfd schema in the lab database (the psql-only lines dropped), once per process. */
export async function ensureLfdSchema(local: Queryable): Promise<void> {
  const sql = fs
    .readFileSync(path.join(process.cwd(), 'db', 'lfd_schema.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
  const exec = (local as unknown as { exec?: (s: string) => Promise<unknown> }).exec;
  if (exec) await exec.call(local, sql);
  else for (const stmt of splitSql(sql)) await local.query(stmt);
}

/** Split on semicolons at the end of a line (lfd_schema.sql has no functions or quoted semicolons). */
export function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}
