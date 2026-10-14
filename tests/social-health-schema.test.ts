import assert from 'node:assert/strict';
import test from 'node:test';

import { openHubTestDb } from './fixtures/social-hub/pglite';

test('health_reports exists with a night primary key', async () => {
  const { query } = await openHubTestDb();
  await query(`INSERT INTO social_hub.health_reports (night, built_at, verdict, reports, failures) VALUES ('2026-10-13', now(), '{}', '[]', '[]')`);
  await assert.rejects(query(`INSERT INTO social_hub.health_reports (night, built_at, verdict, reports, failures) VALUES ('2026-10-13', now(), '{}', '[]', '[]')`));
});

test('stories.sets.mode defaults to production and rejects other values', async () => {
  const { query } = await openHubTestDb();
  const { rows } = await query<{ mode: string }>(
    `INSERT INTO stories.sets (series, ny_date, trigger, style) VALUES ('morning_download', '2026-10-13', 'auto', 'polished') RETURNING mode`,
  );
  assert.equal(rows[0]!.mode, 'production');
  await assert.rejects(query(`INSERT INTO stories.sets (series, ny_date, trigger, style, mode) VALUES ('free_vs_paid', '2026-10-13', 'auto', 'polished', 'nope')`));
});
