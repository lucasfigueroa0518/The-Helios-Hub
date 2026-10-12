import assert from 'node:assert/strict';
import test from 'node:test';

import { STORY_SETS_SQL } from '@/lib/social-hub/queries/stories';

import { openHubTestDb } from './fixtures/social-hub/pglite';

test('stories read: one skipped set per series and day is shown, however many the worker made; other days and other statuses are untouched', async () => {
  const { pg, query } = await openHubTestDb();
  const insert = (series: string, day: string, status: string, n: number) =>
    pg.query(
      `INSERT INTO stories.sets (series, ny_date, status, trigger, style, created_at)
       SELECT $1, $2::date, $3, 'auto', 'homemade', now() - make_interval(secs => g) FROM generate_series(1, $4::int) g`,
      [series, day, status, n],
    );
  // The 2026-10-10 loop: a thousand skipped Free vs. Paid sets in one day.
  await insert('free_vs_paid', '2026-10-10', 'skipped', 1126);
  await insert('free_vs_paid', '2026-10-13', 'skipped', 1);
  await insert('morning_download', '2026-10-10', 'skipped', 2);
  await pg.query(`INSERT INTO stories.sets (series, ny_date, status, trigger, style) VALUES ('morning_download', '2026-10-10', 'published', 'auto', 'polished')`);
  const rows = (await query(STORY_SETS_SQL)).rows as Array<{ series: string; ny_date: string; status: string }>;
  const count = (series: string, day: string, status: string) => rows.filter((r) => r.series === series && r.ny_date === day && r.status === status).length;
  assert.equal(count('free_vs_paid', '2026-10-10', 'skipped'), 1);
  assert.equal(count('free_vs_paid', '2026-10-13', 'skipped'), 1);
  assert.equal(count('morning_download', '2026-10-10', 'skipped'), 1);
  assert.equal(count('morning_download', '2026-10-10', 'published'), 1, 'a published set is never hidden');
  assert.equal(rows.length, 4);
});
