/**
 * Carousels also read the sources the reels ingest uses (Tommy, 2026-10-12),
 * then the carousel's own scoring filters everything. Offline: fake adapters,
 * no network, no model. The reels' judgment adapters (derived: awesome lists,
 * Claude web search) are never run from a carousel run (Rule 1).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { Adapter, AdapterItem } from '@/lib/reels/types';
import { articleFrom, fetchHubSources, hubFeedSlug } from '@/lib/carousels/hub-sources';

const NOW = new Date('2026-10-12T07:00:00Z');
const item = (over: Partial<AdapterItem> = {}): AdapterItem => ({
  canonicalUrl: 'https://example.com/a',
  headline: 'OpenAI ships a thing',
  body: 'The full text of the story.',
  author: 'Pat Writer',
  byline: 'Pat Writer, Example',
  publishTime: new Date('2026-10-12T05:00:00Z'),
  ...over,
});
const adapter = (id: string, items: AdapterItem[] | Error, over: Partial<Adapter> = {}): Adapter =>
  ({ id, name: `Name ${id}`, type: 'B1', bucket: 'B', kind: 'dated', async fetchItems() { if (items instanceof Error) throw items; return items; }, ...over }) as Adapter;

test('an adapter item becomes an article the carousel selection takes', () => {
  const a = articleFrom(item(), adapter('guardian-ai', []), NOW)!;
  assert.equal(a.feedSlug, hubFeedSlug('guardian-ai'));
  assert.equal(a.feedKind, 'native');
  assert.equal(a.source, 'Name guardian-ai');
  assert.equal(a.sourceUrl, 'https://example.com/a');
  assert.equal(a.headline, 'OpenAI ships a thing');
  assert.equal(a.byline, 'Pat Writer');
  assert.equal(a.body, 'The full text of the story.');
  assert.equal(a.publishedAt.toISOString(), '2026-10-12T05:00:00.000Z');
});

test('an item with no date, no headline, no text or past the freshness window is left out', () => {
  const ad = adapter('x', []);
  assert.equal(articleFrom(item({ publishTime: null }), ad, NOW), null);
  assert.equal(articleFrom(item({ headline: '  ' }), ad, NOW), null);
  assert.equal(articleFrom(item({ body: '' }), ad, NOW), null);
  assert.equal(articleFrom(item({ publishTime: new Date('2026-10-09T05:00:00Z') }), ad, NOW), null, 'older than the 48h freshness gate');
});

test('every adapter becomes a feed, so feed health shows the hub sources too', async () => {
  const out = await fetchHubSources([adapter('a', [item()]), adapter('b', [])], NOW);
  assert.deepEqual(out.feeds.map((f) => f.slug), [hubFeedSlug('a'), hubFeedSlug('b')]);
  assert.equal(out.articles.length, 1);
});

test('one adapter failing never loses the others, and the failure is reported', async () => {
  const out = await fetchHubSources([adapter('good', [item()]), adapter('bad', new Error('HTTP 503'))], NOW);
  assert.equal(out.articles.length, 1);
  assert.deepEqual(out.errors, [{ adapterId: 'bad', error: 'HTTP 503' }]);
});

test('judgment adapters are never run, and no adapter is given a way to call a model', async () => {
  let derivedRan = false;
  let jevAsked = false;
  const derived = adapter('claude-web-search', [item()], { phase: 'derived', async fetchItems() { derivedRan = true; return [item()]; } });
  const probing = adapter('probe', [], {
    async fetchItems(ctx) {
      try { await (ctx.jev as any).ask({}); jevAsked = true; } catch { /* refused */ }
      return [];
    },
  });
  const out = await fetchHubSources([derived, probing], NOW);
  assert.equal(derivedRan, false);
  assert.equal(jevAsked, false);
  assert.deepEqual(out.feeds.map((f) => f.slug), [hubFeedSlug('probe')]);
});

test('adapters are asked only for the freshness window', async () => {
  let since: Date | null = null;
  await fetchHubSources([adapter('w', [], { async fetchItems(ctx) { since = ctx.since; return []; } })], NOW);
  assert.equal(since!.toISOString(), '2026-10-10T07:00:00.000Z');
});
