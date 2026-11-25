/**
 * AI Drama Reels on the spine (planning/AI Mini Docs/HUB-WIRING-CONTRACT.md §3.2): both schema files apply
 * twice on PGlite, drama rows are accepted, and explainers rows keep exactly their old rules. Offline.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const sql = (file: string) =>
  readFileSync(path.join(process.cwd(), 'db', file), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');

async function db() {
  const { pg } = await openHubTestDb();
  // openHubTestDb applied social_hub once; apply both files (again) to prove they are idempotent.
  await pg.exec(sql('social_hub_schema.sql'));
  await pg.exec(sql('revisions_schema.sql'));
  await pg.exec(sql('revisions_schema.sql'));
  return pg;
}

const item = async (pg: Awaited<ReturnType<typeof db>>, vertical: string, ref: string) =>
  (await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ($1, 'reel', $2) RETURNING id`, [vertical, ref])).rows[0]!.id;

const book = (pg: Awaited<ReturnType<typeof db>>, id: string, vertical: string, slot: string, feedMode: string | null) =>
  pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
     VALUES ($1, $2, '2026-11-09', $3, '2026-11-10T01:00:00Z', 'scheduled', 'auto', $4)`,
    [id, vertical, slot, feedMode],
  );

test('drama rows are accepted on every spine table and revisions.requests', async () => {
  const pg = await db();
  const id = await item(pg, 'reel_ai_drama', 'job-1');
  await book(pg, id, 'reel_ai_drama', 'evening', 'main');
  await book(pg, await item(pg, 'reel_ai_drama', 'job-1b'), 'reel_ai_drama', 't1200', null);
  await pg.query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'reel_ai_drama', 'auto', 'requested', 'c')`, [id]);
  await pg.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('reel_ai_drama', 'reel_ai_drama:pitch:p1', '2026-11-09', 'promote')`);
  await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series, feed_mode) VALUES (1, 'reel_ai_drama', 1200, NULL, 'main')`);
  await pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, start_minute, series, action, feed_mode) VALUES ('2026-11-09', 'reel_ai_drama', 1200, NULL, 'add', 'main')`);
  await pg.query(`INSERT INTO revisions.requests (vertical, item_id, instruction) VALUES ('reel_ai_drama', $1, 'tighten the hook')`, [id]);
});

test('drama keeps the reel rules: no other window, a Trial/Main feed mode, no mix_test', async () => {
  const pg = await db();
  const id = await item(pg, 'reel_ai_drama', 'job-2');
  await assert.rejects(book(pg, id, 'reel_ai_drama', 'afternoon', null), /schedule_slot_check/);
  await assert.rejects(book(pg, id, 'reel_ai_drama', 'evening', 'feed'), /schedule_feed_mode_check/);
  await assert.rejects(
    pg.query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'reel_ai_drama', 'mix_test', 'requested', 'c')`, [id]),
    /publish_attempts_trigger_check/,
  );
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series, feed_mode) VALUES (1, 'reel_ai_drama', 1200, NULL, NULL)`), /feed_mode/);
});

test('explainers rows are unchanged, and an unknown type is still refused', async () => {
  const pg = await db();
  const id = await item(pg, 'explainers', 'job-3');
  await book(pg, id, 'explainers', 'afternoon', 'main');
  await assert.rejects(book(pg, id, 'explainers', 'evening', null), /schedule_slot_check/);
  await assert.rejects(item(pg, 'drama', 'job-4'), /content_items_vertical_check/);
  await assert.rejects(pg.query(`INSERT INTO revisions.requests (vertical, item_id, instruction) VALUES ('drama', $1, 'x')`, [id]), /requests_vertical_check/);
});

test('revisions.requests keeps one vertical CHECK (the inline one was dropped by its real name)', async () => {
  const pg = await db();
  const { rows } = await pg.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'revisions.requests'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%vertical%'`,
  );
  assert.deepEqual(rows.map((r) => r.conname), ['requests_vertical_check']);
});
