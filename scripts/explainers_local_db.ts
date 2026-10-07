/**
 * Local Postgres for Explainer Reels, until a run validates the product
 * (Lucas, 2026-10-07: no Supabase, no commits). A real Postgres 17 from the
 * `embedded-postgres` npm package — no system install — so the dev server and
 * the worker can share one database with real transactions.
 *
 *   npm run explainers:db      # start; leave it running in its own terminal
 *
 * Then run the app and the worker with
 *   EXPLAINERS_DATABASE_URL=postgres://helios:helios-local@127.0.0.1:54329/explainers
 *
 * First start: initialises `.explainers-local/pg17`, applies the schema, and
 * copies every row from the earlier PGlite database (`.explainers-local/pgdata`)
 * once. Later starts re-apply the idempotent schema only. Stop the dev server
 * before the first start: PGlite's folder must not be open in two processes.
 */
import fs from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';

import { schemaSql } from '@/lib/explainers/local-db';

const ROOT = process.env.EXPLAINERS_LOCAL_ROOT || path.join(process.cwd(), '.explainers-local');
const DATA_DIR = path.join(ROOT, 'pg17');
const PGLITE_DIR = path.join(ROOT, 'pgdata');
const MIGRATED_MARKER = path.join(ROOT, 'pg17-migrated-from-pglite');

export const LOCAL_DB = {
  user: 'helios',
  password: 'helios-local',
  port: 54329,
  database: 'explainers',
};
export const LOCAL_DB_URL = `postgres://${LOCAL_DB.user}:${LOCAL_DB.password}@127.0.0.1:${LOCAL_DB.port}/${LOCAL_DB.database}`;

/** Tables in foreign-key order. `seq` identity columns are regenerated, not copied. */
/** Columns that can point at a row inserted later: inserted empty, then patched. */
const FORWARD_REFS: Record<string, string[]> = {
  idea_cycles: ['promoted_topic_id'],
  topics: ['duplicate_of'],
};
const TABLES = [
  'settings',
  'theme_briefs',
  'idea_cycles',
  'topics',
  'jobs',
  'artifacts',
  'lint_violations',
  'feedback',
  'cost_events',
  'jev_logs',
];

async function copyFromPglite(client: pg.Client): Promise<void> {
  if (!fs.existsSync(PGLITE_DIR) || fs.existsSync(MIGRATED_MARKER)) return;
  const lite = new PGlite(PGLITE_DIR);
  try {
    await client.query('BEGIN');
    // Seeded defaults would collide with the copied rows; the copy is the truth.
    await client.query('DELETE FROM explainers.settings');
    await client.query('DELETE FROM explainers.theme_briefs');
    const patches: { table: string; id: unknown; col: string; value: unknown }[] = [];
    // PGlite returns jsonb parsed; node-pg must receive it serialized.
    // A NOT NULL jsonb column holding JSON null comes back as JS null too, so
    // those are always serialized ('null'); nullable ones keep SQL NULL.
    const jsonb = await client.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'explainers' AND data_type = 'jsonb'`,
    );
    const jsonCol = (table: string, col: string) =>
      jsonb.rows.find((r) => r.table_name === table && r.column_name === col);
    for (const table of TABLES) {
      const { rows } = await lite.query<Record<string, unknown>>(`SELECT * FROM explainers.${table}`);
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => c !== 'seq');
        const values = cols.map((c) => {
          const v = row[c];
          if (FORWARD_REFS[table]?.includes(c) && v !== null) {
            patches.push({ table, id: row.id, col: c, value: v });
            return null;
          }
          const json = jsonCol(table, c);
          if (!json) return v;
          return v === null && json.is_nullable === 'YES' ? null : JSON.stringify(v);
        });
        await client.query(
          `INSERT INTO explainers.${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          values,
        );
      }
      console.log(`  copied ${rows.length} row(s) from explainers.${table}`);
    }
    for (const p of patches) {
      await client.query(`UPDATE explainers.${p.table} SET ${p.col} = $2 WHERE id = $1`, [p.id, p.value]);
    }
    await client.query('COMMIT');
    fs.writeFileSync(MIGRATED_MARKER, `${new Date().toISOString()}\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await lite.close();
  }
}

async function main(): Promise<void> {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  fs.mkdirSync(ROOT, { recursive: true });
  const fresh = !fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: LOCAL_DB.user,
    password: LOCAL_DB.password,
    port: LOCAL_DB.port,
    // false would DELETE the data directory on stop.
    persistent: true,
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
  });
  if (fresh) await server.initialise();
  await server.start();
  if (fresh) await server.createDatabase(LOCAL_DB.database);

  const client = server.getPgClient(LOCAL_DB.database, '127.0.0.1');
  await client.connect();
  try {
    await client.query(schemaSql());
    await copyFromPglite(client);
    const { rows } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM explainers.topics');
    console.log(`✓ explainers local Postgres ready: ${rows[0].n} topic(s)`);
    console.log(`  EXPLAINERS_DATABASE_URL=${LOCAL_DB_URL}`);
  } finally {
    await client.end();
  }

  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (process.argv.includes('--check')) await stop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
