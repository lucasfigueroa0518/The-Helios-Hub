/** AI Events spend in the hub's cost ledger (§8a): each run's Jev ranking lands on the week's post. No Claude. Offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { allocate, itemTotals } from '@/lib/social-hub/cost';
import type { HubQuery } from '@/lib/social-hub/db';
import { buildLedger, readCosts, type CostReads } from '@/lib/social-hub/queries/costs';

import { openAiEventsDb, seedRenderedPost, WEEK } from './fixtures/ai-events/seed';

const EMPTY: CostReads = { reelEvents: [], reelKling: [], reelWeights: [], reelProduced: [], explainerEvents: [], explainerRendered: [], carouselRuns: [], storyEvents: [], storySets: [] };

test('a run’s Jev spend lands on the week’s post; a run with no post stays unattributed; no Claude rows', () => {
  const { rows, pools } = buildLedger({
    ...EMPTY,
    aiEventsRuns: [
      { id: 'r1', jev_usd: '0.021', ny_date: '2026-10-25', post_id: 'p1' },
      { id: 'r2', jev_usd: '0.004', ny_date: '2026-10-25', post_id: 'p1' },
      { id: 'r3', jev_usd: '0.01', ny_date: '2026-11-01', post_id: null },
      { id: 'r4', jev_usd: '0', ny_date: '2026-11-01', post_id: 'p2' },
    ],
  });
  const ledger = allocate(rows, pools);
  assert.equal(itemTotals(ledger).get('ai_events:p1'), 25_000);
  assert.deepEqual(ledger.unattributed.map((u) => [u.vertical, u.micros]), [['ai_events', 10_000]]);
  assert.deepEqual([...new Set(rows.map((r) => [r.vendor, r.label].join(':')))], ['jev:event ranking (jev)']);
  assert.equal(rows.length, 3, 'a run that spent nothing adds no row');
});

test('readCosts reads ai_events.runs with the week’s post, also for a rebuild whose post moved on; no schema reads as none', async () => {
  const { query } = await openAiEventsDb();
  const { id: post } = await seedRenderedPost(query);
  const run = async (kind: string, at: string) =>
    (await query<{ id: string }>(
      `INSERT INTO ai_events.runs (trigger, kind, status, started_at, week_key, jev_usd, total_usd) VALUES ('manual', $1, 'ok', $2, $3, 0.02, 0.02) RETURNING id::text AS id`,
      [kind, at, WEEK],
    )).rows[0]!.id;
  const build = await run('build', '2026-10-25T16:00:00Z');
  const rebuild = await run('rebuild', '2026-10-25T17:00:00Z');
  // The rebuild re-rendered the post in place: its run_id is the rebuild's now.
  await query(`UPDATE ai_events.posts SET run_id = $1 WHERE id = $2`, [rebuild, post]);
  const got = (await readCosts(query)).aiEventsRuns?.map((r) => [r.id, r.post_id, r.ny_date]).sort();
  assert.deepEqual(got, [[build, post, '2026-10-25'], [rebuild, post, '2026-10-25']].sort());
  const none = (async (text: string, params?: unknown[]) =>
    (/ai_events\./.test(text) ? Promise.reject(new Error('relation "ai_events.runs" does not exist')) : query(text, params))) as HubQuery;
  assert.deepEqual((await readCosts(none)).aiEventsRuns, []);
});
