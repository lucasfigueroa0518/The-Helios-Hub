/** Weekly slot calendar schema (spec §1): CHECKs hold, the switch starts at legacy. Offline PGlite. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { openHubTestDb } from './fixtures/social-hub/pglite';

test('slot_template takes a valid slot and refuses bad ones', async () => {
  const { pg } = await openHubTestDb();
  await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (2, 'reels', 'morning', 'trial')`);
  await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (2, 'stories', 'free_vs_paid', NULL)`);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (2, 'reels', 'midday', NULL)`), /feed_mode/);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (2, 'carousels', 'morning', 'main')`), /feed_mode/);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (2, 'carousels', 'evening', NULL)`), /window/);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (7, 'carousels', 'morning', NULL)`));
});

test('slot_override: remove carries no feed_mode, add on a reel type needs one', async () => {
  const { pg } = await openHubTestDb();
  await pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-20', 'reels', 'morning', 'add', 'main')`);
  await pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-25', 'carousels', 'morning', 'remove', NULL)`);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-21', 'reels', 'morning', 'remove', 'main')`), /feed_mode/);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-21', 'explainers', 'late', 'add', NULL)`), /feed_mode/);
});

test('schedule has feed_mode, and slot_source starts at legacy', async () => {
  const { pg } = await openHubTestDb();
  const col = await pg.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'social_hub' AND table_name = 'schedule' AND column_name = 'feed_mode'`);
  assert.equal(col.rows.length, 1);
  const src = await pg.query<{ value: unknown }>(`SELECT value FROM social_hub.settings WHERE key = 'slot_source'`);
  assert.equal(src.rows[0]?.value, 'legacy');
});

test('the schema file applies twice (idempotent)', async () => {
  const { pg } = await openHubTestDb();
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync('db/social_hub_schema.sql', 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
  await pg.exec(sql);
});
