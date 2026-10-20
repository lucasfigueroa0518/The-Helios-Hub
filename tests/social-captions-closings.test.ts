import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { CLOSINGS_WINDOW } from '@/lib/social/captions/build-line';
import { closingsLog, recentClosings, recordClosing, type Query } from '@/lib/social/captions/closings-store';


/** Scratch DB with only the caption_closings block of the real schema file applied. */
async function scratch(): Promise<Query> {
  const db = new PGlite();
  const sql = fs.readFileSync(path.join(process.cwd(), 'db', 'social_hub_schema.sql'), 'utf8');
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS social_hub.caption_closings');
  assert.ok(start >= 0, 'caption_closings block missing from schema');
  await db.query('CREATE SCHEMA IF NOT EXISTS social_hub');
  // The slice splits on ';' and assumes no semicolons inside literals.
  const block = sql.slice(start);
  for (const stmt of block.split(';').map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
  return (text, params) => db.query(text, params as any[]);
}

test('records and returns newest first, per type', async () => {
  const q = await scratch();
  await recordClosing(q, { type: 'carousel', subjectId: 'a', closing: 'first', buildLine: false });
  await recordClosing(q, { type: 'carousel', subjectId: 'b', closing: 'second', buildLine: true });
  await recordClosing(q, { type: 'reel', subjectId: 'r', closing: 'reel one', buildLine: false });
  await recordClosing(q, { type: 'carousel', subjectId: 'c', closing: 'third', buildLine: false });
  const rows = await recentClosings(q, 'carousel');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.closing), ['third', 'second', 'first']);
  assert.deepEqual(rows.map((r) => r.buildLine), [false, true, false]);
  assert.ok(rows[0].createdAt instanceof Date);
});

test('limit caps the window', async () => {
  const q = await scratch();
  for (let i = 0; i < 8; i++) await recordClosing(q, { type: 'lfd', subjectId: `s${i}`, closing: `c${i}`, buildLine: false });
  assert.equal((await recentClosings(q, 'lfd')).length, CLOSINGS_WINDOW);
  assert.equal((await recentClosings(q, 'lfd', 3)).length, 3);
});

test('closingsLog binds the type and swallows record failures', async () => {
  const q = await scratch();
  const log = closingsLog(q, 'explainer');
  await log.record('e1', 'closing', true);
  assert.equal((await log.recent()).length, 1);
  assert.equal((await recentClosings(q, 'carousel')).length, 0);
  const failing: Query = async () => {
    throw new Error('db down');
  };
  await assert.doesNotReject(closingsLog(failing, 'reel').record('x', 'y', false));
});
