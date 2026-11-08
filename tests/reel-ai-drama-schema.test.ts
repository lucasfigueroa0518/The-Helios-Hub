import assert from 'node:assert/strict';
import { test } from 'node:test';

import { holdAwake } from '@/lib/reel-ai-drama/render/runner';
import { ensureReelAiDramaSchema, reelAiDramaStatements, schemaDdlAllowed, SchemaNotAppliedError } from '@/lib/reel-ai-drama/schema';

import { scratchExplainersDb } from './explainers-pglite';

test('the schema applies twice cleanly and seeds the safe posting defaults', async () => {
  const { db } = await scratchExplainersDb();
  for (let pass = 0; pass < 2; pass += 1) for (const sql of reelAiDramaStatements()) await db.query(sql);
  const { rows } = await db.query<{ key: string; value: unknown }>(`SELECT key, value FROM reel_ai_drama.settings WHERE key IN ('publishing_live', 'require_approval') ORDER BY key`);
  assert.deepEqual(rows, [{ key: 'publishing_live', value: false }, { key: 'require_approval', value: true }]);
  for (const table of ['feedback', 'requests', 'calibration_reports', 'nights', 'worker_state']) {
    const { rows: r } = await db.query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`reel_ai_drama.${table}`]);
    assert.equal(r[0].ok, true, table);
  }
});

test('off local, ensure only checks: a fresh database throws, an applied one passes, no DDL runs', async () => {
  const supabase = { EXPLAINERS_DB: 'supabase' };
  const { db: fresh } = await scratchExplainersDb();
  await assert.rejects(ensureReelAiDramaSchema(fresh, { env: supabase }), (e: unknown) => e instanceof SchemaNotAppliedError);
  const { rows } = await fresh.query<{ ok: boolean }>(`SELECT to_regclass('reel_ai_drama.jobs') IS NULL AS ok`);
  assert.equal(rows[0].ok, true, 'nothing was created');

  const { db: applied } = await scratchExplainersDb();
  for (const sql of reelAiDramaStatements()) await applied.query(sql);
  await ensureReelAiDramaSchema(applied, { env: supabase });
});

test('schemaDdlAllowed: local by default, never on Supabase or a remote URL unless forced', () => {
  assert.equal(schemaDdlAllowed({}), true);
  assert.equal(schemaDdlAllowed({ EXPLAINERS_DB: 'supabase' }), false);
  assert.equal(schemaDdlAllowed({ EXPLAINERS_DATABASE_URL: 'postgres://u@localhost:5432/x' }), true);
  assert.equal(schemaDdlAllowed({ EXPLAINERS_DATABASE_URL: 'postgres://u@db.example.supabase.co:6543/x' }), false);
  assert.equal(schemaDdlAllowed({ EXPLAINERS_DATABASE_URL: 'not a url' }), false);
  assert.equal(schemaDdlAllowed({ EXPLAINERS_DB: 'supabase', REEL_AI_DRAMA_AUTO_SCHEMA: '1' }), true);
});

test('holdAwake is a no-op off macOS', () => {
  let spawned = 0;
  const release = holdAwake({ platform: 'linux', spawner: (() => { spawned += 1; }) as never });
  release();
  assert.equal(spawned, 0);
});
