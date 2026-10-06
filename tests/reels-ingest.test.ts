/** Ingest rules that decide what reaches the pool. No network, no Jev, no DB. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { hfDailyPapers } from '@/lib/reels/adapters/hf-papers';
import { ARTICLE_FEED_CAP, FULL_TEXT_MIN_CHARS, HF_PAPERS_NEW_PER_NIGHT } from '@/lib/reels/config';
import { isNonArticle } from '@/lib/reels/net/document';
import { parsePage } from '@/lib/reels/net/html';
import { guardItem } from '@/lib/reels/pipeline/guard';
import { applyCap, capNewItems, resolveBody } from '@/lib/reels/pipeline/ingest';
import { postgresJson, postgresText } from '@/lib/reels/postgres-text';
import type { Adapter, AdapterItem } from '@/lib/reels/types';
import type { JevRunner } from '@/lib/reels/jev/runner';

function adapter(overrides: Partial<Adapter> = {}): Adapter {
  return {
    id: 'test',
    name: 'Test',
    type: 'B1',
    bucket: 'B',
    kind: 'dated',
    fetchItems: async () => [],
    ...overrides,
  };
}

function item(index: number, overrides: Partial<AdapterItem> = {}): AdapterItem {
  return {
    canonicalUrl: `https://example.com/${index}`,
    headline: `Story ${index}`,
    body: 'Body',
    publishTime: new Date(2026, 8, 1, 0, index),
    ...overrides,
  };
}

test('a ranked list ingests whole, however long it is', () => {
  const items = Array.from({ length: 40 }, (_, index) => item(index));
  const { kept, overflow } = applyCap(adapter({ kind: 'ranked' }), items);
  assert.equal(kept.length, 40);
  assert.equal(overflow, 0);
});

test('an article feed is capped at the nightly limit', () => {
  const items = Array.from({ length: ARTICLE_FEED_CAP + 7 }, (_, index) => item(index));
  const { kept, overflow } = applyCap(adapter(), items);
  assert.equal(kept.length, ARTICLE_FEED_CAP);
  assert.equal(overflow, 7);
});

test('an article feed under the cap keeps everything and reports no overflow', () => {
  const { kept, overflow } = applyCap(adapter(), [item(1), item(2)]);
  assert.equal(kept.length, 2);
  assert.equal(overflow, 0);
});

test('engagement picks the winners when a source is over its cap', () => {
  const items = [
    item(1, { engagement: { points: 5 } }),
    item(2, { engagement: { points: 400 } }),
    item(3, { engagement: { points: 90 } }),
  ];
  const { kept } = applyCap(adapter({ cap: 2 }), items);
  assert.deepEqual(kept.map((entry) => entry.headline), ['Story 2', 'Story 3']);
});

test('without engagement the newest items win, never a hard floor', () => {
  const items = [
    item(1, { publishTime: new Date('2026-09-01T00:00:00Z') }),
    item(2, { publishTime: new Date('2026-09-03T00:00:00Z') }),
    item(3, { publishTime: new Date('2026-09-02T00:00:00Z') }),
  ];
  const { kept } = applyCap(adapter({ cap: 2 }), items);
  assert.deepEqual(kept.map((entry) => entry.headline), ['Story 2', 'Story 3']);
});

test('the A4 catalog and the generated story are never capped', () => {
  const items = Array.from({ length: 20 }, (_, index) => item(index));
  assert.equal(applyCap(adapter({ kind: 'catalog' }), items).kept.length, 20);
  assert.equal(applyCap(adapter({ kind: 'generated' }), items).kept.length, 20);
});

test('D-262: a ranked list with a new-item cap keeps the most upvoted new items and every repeat', () => {
  const items = [
    item(1, { engagement: { upvotes: 2 } }),
    item(2, { engagement: { upvotes: 40 } }),
    item(3, { engagement: { upvotes: 90 } }),
    item(4, { engagement: { upvotes: 9 } }),
    item(5, { engagement: { upvotes: 9 } }),
  ];
  const repeat = (entry: { headline: string }) => entry.headline === 'Story 3';
  const { kept, overflow } = capNewItems(adapter({ kind: 'ranked', newItemCap: 2 }), items, repeat);
  assert.deepEqual(kept.map((entry) => entry.headline), ['Story 2', 'Story 3', 'Story 4']);
  assert.equal(overflow, 2);
});

test('D-262: no new-item cap, or an article feed, leaves the list alone', () => {
  const items = Array.from({ length: 30 }, (_, index) => item(index));
  assert.equal(capNewItems(adapter({ kind: 'ranked' }), items, () => false).kept.length, 30);
  assert.equal(capNewItems(adapter({ newItemCap: 2 }), items, () => false).kept.length, 30);
});

test('D-262: Hugging Face Daily Papers takes 15 new papers a night', () => {
  assert.equal(HF_PAPERS_NEW_PER_NIGHT, 15);
  assert.equal(hfDailyPapers.kind, 'ranked');
  assert.equal(hfDailyPapers.newItemCap, 15);
});

test('a PDF, an image, or a zip is not an article; an HTML page is', () => {
  assert.equal(isNonArticle({ url: 'https://cses.fi/book/book.pdf' }), true);
  assert.equal(isNonArticle({ url: 'https://example.com/notes?download=book.pdf' }), false);
  assert.equal(isNonArticle({ contentType: 'application/pdf', url: 'https://example.com/download' }), true);
  assert.equal(isNonArticle({ contentType: 'application/octet-stream', body: '%PDF-1.7' }), true);
  assert.equal(isNonArticle({ contentType: 'application/octet-stream', body: '<html></html>' }), false);
  assert.equal(isNonArticle({ contentType: 'image/png', url: 'https://example.com/a' }), true);
  assert.equal(isNonArticle({ url: 'https://example.com/story', body: '<html><p>Hello</p></html>' }), false);
});

const noJev = {} as JevRunner;

test('a PDF link is skipped and never downloaded', async () => {
  let fetched = false;
  const resolved = await resolveBody(
    {
      canonicalUrl: 'https://cses.fi/book/book.pdf',
      headline: 'Competitive Programmer\'s Handbook',
      body: '',
    },
    {
      jev: noJev,
      fetchPage: async () => {
        fetched = true;
        return { html: '', finalUrl: 'https://cses.fi/book/book.pdf' };
      },
    },
  );
  assert.equal(fetched, false);
  assert.equal(resolved.dropReason, 'not_article');
});

test('a PDF response is skipped when the URL looks like a page', async () => {
  const resolved = await resolveBody(
    { canonicalUrl: 'https://example.com/download', headline: 'Handbook', body: '' },
    {
      jev: noJev,
      fetchPage: async () => ({
        html: '%PDF-1.7\n%binary',
        finalUrl: 'https://example.com/download',
        contentType: 'application/pdf',
      }),
    },
  );
  assert.equal(resolved.dropReason, 'not_article');
  assert.equal(resolved.body.includes('%PDF'), false);
});

test('an HTML article is still read', async () => {
  const page = `<html><body><article><p>${'The full article keeps going with real reporting. '.repeat(40)}</p></article></body></html>`;
  const resolved = await resolveBody(
    { canonicalUrl: 'https://example.com/story', headline: 'Story', body: '' },
    { jev: noJev, fetchPage: async () => ({ html: page, finalUrl: 'https://example.com/story', contentType: 'text/html' }) },
  );
  assert.equal(resolved.dropReason, null);
  assert.ok(resolved.body.length >= FULL_TEXT_MIN_CHARS);
});

test('article text and stored JSON drop null bytes and lone surrogates', () => {
  const page = parsePage(`<html><body><article><p>${'Hello\u0000 world. '.repeat(80)}</p></article></body></html>`);
  assert.equal(page.text.includes('\u0000'), false);
  assert.equal(postgresText('a\u0000b\uD800c\uD83D\uDE00'), 'abc😀');
  const stored = postgresJson({ body: 'a\u0000b' });
  assert.equal(stored.includes('\\u0000'), false);
  assert.equal(JSON.parse(stored).body, 'ab');
});

test('one item throwing does not escape the guard', async () => {
  const failure = await guardItem('Handbook', async () => {
    throw new Error('unsupported Unicode escape sequence');
  });
  assert.equal(failure, 'Handbook: unsupported Unicode escape sequence');
  assert.equal(await guardItem('ok', async () => undefined), null);
});
