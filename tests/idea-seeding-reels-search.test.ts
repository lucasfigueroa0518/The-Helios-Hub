/**
 * Text on Screen seeding, the free search for a story to build a headline-only seed from (design
 * 2026-10-29-text-on-screen-seeding-design): stories already collected, then Google News. Offline: PGlite, and fetch / page
 * reads are stubbed, so nothing here reaches the network or a model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createPostIdea, insertSource } from '@/lib/reels/repository';
import { OVERLAP_FLOOR, SEED_MAX_CANDIDATES, collectedCandidates, headlineOverlap, newsCandidates } from '@/lib/reels/seed-search';

import { PAGE, RUN, reelsDb } from './fixtures/reels-seed';

const rss = (items: Array<{ title: string; link: string }>) =>
  `<?xml version="1.0"?><rss version="2.0"><channel>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;

test('headlineOverlap: the share of the seed headline’s words a candidate has; stop-words do not count', () => {
  assert.equal(headlineOverlap('Anthropic releases Claude Opus 5.5', 'Anthropic releases Claude Opus 5.5'), 1);
  assert.ok(headlineOverlap('Anthropic releases Claude Opus 5.5', 'Why Claude Opus 5.5 matters, as Anthropic releases it') >= OVERLAP_FLOOR);
  assert.ok(headlineOverlap('Anthropic releases Claude Opus 5.5', 'Local bakery wins regional award') < 0.2);
  assert.equal(headlineOverlap('the of and', 'the of and'), 0, 'a headline with no significant words matches nothing');
});

test('collectedCandidates finds a related collected story, and skips seeds, short bodies and unrelated stories', async () => {
  const pg = await reelsDb();
  const add = async (headline: string, url: string, body: string, adapter = 'rss', drop: Parameters<typeof insertSource>[0]['dropReason'] = null) => {
    const sid = await insertSource({ runId: RUN, canonicalUrl: url, headline, body, author: null, byline: null, sourceName: 'Wire', sourceType: 'A1', adapterId: adapter, bucket: 'A', publishTime: null, language: null, engagement: {}, mediaUrls: [], citationUrls: [], rawPayload: {}, dropReason: drop });
    await createPostIdea(sid!, RUN, 'test');
  };
  await add('Anthropic releases Claude Opus 5.5 with lower prices', 'https://wire.test/opus', PAGE);
  await add('Claude Opus 5.5 release: Anthropic cuts prices', 'https://wire.test/short', 'too short');
  await add('Anthropic releases Claude Opus 5.5 as a seed', 'https://seed.test/x', PAGE, 'seed', 'seed');
  await add('Local bakery wins regional award', 'https://wire.test/bakery', PAGE);
  const found = await collectedCandidates('Anthropic Claude Opus 5.5 release');
  assert.deepEqual(found.map((c) => c.url), ['https://wire.test/opus']);
  assert.equal(found[0]!.source, 'collected');
  assert.equal(found[0]!.body, PAGE);
  void pg;
});

test('newsCandidates reads each Google News result, resolves its page, and keeps only pages with text', async () => {
  const asked: string[] = [];
  const out = await newsCandidates('Anthropic releases Claude Opus 5.5', {
    fetchText: async (url) => {
      asked.push(url);
      return rss([
        { title: 'Anthropic releases Claude Opus 5.5 - The Verge', link: 'https://publisher.test/a' },
        { title: 'Opus 5.5 explained - Wired', link: 'https://publisher.test/b' },
      ]);
    },
    readPage: async (url) => (url.endsWith('/a') ? PAGE : 'short'),
  });
  assert.match(asked[0]!, /^https:\/\/news\.google\.com\/rss\/search\?q=Anthropic%20releases%20Claude%20Opus%205\.5&hl=en-US/);
  assert.deepEqual(out.map((c) => [c.url, c.source]), [['https://publisher.test/a', 'news']]);
  assert.ok(out.length <= SEED_MAX_CANDIDATES);
});

test('newsCandidates: an HTTP error, a zero-item feed or a throwing page read is no results, never a throw', async () => {
  const deps = { readPage: async () => PAGE };
  assert.deepEqual(await newsCandidates('Anything at all', { ...deps, fetchText: async () => { throw new Error('503'); } }), []);
  assert.deepEqual(await newsCandidates('Anything at all', { ...deps, fetchText: async () => rss([]) }), []);
  assert.deepEqual(await newsCandidates('Anything at all', { fetchText: async () => rss([{ title: 'Anything at all today', link: 'https://p.test/a' }]), readPage: async () => { throw new Error('blocked'); } }), []);
});
