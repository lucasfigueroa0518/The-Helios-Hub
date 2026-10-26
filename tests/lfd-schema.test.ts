import assert from 'node:assert/strict';
import test from 'node:test';

import { openHubTestDb } from './fixtures/social-hub/pglite';

test('lfd schema seeds settings that ship off', async () => {
  const { query } = await openHubTestDb();
  const { rows } = await query<{ key: string; value: unknown }>(`SELECT key, value FROM lfd.settings ORDER BY key`);
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.key, r.value])), {
    auto_run: false,
    days: [2, 5],
    memes: true,
    memes_cap_usd: 1,
    publishing_live: false,
    require_approval: true,
    run_cap_usd: 1,
  });
});

test('lfd.runs allows one running and one requested run', async () => {
  const { query } = await openHubTestDb();
  await query(`INSERT INTO lfd.runs (trigger, status) VALUES ('manual', 'running')`);
  await assert.rejects(query(`INSERT INTO lfd.runs (trigger, status) VALUES ('manual', 'running')`));
  await query(`INSERT INTO lfd.runs (trigger, status) VALUES ('scheduled', 'requested')`);
  await assert.rejects(query(`INSERT INTO lfd.runs (trigger, status) VALUES ('manual', 'requested')`));
});

test('lfd.posts rejects a slug with a slash', async () => {
  const { query } = await openHubTestDb();
  await assert.rejects(
    query(`INSERT INTO lfd.posts (slug, ny_date, stories, render, caption) VALUES ('lfd/x', '2026-10-13', '[]', '{}', 'c')`),
  );
  await query(`INSERT INTO lfd.posts (slug, ny_date, stories, render, caption) VALUES ('lfd-2026-10-13', '2026-10-13', '[]', '{}', 'c')`);
});
