/**
 * After a seed lands the page must show it at once. The /reels page keeps its queue in browser state, so the shared
 * refresh also runs that page's own reload (Tommy, 2026-11-04: a seeded idea was in the database but not in the list).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { refreshAfterSeed } from '@/lib/content-type/refresh-client';

function withFetch<T>(fn: (calls: string[]) => Promise<T>): Promise<T> {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => (calls.push(String(input)), new Response('{}'))) as typeof fetch;
  return fn(calls).finally(() => { globalThis.fetch = original; });
}

test('a seed marks the hub data stale, refreshes the route, and runs the page’s own reload', async () => {
  await withFetch(async (calls) => {
    const order: string[] = [];
    await refreshAfterSeed({ refresh: () => order.push('router') }, async () => { order.push('page'); });
    assert.deepEqual(calls, ['/api/content-type/progress']);
    assert.deepEqual(order.sort(), ['page', 'router']);
  });
});

test('pages without their own list still refresh the route', async () => {
  await withFetch(async (calls) => {
    let refreshed = 0;
    await refreshAfterSeed({ refresh: () => { refreshed += 1; } });
    assert.equal(refreshed, 1);
    assert.deepEqual(calls, ['/api/content-type/progress']);
  });
});
