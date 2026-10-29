/**
 * Text on Screen seeding, the free search for a story to build a headline-only seed from (design
 * 2026-10-29-text-on-screen-seeding-design): stories already collected, then Google News. Offline: PGlite, and fetch / page
 * reads are stubbed, so nothing here reaches the network or a model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createPostIdea, insertSource } from '@/lib/reels/repository';
import { OVERLAP_FLOOR, SEED_MAX_CANDIDATES, collectedCandidates, headlineOverlap, newsCandidates, pickBest, type SeedCandidate,
  PAID_INPUT_ALLOWANCE_TOKENS, PAID_MAX_OUTPUT_TOKENS, SEED_MAX_USD, SEED_WEB_SEARCHES, estimatePaidSearchUsd, seedSearchApproved, webCandidates, type PaidSearchDeps } from '@/lib/reels/seed-search';
import { B6_MODEL } from '@/lib/reels/config';
import { ratesForModel } from '@/lib/anthropic-pricing';
import { computeSearchCostUsd } from '@/lib/drafting/cost';

import { PAGE, RUN, reelsDb, stub } from './fixtures/reels-seed';

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

const cand = (url: string, headline: string): SeedCandidate => ({ url, headline, body: PAGE, outlet: 'Wire', source: 'collected' });

test('pickBest scores related candidates, logs each Jev call, and returns the highest net; unrelated ones are never scored', async () => {
  const pg = await reelsDb();
  const { jev, calls } = stub();
  const picked = await pickBest('Anthropic releases Claude Opus 5.5', [cand('https://a.test/1', 'Anthropic releases Claude Opus 5.5'), cand('https://a.test/2', 'Local bakery wins regional award')], jev);
  assert.ok('candidate' in picked && picked.candidate.url === 'https://a.test/1');
  assert.equal(calls.n, 2, 'one related candidate, two Jev calls');
  assert.ok(Number((await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM reels.jev_logs`)).rows[0]!.n) >= 2, 'the calls are logged');
});

test('pickBest takes the higher net when two related candidates score differently', async () => {
  await reelsDb();
  const { jev } = stub({ scoreBy: (state) => (JSON.stringify(state).includes('SECOND') ? 4 : 2) });
  const a = { ...cand('https://a.test/1', 'Anthropic releases Claude Opus 5.5'), body: PAGE };
  const b = { ...cand('https://a.test/2', 'Anthropic releases Claude Opus 5.5 SECOND'), body: PAGE };
  const picked = await pickBest('Anthropic releases Claude Opus 5.5', [a, b], jev);
  assert.ok('candidate' in picked && picked.candidate.url === 'https://a.test/2');
});

test('pickBest: nothing related, or every score failing, is a named failure, not a throw', async () => {
  await reelsDb();
  assert.deepEqual(await pickBest('Anthropic releases Claude Opus 5.5', [cand('https://a.test/2', 'Local bakery wins regional award')], stub().jev), { failed: 'none_related' });
  assert.deepEqual(await pickBest('Anthropic releases Claude Opus 5.5', [cand('https://a.test/1', 'Anthropic releases Claude Opus 5.5')], stub({ fail: true }).jev), { failed: 'scoring_unavailable' });
  assert.deepEqual(await pickBest('Anthropic releases Claude Opus 5.5', [], stub().jev), { failed: 'none_related' });
});

type Params = { model: string; max_tokens: number; system: Array<{ cache_control?: unknown }>; tools: Array<{ name: string; type?: string; max_uses?: number; cache_control?: unknown }> };
/** A stub Anthropic client: records each request and answers with the model "reporting" the given articles. */
function claude(articles: Array<{ url: string; headline: string; outlet: string }>, usage = { input_tokens: 20_000, output_tokens: 300, searches: 3 }) {
  const seen: Params[] = [];
  return {
    seen,
    client: {
      messages: {
        async create(params: Params) {
          seen.push(params);
          return {
            id: 'msg_stub',
            content: [{ type: 'tool_use', id: 'tu_1', name: 'report_articles', input: { articles } }],
            usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, server_tool_use: { web_search_requests: usage.searches } },
          } as never;
        },
      },
    } as unknown as PaidSearchDeps['client'],
  };
}

test('the paid search is capped at 3 searches and 1,000 output tokens, with the stable prefix cached', async () => {
  await reelsDb();
  const { client, seen } = claude([]);
  await webCandidates('Anthropic releases Claude Opus 5.5', { client, readPage: async () => PAGE });
  const req = seen[0]!;
  assert.equal(req.model, B6_MODEL);
  assert.equal(req.max_tokens, PAID_MAX_OUTPUT_TOKENS);
  assert.equal(PAID_MAX_OUTPUT_TOKENS, 1000);
  assert.equal(req.tools.find((t) => t.type === 'web_search_20250305')?.max_uses, SEED_WEB_SEARCHES);
  assert.ok(req.system[0]!.cache_control, 'the system prompt is cached');
  assert.ok(req.tools.at(-1)!.cache_control, 'the last tool carries the cache breakpoint');
});

test('the paid search returns the articles the model reported, each read for its real text, and what it cost', async () => {
  const pg = await reelsDb();
  const { client } = claude([
    { url: 'https://publisher.test/a', headline: 'Anthropic releases Claude Opus 5.5', outlet: 'The Verge' },
    { url: 'https://publisher.test/b', headline: 'Opus 5.5 explained', outlet: 'Wired' },
  ]);
  const out = await webCandidates('Anthropic releases Claude Opus 5.5', { client, readPage: async (u) => (u.endsWith('/a') ? PAGE : 'short') });
  assert.deepEqual(out.candidates.map((c) => [c.url, c.source, c.body.length > 200]), [['https://publisher.test/a', 'web', true]]);
  const rates = ratesForModel(B6_MODEL);
  const expected = computeSearchCostUsd(3) + (20_000 / 1e6) * rates.inputPerMtokUsd + (300 / 1e6) * rates.outputPerMtokUsd;
  assert.ok(Math.abs(out.usd - expected) < 1e-6, `${out.usd} vs ${expected}`);
  const logged = (await pg.query<{ usd: string; component: string }>(`SELECT usd::text, component FROM reels.cost_events WHERE component = 'seed-search'`)).rows;
  assert.equal(logged.length, 1, 'the spend is recorded');
});

test('the paid search never reads a private address the model reports', async () => {
  await reelsDb();
  const { client } = claude([{ url: 'http://169.254.169.254/latest', headline: 'Anthropic releases Claude Opus 5.5', outlet: 'x' }]);
  const out = await webCandidates('Anthropic releases Claude Opus 5.5', { client, readPage: async () => assert.fail('a private address is never read') });
  assert.deepEqual(out.candidates, []);
});

test('the estimate is under the ceiling, and the worst case at current rates is too', () => {
  const rates = ratesForModel(B6_MODEL);
  const worst = computeSearchCostUsd(SEED_WEB_SEARCHES) + (PAID_INPUT_ALLOWANCE_TOKENS / 1e6) * rates.inputPerMtokUsd + (PAID_MAX_OUTPUT_TOKENS / 1e6) * rates.outputPerMtokUsd;
  assert.ok(estimatePaidSearchUsd() <= SEED_MAX_USD);
  assert.ok(worst <= SEED_MAX_USD, `worst case ${worst} is over ${SEED_MAX_USD}`);
});

test('the paid search is off until REELS_SEED_SEARCH_PROMPT_APPROVED=true', () => {
  const was = process.env.REELS_SEED_SEARCH_PROMPT_APPROVED;
  try {
    delete process.env.REELS_SEED_SEARCH_PROMPT_APPROVED;
    assert.equal(seedSearchApproved(), false);
    process.env.REELS_SEED_SEARCH_PROMPT_APPROVED = 'true';
    assert.equal(seedSearchApproved(), true);
  } finally {
    if (was === undefined) delete process.env.REELS_SEED_SEARCH_PROMPT_APPROVED;
    else process.env.REELS_SEED_SEARCH_PROMPT_APPROVED = was;
  }
});
