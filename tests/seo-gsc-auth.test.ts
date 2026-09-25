import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSearchConsoleAccessToken,
  resetSearchConsoleMetadataCache,
} from '@/lib/seo/gsc-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('a metadata token is impersonated and Google ADC is not required', async () => {
  resetSearchConsoleMetadataCache();
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.startsWith('http://169.254.169.254/')) {
      return jsonResponse({ access_token: 'vm-token' });
    }
    return jsonResponse({ accessToken: 'impersonated-token' });
  };

  const token = await getSearchConsoleAccessToken(
    { GSC_IMPERSONATE_SERVICE_ACCOUNT: 'helios-gsc-sync@example.iam.gserviceaccount.com' },
    fetchImpl,
  );

  assert.equal(token, 'impersonated-token');
  assert.equal(calls.length, 2);
  assert.match(calls[0], /169\.254\.169\.254/);
  assert.match(calls[1], /generateAccessToken/);
});

test('a service account JSON key is used without asking the metadata server', async () => {
  resetSearchConsoleMetadataCache();
  let fetched = false;
  const fetchImpl = async () => {
    fetched = true;
    return jsonResponse({});
  };
  await assert.rejects(
    () => getSearchConsoleAccessToken(
      {
        GSC_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: 'sync@example.iam.gserviceaccount.com',
          private_key: 'not-a-key',
        }),
      },
      fetchImpl,
    ),
    /error/,
  );
  assert.equal(fetched, false);
});

test('a minted token is reused and a metadata miss is tried again', async () => {
  resetSearchConsoleMetadataCache();
  let metadataCalls = 0;
  const fetchImpl = async (url: string) => {
    metadataCalls += 1;
    if (url.startsWith('http://169.254.169.254/')) {
      if (metadataCalls < 3) throw new Error('timeout');
      return jsonResponse({ access_token: 'vm-token', expires_in: 3600 });
    }
    return jsonResponse({ accessToken: 'impersonated-token', expireTime: new Date(Date.now() + 3600_000).toISOString() });
  };
  const env = { GSC_IMPERSONATE_SERVICE_ACCOUNT: 'helios-gsc-sync@example.iam.gserviceaccount.com' };

  const first = await getSearchConsoleAccessToken(env, fetchImpl);
  const second = await getSearchConsoleAccessToken(env, fetchImpl);

  assert.equal(first, 'impersonated-token');
  assert.equal(second, 'impersonated-token');
  assert.equal(metadataCalls, 4);
});

test('the worker does not fall back to Google ADC when the metadata server is down', async () => {
  resetSearchConsoleMetadataCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('timeout');
  };
  await assert.rejects(
    () => getSearchConsoleAccessToken(
      { GSC_IMPERSONATE_SERVICE_ACCOUNT: 'helios-gsc-sync@example.iam.gserviceaccount.com' },
      fetchImpl,
    ),
    /metadata server did not respond/,
  );
  assert.equal(calls, 3);
});
