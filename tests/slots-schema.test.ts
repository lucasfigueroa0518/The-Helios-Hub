/** Weekly slot calendar schema (spec §1): CHECKs hold, the switch starts at legacy. Offline PGlite. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const TPL = `INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series, feed_mode) VALUES`;
const OVR = `INSERT INTO social_hub.slot_override (ny_date, vertical, start_minute, series, action, feed_mode) VALUES`;

test('slot_template takes free-time slots and refuses bad ones', async () => {
  const { pg } = await openHubTestDb();
  await pg.query(`${TPL} (2, 'explainers', 720, NULL, 'main')`);
  await pg.query(`${TPL} (2, 'stories', 510, 'morning_download', NULL)`);
  await pg.query(`${TPL} (2, 'stories', 900, 'morning_download', NULL)`);
  await assert.rejects(pg.query(`${TPL} (2, 'explainers', 720, NULL, 'trial')`), /uq_social_hub_slot_template_key/);
  await assert.rejects(pg.query(`${TPL} (2, 'explainers', 725, NULL, 'main')`), /start_minute/);
  await assert.rejects(pg.query(`${TPL} (2, 'carousels', 1440, NULL, NULL)`), /start_minute/);
  await assert.rejects(pg.query(`${TPL} (2, 'stories', 600, NULL, NULL)`), /series/);
  await assert.rejects(pg.query(`${TPL} (2, 'carousels', 600, 'morning_download', NULL)`), /series/);
  await assert.rejects(pg.query(`${TPL} (2, 'reels', 600, NULL, NULL)`), /feed_mode/);
  await assert.rejects(pg.query(`${TPL} (2, 'carousels', 600, NULL, 'main')`), /feed_mode/);
  await assert.rejects(pg.query(`${TPL} (7, 'carousels', 600, NULL, NULL)`));
});

test('slot_override: unique per date, remove carries no feed_mode, add on a reel type needs one', async () => {
  const { pg } = await openHubTestDb();
  await pg.query(`${OVR} ('2026-10-20', 'reels', 540, NULL, 'add', 'main')`);
  await pg.query(`${OVR} ('2026-10-25', 'carousels', 540, NULL, 'remove', NULL)`);
  await pg.query(`${OVR} ('2026-10-25', 'stories', 510, 'free_vs_paid', 'add', NULL)`);
  await pg.query(`${OVR} ('2026-10-25', 'stories', 900, 'free_vs_paid', 'add', NULL)`);
  await assert.rejects(pg.query(`${OVR} ('2026-10-20', 'reels', 540, NULL, 'remove', NULL)`), /uq_social_hub_slot_override_key/);
  await assert.rejects(pg.query(`${OVR} ('2026-10-21', 'reels', 540, NULL, 'remove', 'main')`), /feed_mode/);
  await assert.rejects(pg.query(`${OVR} ('2026-10-21', 'explainers', 720, NULL, 'add', NULL)`), /feed_mode/);
  await assert.rejects(pg.query(`${OVR} ('2026-10-22', 'carousels', 540, NULL, 'add', 'main')`), /slot_override_feed_mode_check/);
  await assert.rejects(pg.query(`${OVR} ('2026-10-22', 'carousels', 545, NULL, 'add', NULL)`), /start_minute/);
  await assert.rejects(pg.query(`${OVR} ('2026-10-22', 'stories', 540, NULL, 'add', NULL)`), /series/);
  await assert.rejects(pg.query(`${OVR} ('2026-10-22', 'carousels', 540, NULL, 'move', NULL)`), /slot_override_action_check/);
});

test('schedule.slot accepts free-time ids beside window ids', async () => {
  const { pg } = await openHubTestDb();
  const item = async (vertical: string, ref: string) =>
    (await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ($1, 'feed', $2) RETURNING id`, [vertical, ref])).rows[0]!.id;
  const book = async (vertical: string, ref: string, slot: string, mode: string | null = null) =>
    pg.query(
      `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
       VALUES ($1, $2, '2026-10-21', $3, '2026-10-21T13:00:00Z', 'scheduled', 'auto', $4)`,
      [await item(vertical, ref), vertical, slot, mode],
    );
  await book('explainers', 'e-1', 't0720', 'main');
  await book('stories', 's-1', 't0510:morning_download');
  await book('carousels', 'c-1', 'afternoon');
  await assert.rejects(book('carousels', 'c-2', 'tonight'), /schedule_slot_check/);
  await assert.rejects(book('carousels', 'c-3', 't720'), /schedule_slot_check/);
});

test('stories.sets: two live sets of a series on one day need different slot minutes', async () => {
  const { pg } = await openHubTestDb();
  const set = (minute: number | null) => pg.query(
    `INSERT INTO stories.sets (series, ny_date, trigger, style, slot_minute) VALUES ('morning_download', '2026-10-21', 'auto', 'polished', $1)`, [minute]);
  await set(510);
  await set(900);
  await assert.rejects(set(510), /uq_stories_sets_live_day/);
  await set(null);
  await assert.rejects(set(null), /uq_stories_sets_live_day/);
});

test('daily_caps starts at the agreed numbers', async () => {
  const { pg } = await openHubTestDb();
  const r = await pg.query<{ value: unknown }>(`SELECT value FROM social_hub.settings WHERE key = 'daily_caps'`);
  assert.deepEqual(r.rows[0]?.value, { reels: 5, explainers: 3, carousels: 3, last_few_days: 1, stories: 2 });
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

test('both schema files apply twice (idempotent), keeping rows', async () => {
  const { pg } = await openHubTestDb();
  const { readFileSync } = await import('node:fs');
  await pg.query(`${TPL} (2, 'explainers', 720, NULL, 'main')`);
  for (const f of ['db/social_hub_schema.sql', 'db/stories_schema.sql']) {
    const sql = readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
    await pg.exec(sql);
  }
  const r = await pg.query(`SELECT 1 FROM social_hub.slot_template`);
  assert.equal(r.rows.length, 1);
});

test('an old window_id slot table is migrated in place, rows cleared', async () => {
  const { pg } = await openHubTestDb();
  const { readFileSync } = await import('node:fs');
  await pg.exec(`DROP TABLE social_hub.slot_template; CREATE TABLE social_hub.slot_template (
    weekday smallint NOT NULL, vertical text NOT NULL, window_id text NOT NULL, feed_mode text, updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (weekday, vertical, window_id));
    INSERT INTO social_hub.slot_template (weekday, vertical, window_id) VALUES (1, 'carousels', 'morning');
    DROP TABLE social_hub.slot_override;
    CREATE TABLE social_hub.slot_override (
      ny_date date NOT NULL, vertical text NOT NULL, window_id text NOT NULL, action text NOT NULL, feed_mode text,
      updated_by text, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (ny_date, vertical, window_id));
    INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action) VALUES ('2026-10-25', 'carousels', 'morning', 'remove');`);
  const sql = readFileSync('db/social_hub_schema.sql', 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
  await pg.exec(sql);
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.slot_template`)).rows.length, 0);
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.slot_override`)).rows.length, 0);
  await pg.query(`${TPL} (1, 'carousels', 540, NULL, NULL)`);
  await pg.query(`${OVR} ('2026-10-25', 'carousels', 540, NULL, 'remove', NULL)`);
});
