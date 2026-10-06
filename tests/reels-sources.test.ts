/**
 * D-263 / D-264. The story and mainstream sources, offline. Each fixture is a
 * real feed captured on 2026-10-06 and trimmed to three items. Live behavior
 * is checked with scripts/reels/probe-sources.ts, never from these tests.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { ADAPTERS, adapterById, primaryAdapters } from '@/lib/reels/adapters';
import { ARTICLE_FEED_CAP, QUIET_SOURCE_DAYS } from '@/lib/reels/config';
import { parseFeed } from '@/lib/reels/net/feed';
import { canonicalizeUrl } from '@/lib/reels/net/http';
import { quietSources, quietSourcesNote, type SourceActivity } from '@/lib/reels/pipeline/source-health';
import type { Adapter } from '@/lib/reels/types';

const NEW_SOURCES = ['futurism', 'the-verge-ai', 'wired-ai', 'ai-incident-db', 'guardian-ai', 'bbc-tech'] as const;
const MORE_SOURCES = ['rest-of-world', 'nbc-tech', 'conversation-ai', 'big-technology', 'cbs-tech'] as const;
const fixture = (id: string) => readFileSync(join(__dirname, 'fixtures', 'reels-feeds', `${id}.xml`), 'utf8');

test('D-263: every new source is registered once, as a dated B1 feed with the nightly cap', () => {
  const ids = ADAPTERS.map((adapter) => adapter.id);
  assert.equal(new Set(ids).size, ids.length, 'adapter ids are unique');
  for (const id of NEW_SOURCES) {
    const adapter = adapterById(id);
    assert.ok(adapter, id);
    assert.equal(adapter.kind, 'dated', id);
    assert.equal(adapter.type, 'B1', id);
    assert.equal(adapter.cap, ARTICLE_FEED_CAP, id);
    assert.ok(primaryAdapters().includes(adapter), `${id} runs in the primary phase`);
    assert.ok((adapter.quietAfterDays ?? 0) >= QUIET_SOURCE_DAYS, `${id} is watched`);
  }
});

test('D-263: the new sources run before the derived adapters that read tonight', () => {
  const ids = ADAPTERS.map((adapter) => adapter.id);
  for (const id of [...NEW_SOURCES, ...MORE_SOURCES]) assert.ok(ids.indexOf(id) < ids.indexOf('claude-web-search'), id);
});

test('D-270: the next story sources are registered once, as dated B1 feeds with the nightly cap', () => {
  const ids = ADAPTERS.map((adapter) => adapter.id);
  assert.equal(new Set(ids).size, ids.length, 'adapter ids are unique');
  for (const id of MORE_SOURCES) {
    const adapter = adapterById(id);
    assert.ok(adapter, id);
    assert.equal(adapter.kind, 'dated', id);
    assert.equal(adapter.type, 'B1', id);
    assert.equal(adapter.cap, ARTICLE_FEED_CAP, id);
    assert.ok(primaryAdapters().includes(adapter), `${id} runs in the primary phase`);
    assert.ok((adapter.quietAfterDays ?? 0) >= QUIET_SOURCE_DAYS, `${id} is watched`);
  }
});

for (const id of [...NEW_SOURCES, ...MORE_SOURCES]) {
  test(`the ${id} feed parses into dated articles with real links`, () => {
    const entries = parseFeed(fixture(id));
    assert.equal(entries.length, 3);
    for (const entry of entries) {
      assert.ok(entry.title.trim().length > 10, `title: ${entry.title}`);
      assert.match(entry.link, /^https:\/\//);
      assert.ok(canonicalizeUrl(entry.link).startsWith('https://'));
      assert.ok(entry.publishedAt instanceof Date && !Number.isNaN(entry.publishedAt.getTime()), 'dated');
      assert.ok(entry.publishedAt.getFullYear() >= 2026);
    }
  });
}

test('D-263: a feed that answers with an error page or nothing yields no items instead of throwing', () => {
  assert.deepEqual(parseFeed('<html><body>Access denied</body></html>'), []);
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed('<rss><channel><title>x</title></channel></rss>'), []);
});

function watched(id: string, days?: number): Adapter {
  return { id, name: id, type: 'B1', bucket: 'B', kind: 'dated', quietAfterDays: days, fetchItems: async () => [] };
}

const now = new Date('2026-10-06T05:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);

test('D-264: a watched source with nothing kept for its window is named', () => {
  const activity = new Map<string, SourceActivity>([
    ['fresh', { lastKept: ago(1), firstSeen: ago(10) }],
    ['stale', { lastKept: ago(3), firstSeen: ago(10) }],
    ['never-kept', { lastKept: null, firstSeen: ago(4) }],
    ['just-added', { lastKept: null, firstSeen: ago(1) }],
    ['unwatched', { lastKept: ago(30), firstSeen: ago(30) }],
  ]);
  const adapters = [
    watched('fresh', 3),
    watched('stale', 3),
    watched('never-kept', 3),
    watched('just-added', 3),
    watched('no-history', 3),
    watched('unwatched'),
  ];
  assert.deepEqual(quietSources(adapters, activity, now), ['stale', 'never-kept']);
});

test('D-264: a longer window tolerates a quiet weekend', () => {
  const activity = new Map<string, SourceActivity>([['weekly', { lastKept: ago(3.5), firstSeen: ago(20) }]]);
  assert.deepEqual(quietSources([watched('weekly', 4)], activity, now), []);
  assert.deepEqual(quietSources([watched('weekly', 3)], activity, now), ['weekly']);
});

test('D-264: the note is empty when nothing is quiet and names every quiet source otherwise', () => {
  assert.equal(quietSourcesNote([]), undefined);
  assert.match(quietSourcesNote(['Wired', 'BBC News']) ?? '', /Wired, BBC News/);
});
