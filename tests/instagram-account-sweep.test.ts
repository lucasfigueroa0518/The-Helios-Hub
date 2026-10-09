/** Social Hub P2-M1: account collector, sweep writes, refresh queue (Meta stubbed; PGlite). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { dayBounds, fetchAccountDay, readTotals } from '@/lib/instagram/account-insights';
import { claimHubRefresh, finishHubRefresh, runAccountSweep, startOvernightRefresh } from '@/lib/instagram/account-sweep';
import type { GraphCall } from '@/lib/instagram/graph';
import { queueRefreshIfStale, latestQuotaSnapshot, refreshState } from '@/lib/social-hub/refresh';

import { openHubTestDb } from './fixtures/social-hub/pglite';

/** A fake Graph: answers per metric, records every call, rejects `views` like an old API version would. */
function fakeGraph(): { call: GraphCall; calls: Array<Record<string, string>> } {
  const calls: Array<Record<string, string>> = [];
  const call = (async (_method: string, _path: string, params: Record<string, string>) => {
    calls.push(params);
    const m = params.metric;
    if (m === 'views') throw new Error('Meta returned 400: (#100) metric views is not available (code 100)');
    if (params.breakdown === 'follow_type') {
      return { data: [{ name: m, total_value: { value: 0, breakdowns: [{ dimension_keys: ['follow_type'], results: [
        { dimension_values: ['FOLLOWER'], value: m === 'reach' ? 300 : 12 },
        { dimension_values: ['NON_FOLLOWER'], value: m === 'reach' ? 700 : 4 },
      ] }] } }] };
    }
    if (m === 'follower_count') return { data: [{ name: m, values: [{ value: 4100 }, { value: 4120 }] }] };
    if (m === 'follower_demographics') {
      return { data: [{ name: m, total_value: { breakdowns: [{ results: [{ dimension_values: [params.breakdown === 'age' ? '25-34' : 'X'], value: 50 }] }] } }] };
    }
    if (m === 'online_followers') return { data: [{ name: m, values: [{ value: { '0': 10, '9': 80, '23': 5 } }] }] };
    return { data: [{ name: m, total_value: { value: m === 'reach' ? 1000 : 7 } }] };
  }) as GraphCall;
  return { call, calls };
}

test('one rejected metric never loses the rest; splits read from follow_type; days bounded in New York', async () => {
  const { call } = fakeGraph();
  const day = await fetchAccountDay(call, 'ig', '2026-10-07');
  assert.equal(day.reach, 1000);
  assert.equal(day.views, null, 'rejected metric stays blank');
  assert.ok(day.errors.some((e) => e.startsWith('views')));
  assert.deepEqual([day.reachFollowers, day.reachNonFollowers, day.follows, day.unfollows], [300, 700, 12, 4]);
  assert.equal(day.followerCount, 4120);
  const b = dayBounds('2026-11-01');
  assert.equal(Number(b.until) - Number(b.since), 25 * 3600, 'the fall-back day is 25 hours');
  assert.equal(readTotals({ data: [{ name: 'x' }] }).get('x')?.value, null);
});

test('the sweep writes only social_hub, re-reads recent days without wiping numbers, and records the quota', async () => {
  const { pg, query } = await openHubTestDb({ withHubSchema: true });
  const { call } = fakeGraph();
  const q = (text: string, params?: unknown[]) => query(text, params) as Promise<{ rows: any[] }>;
  const now = new Date('2026-10-08T14:00:00Z');
  const stats = await runAccountSweep({ query: q, call, igUserId: 'ig', publishingLimit: async () => ({ quotaUsage: 12, quotaTotal: 100 }), now });
  assert.equal(stats.days, 3);
  assert.equal(stats.quota, true);
  assert.equal(stats.onlineHours, 3);
  assert.equal(stats.demographics, 4);
  const days = (await pg.query<{ ny_date: string; reach: number }>(`SELECT ny_date::text, reach FROM social_hub.account_insights_daily ORDER BY 1`)).rows;
  assert.deepEqual(days.map((d) => d.ny_date), ['2026-10-06', '2026-10-07', '2026-10-08']);
  // A later sweep where reach comes back blank keeps the stored number.
  const blank = (async (m: string, p: string, params: Record<string, string>) => (params.metric === 'reach' && !params.breakdown ? { data: [] } : call(m as never, p, params))) as GraphCall;
  await runAccountSweep({ query: q, call: blank, igUserId: 'ig', publishingLimit: async () => ({ quotaUsage: 13, quotaTotal: 100 }), now: new Date('2026-10-08T15:00:00Z') });
  assert.equal((await pg.query<{ reach: number }>(`SELECT reach FROM social_hub.account_insights_daily WHERE ny_date = '2026-10-07'`)).rows[0]!.reach, 1000);
  const snapshot = await latestQuotaSnapshot(query, new Date('2026-10-08T16:00:00Z'));
  assert.match(snapshot!.text, /has 87 of 100 posts left/);
  assert.equal(await latestQuotaSnapshot(query, new Date('2026-10-10T16:00:00Z')), null, 'older than 24 h is not shown');
});

test('refresh queue: a visit queues once, the worker claims one at a time, a fresh refresh is not repeated', async () => {
  const { query } = await openHubTestDb({ withHubSchema: true });
  const q = (text: string, params?: unknown[]) => query(text, params) as Promise<{ rows: any[] }>;
  assert.deepEqual(await refreshState(query), { available: true, lastRefresh: null, pending: false });
  assert.equal((await queueRefreshIfStale(query, 'tommy')).pending, true);
  await queueRefreshIfStale(query, 'tommy');
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.refreshes`)).rows[0]!.n, 1, 'repeated visits add nothing');
  const claimed = await claimHubRefresh(q);
  assert.equal(claimed?.trigger, 'visit');
  assert.equal(await claimHubRefresh(q), null, 'one at a time');
  await finishHubRefresh(q, claimed!.id, { days: 3, demographics: 0, onlineHours: 0, quota: true, errors: [] }, null);
  const fresh = await queueRefreshIfStale(query, 'tommy', new Date(Date.now() + 10 * 60_000));
  assert.equal(fresh.pending, false, 'within 30 minutes nothing is queued');
  const stale = await queueRefreshIfStale(query, 'tommy', new Date(Date.now() + 40 * 60_000));
  assert.equal(stale.pending, true);
  assert.ok(await startOvernightRefresh(q), 'the overnight sweep records itself even with a visit queued');
});

test('without the social_hub schema, refresh-on-visit does nothing', async () => {
  const { query } = await openHubTestDb();
  assert.deepEqual(await queueRefreshIfStale(query, 'tommy'), { available: false, lastRefresh: null, pending: false });
  assert.equal(await latestQuotaSnapshot(query), null);
});
