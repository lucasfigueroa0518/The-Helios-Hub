/**
 * Read-only access to prod for the Phase 3 comparison (planning/Central Intake/PHASE3-CONTRACT.md, Owner D).
 *
 * Every query runs inside its own `BEGIN READ ONLY` ... `ROLLBACK` on one pooled client, which is then released.
 * There is never a session-level SET: DATABASE_URL is Supabase's transaction-mode pooler, where a session setting
 * sticks to a shared server connection and breaks other workers' writes (CLAUDE.md, 2026-10-14).
 */

export type ReadClient = {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  release(err?: Error | boolean): void;
};
export type ReadPool = { connect(): Promise<ReadClient> };
export type ReadQuery = <T>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;

/** Strips leading whitespace and SQL comments (`-- ...` lines and block comments). */
export function stripLeadingComments(text: string): string {
  let s = text;
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, '');
    if (s.startsWith('--')) s = s.replace(/^--[^\n]*(\n|$)/, '');
    else if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      s = end < 0 ? '' : s.slice(end + 2);
    }
    if (s === before) return s;
  }
}

/** True when the text is one SELECT or WITH statement that modifies nothing. */
export function isReadOnlySql(text: string): boolean {
  const body = stripLeadingComments(text);
  if (!/^(select|with)\b/i.test(body)) return false;
  // String literals can hold anything; judge the SQL around them.
  const bare = body.replace(/'(?:[^']|'')*'/g, "''").replace(/;\s*$/, '');
  // One statement only: a semicolon may end the text, never start a second statement.
  if (bare.includes(';')) return false;
  // A WITH can wrap a data-modifying statement (WITH x AS (DELETE ...)); SELECT ... INTO creates a table.
  if (/\b(insert\s+into|update\s+[\w."]+\s+set|delete\s+from|merge\s+into|truncate|into\s+(temp|temporary|unlogged|table)\b)/i.test(bare)) return false;
  return true;
}

/**
 * Runs one SELECT/WITH in a read-only transaction on one pooled client: BEGIN READ ONLY, the query, ROLLBACK,
 * release. Refuses anything else before touching the pool.
 */
export async function readOnlyQuery<T>(pool: ReadPool, text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
  if (!isReadOnlySql(text)) throw new Error(`readOnlyQuery refuses anything but one read-only SELECT or WITH: ${stripLeadingComments(text).slice(0, 60)}`);
  const client = await pool.connect();
  // A client whose BEGIN or ROLLBACK failed is destroyed rather than returned to the pool.
  let broken: Error | undefined;
  try {
    try {
      await client.query('BEGIN READ ONLY');
    } catch (err) {
      broken = err instanceof Error ? err : new Error(String(err));
      throw err;
    }
    try {
      const res = await client.query(text, params);
      return { rows: res.rows as T[] };
    } finally {
      try {
        await client.query('ROLLBACK');
      } catch (err) {
        broken = err instanceof Error ? err : new Error(String(err));
      }
    }
  } finally {
    client.release(broken);
  }
}

/** A `ReadQuery` bound to one pool. */
export function readOnly(pool: ReadPool): ReadQuery {
  return <T,>(text: string, params?: unknown[]) => readOnlyQuery<T>(pool, text, params ?? []);
}
