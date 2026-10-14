// tests/lfd-spine-schema.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { HubQuery } from '@/lib/social-hub/db';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const hubSql = () =>
  readFileSync(path.join(process.cwd(), 'db/social_hub_schema.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');

async function lfdItem(query: HubQuery, ref = 'post-1'): Promise<string> {
  return (await query<{ id: string }>(
    `INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('last_few_days', 'feed', $1) RETURNING id`,
    [ref],
  )).rows[0]!.id;
}

test('the spine takes a last_few_days item, its morning slot only, and approve/auto/force attempts', async () => {
  const { query } = await openHubTestDb();
  const id = await lfdItem(query);
  const slot = (slot: string, day: string) =>
    query(
      `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source)
       VALUES ($1, 'last_few_days', $2::date, $3, $4::timestamptz, 'cancelled', 'auto')`,
      [id, day, slot, `${day}T13:30:00Z`],
    );
  await slot('morning', '2026-10-13');
  await assert.rejects(slot('afternoon', '2026-10-16'), /schedule_slot_check/);
  for (const trigger of ['approve', 'auto', 'force']) {
    await query(
      `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'last_few_days', $2, 'failed', 'c')`,
      [id, trigger],
    );
  }
  await assert.rejects(
    query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'last_few_days', 'mix_test', 'failed', 'c')`, [id]),
    /publish_attempts_trigger_check/,
  );
  await query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('last_few_days', 'x', '2026-10-13', 'promote')`);
});

test('re-applying the schema widens an existing idea_adjustments check (D45)', async () => {
  const { pg, query } = await openHubTestDb();
  // The table as it stood before this change: the four-type inline check.
  await pg.exec(`ALTER TABLE social_hub.idea_adjustments DROP CONSTRAINT idea_adjustments_vertical_check;
                 ALTER TABLE social_hub.idea_adjustments ADD CONSTRAINT idea_adjustments_vertical_check CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories'));`);
  await assert.rejects(query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('last_few_days', 'x', '2026-10-13', 'promote')`));
  await pg.exec(hubSql());
  await query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('last_few_days', 'x', '2026-10-13', 'promote')`);
  await lfdItem(query, 'post-2');
});
