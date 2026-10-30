/**
 * The page fetcher's private-address guard (`blockPrivate`): every hop of a redirect chain, and every address a host name
 * resolves to, is checked before it is fetched. Offline: fetch and DNS are stubbed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { PrivateAddressError, assertPublicUrl, fetchPageFollowingRedirects } from '@/lib/reels/net/http';

const realFetch = globalThis.fetch;
const publicLookup = async () => ['93.184.216.34'];

/** Replace fetch with a table of url -> response; records every URL asked for and the redirect mode used. */
function stubFetch(table: Record<string, { status: number; location?: string; body?: string }>) {
  const asked: Array<{ url: string; redirect: string | undefined }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, redirect: init?.redirect });
    const hit = table[url];
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    return new Response(hit.body ?? '<html>ok</html>', { status: hit.status, headers: hit.location ? { location: hit.location } : {} });
  }) as typeof fetch;
  return asked;
}
const restore = () => { globalThis.fetch = realFetch; };
const guarded = { retries: 0, blockPrivate: true, lookup: publicLookup };

test('assertPublicUrl rejects private literals, mapped IPv6 and names that resolve to a private address', async () => {
  for (const bad of ['http://localhost/x', 'http://127.0.0.1/x', 'http://169.254.169.254/latest', 'http://2130706433/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://10.0.0.5/']) {
    await assert.rejects(assertPublicUrl(bad, publicLookup), PrivateAddressError, bad);
  }
  await assert.rejects(assertPublicUrl('https://rebind.test/x', async () => ['93.184.216.34', '127.0.0.1']), PrivateAddressError, 'any private answer blocks');
  await assert.rejects(assertPublicUrl('ftp://example.test/x', publicLookup), PrivateAddressError, 'only http and https');
  await assertPublicUrl('https://publisher.test/story', publicLookup);
});

test('a redirect to a private address is never fetched', async () => {
  const asked = stubFetch({ 'https://public.test/a': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' } });
  try {
    await assert.rejects(fetchPageFollowingRedirects('https://public.test/a', guarded), PrivateAddressError);
    assert.deepEqual(asked.map((a) => a.url), ['https://public.test/a'], 'the private hop was not requested');
  } finally { restore(); }
});

test('a public name that resolves to a private address is not fetched', async () => {
  const asked = stubFetch({});
  try {
    await assert.rejects(fetchPageFollowingRedirects('https://rebind.test/a', { ...guarded, lookup: async () => ['127.0.0.1'] }), PrivateAddressError);
    assert.equal(asked.length, 0);
  } finally { restore(); }
});

test('redirects (absolute and relative) are followed hop by hop to a public page, and the landing URL is reported', async () => {
  const asked = stubFetch({
    'https://t.test/c': { status: 301, location: 'https://publisher.test/story' },
    'https://publisher.test/story': { status: 302, location: '/story/full' },
    'https://publisher.test/story/full': { status: 200, body: '<html>the story</html>' },
  });
  try {
    const page = await fetchPageFollowingRedirects('https://t.test/c', guarded);
    assert.equal(page.html, '<html>the story</html>');
    assert.equal(page.finalUrl, 'https://publisher.test/story/full');
    assert.ok(asked.every((a) => a.redirect === 'manual'), 'the guard handles redirects itself');
  } finally { restore(); }
});

test('a redirect loop stops after 5 hops', async () => {
  stubFetch({ 'https://loop.test/a': { status: 302, location: 'https://loop.test/a' } });
  try {
    await assert.rejects(fetchPageFollowingRedirects('https://loop.test/a', guarded), /too many redirects/i);
  } finally { restore(); }
});

test('without blockPrivate the fetcher is unchanged: the runtime follows redirects', async () => {
  const asked = stubFetch({ 'https://feed.test/a': { status: 200 } });
  try {
    await fetchPageFollowingRedirects('https://feed.test/a', { retries: 0 });
    assert.equal(asked[0]!.redirect, 'follow');
  } finally { restore(); }
});
