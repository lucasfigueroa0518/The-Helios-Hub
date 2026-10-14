import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLedger, readCosts } from '@/lib/social-hub/queries/costs';

import { openHubTestDb } from './fixtures/social-hub/pglite';

test('ledger rows carry vendor and production/development mode per type', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO reels.settings (key, value) VALUES ('prod_spend_since', '"2026-10-01T04:00:00Z"') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    INSERT INTO reels.cost_events (vendor, component, usd, created_at) VALUES
      ('anthropic', 'copy-caption', 0.5, '2026-09-20T05:00:00Z'), ('openai', 'reel-background', 0.3, '2026-10-05T05:00:00Z');
    INSERT INTO explainers.cost_events (mode, vendor, component, usd, usd_known, created_at) VALUES
      ('development', 'anthropic', 'session_a', 1, true, '2026-10-05T05:00:00Z'), ('production', 'heygen', 'tts+bgm+sfx', 0, false, '2026-10-05T05:00:00Z');
    INSERT INTO social.runs (kind, started_at, hook_pass, cap_usd, total_usd, claude_usd, trigger, status, requested_at, record) VALUES
      ('daily', '2026-10-05T07:00:00Z', true, 2, 1.5, 1.2, 'cli', 'ok', '2026-10-05T07:00:00Z', '{"jev":{"costUsd":0.3},"result":{"posts":[]}}');
    INSERT INTO stories.sets (id, series, ny_date, trigger, style, mode) VALUES ('00000000-0000-0000-0000-0000000000c1', 'morning_download', '2026-10-05', 'click', 'polished', 'development');
    INSERT INTO stories.cost_events (set_id, vendor, component, usd, created_at) VALUES ('00000000-0000-0000-0000-0000000000c1', 'web_search', 'search', 0.1, '2026-10-05T05:00:00Z');
  `);
  const { rows } = buildLedger(await readCosts(query));
  const pick = (re: RegExp) => rows.filter((r) => re.test(r.id));
  assert.deepEqual(pick(/^reels:ce:/).map((r) => [r.vendor, r.mode]).sort(), [['anthropic', 'development'], ['openai', 'production']]);
  const exp = pick(/^explainers:ce:/);
  assert.ok(exp.some((r) => r.mode === 'development' && r.vendor === 'anthropic'));
  assert.ok(exp.some((r) => r.unknown === true && r.vendor === 'heygen'));
  assert.ok(pick(/^carousels:run:/).every((r) => r.mode === 'development'));
  assert.deepEqual(pick(/^stories:ce:/).map((r) => [r.vendor, r.mode]), [['web_search', 'development']]);
});
