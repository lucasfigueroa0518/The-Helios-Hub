/**
 * social.runs keeps small copies of the fields the hub reads (jev_usd,
 * cost_by_stage, post_summaries, shortlist) beside the ~1 MB `record`, filled
 * by a trigger (db/perf_2026_11_24_social_runs_summary.sql). Offline: the real
 * schema and migration files on in-memory PGlite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { insertRun, finishRun } from '@/lib/social/store/pg';
import type { Query } from '@/lib/social/store/pg';

const schemaSql = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function scratchDb(): Promise<{ query: Query; pg: PGlite }> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  const query: Query = async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
  return { query, pg };
}

const RECORD = {
  jev: { costUsd: 0.123456789 },
  result: {
    costByStage: { writer: 0.4, editor: 0.1 },
    posts: [
      { storyId: 'a', costUsd: 0.5, checks: { facts: 'ok' }, draft: 'x'.repeat(5000) },
      { storyId: 'b', render: { slides: [] } },
    ],
  },
  selection: { shortlist: [{ id: 'a', probSum: 3 }, { id: 'b', probSum: 2 }], scored: [{ id: 'c' }] },
};

const SUMMARY = `SELECT jev_usd::text AS jev, cost_by_stage, post_summaries, shortlist FROM social.runs WHERE id = $1`;

const insert = (query: Query, record: unknown) =>
  insertRun(query, {
    kind: 'daily', startedAt: '2026-11-24T08:00:00Z', finishedAt: '2026-11-24T08:30:00Z', hookPass: true, capUsd: 2,
    claudeUsd: 1, totalUsd: 1.2, stopReason: null, runDir: null, machine: null, record,
  });

test('a written run carries the hub columns, cut from its record', async () => {
  const { query } = await scratchDb();
  const id = await insert(query, RECORD);
  const [row] = (await query(SUMMARY, [id])).rows;
  assert.equal(row.jev, '0.123456789');
  assert.deepEqual(row.cost_by_stage, { writer: 0.4, editor: 0.1 });
  assert.deepEqual(row.post_summaries, [
    { storyId: 'a', costUsd: 0.5, checks: { facts: 'ok' } },
    { storyId: 'b', costUsd: null, checks: null },
  ]);
  assert.deepEqual(row.shortlist, RECORD.selection.shortlist);
});

test('odd JSON stores NULLs and never fails the write', async () => {
  const { query } = await scratchDb();
  const id = await insert(query, {
    jev: { costUsd: '1.5' },
    result: { costByStage: [1], posts: { storyId: 'a' } },
    selection: { shortlist: { id: 'x' } },
  });
  const [row] = (await query(SUMMARY, [id])).rows;
  assert.deepEqual(row, { jev: null, cost_by_stage: null, post_summaries: null, shortlist: null });

  const empty = await insert(query, { result: { posts: [] } });
  assert.deepEqual((await query(SUMMARY, [empty])).rows[0].post_summaries, []);
});

test('finishing a queued run fills the columns; updates that leave record alone keep them', async () => {
  const { query } = await scratchDb();
  const { rows } = await query(
    `INSERT INTO social.runs (kind, trigger, status, hook_pass, cap_usd, started_at) VALUES ('daily', 'manual', 'running', true, 2, now()) RETURNING id`,
  );
  const id = rows[0].id as string;
  assert.equal((await query(SUMMARY, [id])).rows[0].shortlist, null);

  await finishRun(query, id, {
    status: 'ok', finishedAt: '2026-11-24T09:00:00Z', hookPass: true, claudeUsd: 1, totalUsd: 1.2,
    stopReason: null, runDir: null, machine: null, record: RECORD,
  });
  assert.equal((await query(SUMMARY, [id])).rows[0].jev, '0.123456789');

  await query(`UPDATE social.runs SET stop_reason = 'note', ship_post_ids = '["p"]'::jsonb WHERE id = $1`, [id]);
  assert.deepEqual((await query(SUMMARY, [id])).rows[0].shortlist, RECORD.selection.shortlist);
});

test('migration: backfills rows written before it, reruns cleanly, and the down file removes it all', async () => {
  const { query, pg } = await scratchDb();
  // A row as it stands on prod before the migration: record only.
  await pg.exec(`ALTER TABLE social.runs DISABLE TRIGGER social_runs_fill_summary`);
  const id = await insert(query, RECORD);
  await pg.exec(`ALTER TABLE social.runs ENABLE TRIGGER social_runs_fill_summary`);
  assert.equal((await query(SUMMARY, [id])).rows[0].shortlist, null);

  await pg.exec(schemaSql('perf_2026_11_24_social_runs_summary.sql'));
  await pg.exec(schemaSql('perf_2026_11_24_social_runs_summary.sql'));
  const [row] = (await query(SUMMARY, [id])).rows;
  assert.equal(row.jev, '0.123456789');
  assert.equal(row.post_summaries.length, 2);
  assert.deepEqual(row.shortlist, RECORD.selection.shortlist);

  await pg.exec(schemaSql('perf_2026_11_24_social_runs_summary_down.sql'));
  const cols = (await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'social' AND table_name = 'runs'
       AND column_name IN ('jev_usd', 'cost_by_stage', 'post_summaries', 'shortlist')`,
  )).rows;
  assert.deepEqual(cols, []);
  assert.deepEqual((await query(`SELECT tgname FROM pg_trigger WHERE tgname = 'social_runs_fill_summary'`)).rows, []);
  // Writes still work without it, and record is intact.
  await insert(query, RECORD);
  assert.deepEqual((await query(`SELECT record->'jev' AS jev FROM social.runs WHERE id = $1`, [id])).rows[0].jev, RECORD.jev);
});
