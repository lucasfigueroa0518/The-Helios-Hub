import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAMPAIGN_VISIBILITY_WHERE,
  mapCampaignDraftingActivity,
  sqlLiteralTextArray,
} from '@/lib/campaigns';
import { GENERATED_STATES, RUNNING_STATES } from '@/lib/drafting/eligibility';

test('sqlLiteralTextArray emits a Postgres text[] literal', () => {
  assert.equal(
    sqlLiteralTextArray(['queued_research', "o'brien"]),
    "ARRAY['queued_research', 'o''brien']::text[]",
  );
});

test('campaign list drafting activity treats missing payloads as idle', () => {
  assert.deepEqual(mapCampaignDraftingActivity(null), {
    drafting_active: false,
    drafting_generated: 0,
    drafting_total: 0,
  });
  assert.deepEqual(mapCampaignDraftingActivity({ active: true, generated: 3, total: 20 }), {
    drafting_active: true,
    drafting_generated: 3,
    drafting_total: 20,
  });
  assert.deepEqual(
    mapCampaignDraftingActivity('{"active":true,"generated":1,"total":8}'),
    { drafting_active: true, drafting_generated: 1, drafting_total: 8 },
  );
});

test('getCampaign id filter cannot be swallowed by the auto-campaign OR', () => {
  const sql = `${CAMPAIGN_VISIBILITY_WHERE} AND c.id = $2`;
  const collapsed = sql.replace(/\s+/g, ' ').trim();
  assert.equal(
    collapsed,
    "(c.owner_id = $1 OR (COALESCE(c.kind, 'manual') = 'auto' AND c.status = 'active')) AND c.id = $2",
  );
  assert.equal(collapsed.startsWith('('), true);
  assert.match(collapsed, /\) AND c\.id = \$2$/);
});

test('running and generated drafting states stay distinct for the home-list indicator', () => {
  for (const state of RUNNING_STATES) {
    assert.equal((GENERATED_STATES as readonly string[]).includes(state), false);
  }
  assert.ok(sqlLiteralTextArray(RUNNING_STATES).includes('writing'));
  assert.ok(sqlLiteralTextArray(RUNNING_STATES).includes('queued_research'));
  assert.ok(sqlLiteralTextArray(GENERATED_STATES).includes('ready_for_review'));
});
