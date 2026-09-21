/**
 * S8 acceptance — Postmaster `no_data` is a first-class state, missing env
 * skips the snapshot, and the day parser reads Google's resource names.
 * Offline: stubbed fetch, no Google and no database.
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  fetchTrafficStats,
  resetPostmasterTokenCache,
  trafficStatDay,
} from '@/lib/postmaster/client';
import { runPostmasterSnapshot } from '@/lib/postmaster/snapshot';

const credentials = {
  clientId: 'id',
  clientSecret: 'secret',
  refreshToken: 'refresh',
};

afterEach(() => {
  resetPostmasterTokenCache();
});

test('trafficStatDay reads the yyyymmdd suffix on a trafficStats resource', () => {
  assert.equal(
    trafficStatDay('domains/heliosgroup.email/trafficStats/20260916', '2026-01-01'),
    '2026-09-16',
  );
  assert.equal(trafficStatDay(undefined, '2026-09-16'), '2026-09-16');
});

test('missing Postmaster credentials skip the snapshot instead of failing', async () => {
  const report = await runPostmasterSnapshot('2026-09-16', { credentials: null });
  assert.equal(report.skipped, true);
  assert.equal(report.rowsWritten, 0);
  assert.match(report.detail ?? '', /POSTMASTER_/);
});

test('a 404 from trafficStats is no_data, not an error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  try {
    const result = await fetchTrafficStats(credentials, 'heliosgroup.email', '2026-09-13', '2026-09-16');
    assert.equal(result.status, 'no_data');
  } finally {
    globalThis.fetch = original;
  }
});

test('an empty trafficStats list is also no_data', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ trafficStats: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await fetchTrafficStats(credentials, 'heliosgroup.email', '2026-09-13', '2026-09-16');
    assert.equal(result.status, 'no_data');
  } finally {
    globalThis.fetch = original;
  }
});
