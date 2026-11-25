import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recordCost, spendFor } from '@/lib/reel-ai-drama/cost';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS, loadSettings, saveSetting } from '@/lib/reel-ai-drama/settings';

import { scratchExplainersDb } from './explainers-pglite';

async function freshDb() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  return db;
}

test('the schema applies twice and settings round-trip over defaults', async () => {
  const db = await freshDb();
  await ensureReelAiDramaSchema(db);
  assert.deepEqual(await loadSettings(db), DEFAULT_SETTINGS);
  await saveSetting(db, 'reuse_days', 21);
  assert.equal((await loadSettings(db)).reuse_days, 21);
  await assert.rejects(saveSetting(db, 'visuals_check_cap_usd', 0.5));
});

test('a cost event moves its job spend; unknown prices are stored as zero', async () => {
  const db = await freshDb();
  const { rows: [pitch] } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.pitches (title, pitch, event_key) VALUES ('t', '{}'::jsonb, 'k') RETURNING id`,
  );
  const { rows: [job] } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.jobs (pitch_id, mode, spend_cap_usd) VALUES ($1, 'development', 8) RETURNING id`,
    [pitch.id],
  );
  await recordCost(db, { jobId: job.id, mode: 'development', vendor: 'anthropic', component: 'writer', usd: 0.25 });
  await recordCost(db, { jobId: job.id, mode: 'development', vendor: 'heygen', component: 'tts', usd: null });
  assert.equal(await spendFor(db, { jobId: job.id }), 0.25);
  const { rows } = await db.query<{ spend_usd: unknown }>('SELECT spend_usd FROM reel_ai_drama.jobs WHERE id = $1', [job.id]);
  assert.equal(Number(rows[0].spend_usd), 0.25);
});
