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
  // An add on a non-reel type carries no feed_mode.
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-22', 'carousels', 'morning', 'add', 'main')`), /slot_override_feed_mode_check/);
  // Only add and remove are actions.
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-22', 'carousels', 'afternoon', 'move', NULL)`), /slot_override_action_check/);
});

test('schedule_feed_mode_check: only reel types carry a feed mode', async () => {
  const { pg } = await openHubTestDb();
  const item = async (vertical: string, ref: string) =>
    (await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ($1, 'feed', $2) RETURNING id`, [vertical, ref])).rows[0]!.id;
  const book = (id: string, vertical: string, mode: string | null) => pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
     VALUES ($1, $2, '2026-10-21', 'morning', '2026-10-21T13:00:00Z', 'scheduled', 'auto', $3)`,
    [id, vertical, mode],
  );
  const carousel = await item('carousels', 'c-1');
  await book(carousel, 'carousels', null);
  await book(await item('reels', 'r-1'), 'reels', 'trial');
  await assert.rejects(book(await item('carousels', 'c-2'), 'carousels', 'trial'), /schedule_feed_mode_check/);
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
