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
