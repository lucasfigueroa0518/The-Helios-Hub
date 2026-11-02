/**
 * The article extractor behind Carousel and Last Few Days seeds (and the night's source reads): a link, or any redirect
 * hop, that points at a private address is never requested. Offline: fetch and DNS are stubbed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { extractArticleBody } from '@/lib/social/ingest/extract-article-body';

const realFetch = globalThis.fetch;
const publicLookup = async () => ['93.184.216.34'];
const paragraph = 'The company announced a new model today and described how it will be rolled out to customers over the coming months. ';
const ARTICLE = `<html><head><title>Story</title></head><body><article><h1>Story</h1>${`<p>${paragraph.repeat(3)}</p>`.repeat(8)}</article></body></html>`;

function stubFetch(table: Record<string, { status: number; location?: string; body?: string }>) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const hit = table[url];
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    return new Response(hit.body ?? ARTICLE, { status: hit.status, headers: hit.location ? { location: hit.location } : {} });
  }) as typeof fetch;
  return asked;
}
const restore = () => { globalThis.fetch = realFetch; };

test('a redirect to a private address is never requested', async () => {
  const asked = stubFetch({ 'https://t.test/a': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' } });
  try {
    assert.equal(await extractArticleBody('https://t.test/a', { lookup: publicLookup }), null);
    assert.deepEqual(asked, ['https://t.test/a']);
  } finally { restore(); }
});

test('a public name that resolves to a private address is never requested', async () => {
  const asked = stubFetch({});
  try {
    assert.equal(await extractArticleBody('https://rebind.test/a', { lookup: async () => ['127.0.0.1'] }), null);
    assert.equal(asked.length, 0);
  } finally { restore(); }
});

test('a private literal is never requested', async () => {
  const asked = stubFetch({});
  try {
    assert.equal(await extractArticleBody('http://localhost:3000/admin', { lookup: publicLookup }), null);
    assert.equal(asked.length, 0);
  } finally { restore(); }
});

test('public redirects are followed hop by hop and the landing page is read', async () => {
  const asked = stubFetch({
    'https://t.test/c': { status: 301, location: 'https://publisher.test/story' },
    'https://publisher.test/story': { status: 302, location: '/story/full' },
    'https://publisher.test/story/full': { status: 200 },
  });
  try {
    const out = await extractArticleBody('https://t.test/c', { lookup: publicLookup });
    assert.ok(out && out.length > 500, 'the article text was returned');
    assert.equal(out.resolvedUrl, 'https://publisher.test/story/full');
    assert.deepEqual(asked, ['https://t.test/c', 'https://publisher.test/story', 'https://publisher.test/story/full']);
  } finally { restore(); }
});

test('a redirect loop gives up instead of following forever', async () => {
  const asked = stubFetch({ 'https://loop.test/a': { status: 302, location: 'https://loop.test/a' } });
  try {
    assert.equal(await extractArticleBody('https://loop.test/a', { lookup: publicLookup }), null);
    assert.ok(asked.length <= 7, `stopped after ${asked.length} requests`);
  } finally { restore(); }
});
