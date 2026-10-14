import assert from 'node:assert/strict';
import test from 'node:test';

import { allocate, itemTotals } from '@/lib/social-hub/cost';
import type { HubQuery } from '@/lib/social-hub/db';
import { buildLedger, readCosts, type CostReads } from '@/lib/social-hub/queries/costs';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const EMPTY: CostReads = { reelEvents: [], reelKling: [], reelWeights: [], reelProduced: [], explainerEvents: [], explainerRendered: [], carouselRuns: [], storyEvents: [], storySets: [] };

test('a run’s spend lands on its post; a run with no post stays unattributed', () => {
  const { rows, pools } = buildLedger({
    ...EMPTY,
    lfdRuns: [
      { id: 'r1', claude_usd: '0.30', jev_usd: '0.05', ny_date: '2026-10-13', post_id: 'p1' },
      { id: 'r2', claude_usd: '0.10', jev_usd: '0', ny_date: '2026-10-16', post_id: null },
    ],
  });
  const ledger = allocate(rows, pools);
  assert.equal(itemTotals(ledger).get('last_few_days:p1'), 350_000);
  assert.deepEqual(ledger.unattributed.map((u) => [u.vertical, u.micros]), [['last_few_days', 100_000]]);
  assert.deepEqual(rows.map((r) => [r.vendor, r.label]), [
    ['anthropic', 'writing and rewrites'],
    ['jev', 'story picking and fact check (jev)'],
    ['anthropic', 'writing and rewrites'],
  ]);
});

test('readCosts reads lfd.runs with each run’s post; a database without the lfd schema reads as none', async () => {
  const { query } = await openHubTestDb();
  const run = (await query<{ id: string }>(
    `INSERT INTO lfd.runs (trigger, status, started_at, claude_usd, jev_usd, total_usd) VALUES ('manual', 'ok', '2026-10-13T07:00:00Z', 0.3, 0.05, 0.35) RETURNING id::text AS id`,
  )).rows[0]!.id;
  const post = await seedLfdPost(query);
  await query(`UPDATE lfd.posts SET run_id = $1 WHERE id = $2`, [run, post]);
  assert.deepEqual((await readCosts(query)).lfdRuns?.map((r) => [r.id, r.post_id, r.ny_date]), [[run, post, '2026-10-13']]);
  const noLfd = (async (text: string, params?: unknown[]) =>
    (/lfd\./.test(text) ? Promise.reject(new Error('relation "lfd.runs" does not exist')) : query(text, params))) as HubQuery;
  assert.deepEqual((await readCosts(noLfd)).lfdRuns, []);
});
