/**
 * The central intake run, offline: PGlite with ONLY db/intake_schema.sql (no
 * reels or social tables at all), stub adapters, stub feeds, a stub Jev
 * transport and a stub scoreForStories. No live Claude, Jev or web calls.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

import { candidatesFor, headlineSimilarity, trigrams } from '@/lib/intake/group';
import { createIntakeJev } from '@/lib/intake/jev';
import { lastRuns } from '@/lib/intake/read';
import { ensureIntakeFresh, mainRanToday, runIntakeWith, type ScoreForStories } from '@/lib/intake/run';
import { scoreForStories } from '@/lib/intake/score';
import { feedMembersOf, membersOf, storyGroupOf } from '@/lib/intake/scorecards';
import type { IntakeOrder, IntakeQuery, IntakeStory, RunIntakeDeps, Scorecard } from '@/lib/intake/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import type { Adapter, AdapterItem } from '@/lib/reels/types';
import type { FetchedArticle } from '@/lib/social/ingest/fetch-feeds';

let pg: PGlite;
let q: IntakeQuery;

before(async () => {
  pg = new PGlite({ extensions: { pg_trgm } });
  const sql = readFileSync(path.join(process.cwd(), 'db', 'intake_schema.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
  await pg.exec(sql);
  q = { query: async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] }) };
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(`TRUNCATE intake.scores, intake.items, intake.pair_decisions, intake.runs, intake.watermarks, intake.cost_events CASCADE;
                 DELETE FROM intake.stories;`);
});

const NOW = new Date('2026-11-09T05:00:00Z'); // 12:00 AM New York
const LONG = ' It shipped with documentation, pricing, benchmarks and a long write-up that explains what changed and why it matters.';

/* ── stubs ────────────────────────────────────────────────────────────── */

type Calls = { screen: number; grouping: number; ideaMerge: number };

function stubTransport(calls: Calls): JevTransport {
  return {
    async systemOne(state, questions) {
      const keys = Object.keys(questions);
      const s = state as Record<string, { headline?: string; headlines?: string[] } & Record<string, unknown>>;
      let answers: Record<string, unknown>;
      if (keys.includes('plantedInstruction')) {
        calls.screen += 1;
        const junk = String((state as { headline: string }).headline).includes('JUNK');
        answers = {
          plantedInstruction: { type: 'noul', noul: 0 },
          junk: { type: 'noul', noul: junk ? 0.95 : 0.01 },
          nonEnglish: { type: 'noul', noul: 0 },
          offTopic: { type: 'noul', noul: 0 },
        };
      } else if (keys.includes('relationship')) {
        calls.grouping += 1;
        const same = String(s.item_a.headline).includes('Acme') && String(s.item_b.headline).includes('Acme');
        answers = {
          sameEvent: { type: 'noul', noul: same ? 0.95 : 0.02 },
          relationship: { type: 'choice', choice: same ? 'link' : 'unrelated', confidence: 0.9, probabilities: {} },
        };
      } else {
        calls.ideaMerge += 1;
        answers = {
          sameEvent: { type: 'noul', noul: 0.05 },
          action: { type: 'choice', choice: 'keep_separate', confidence: 0.9, probabilities: {} },
        };
      }
      return { model: 'stub-jev', answers, usage: { input_tokens: 1000, output_tokens: 0 } } as never;
    },
  };
}

function adapterItem(url: string, headline: string): AdapterItem {
  return { canonicalUrl: url, headline, body: `${headline}.${LONG}`, publishTime: new Date(NOW.getTime() - 3_600_000), textIsComplete: true };
}

function stubAdapter(items: () => AdapterItem[], seen: { fetches: number }): Adapter {
  return {
    id: 'stub-blog',
    name: 'Stub blog',
    type: 'B3',
    bucket: 'B',
    kind: 'dated',
    async fetchItems() {
      seen.fetches += 1;
      return items();
    },
  };
}

function article(url: string, headline: string, o: { slug?: string; source?: string } = {}): FetchedArticle {
  return {
    feedSlug: o.slug ?? 'the-verge-ai',
    feedKind: 'native',
    source: o.source ?? 'The Verge',
    sourceUrl: url,
    headline,
    byline: null,
    body: `${headline}.${LONG}`.repeat(20),
    publishedAt: new Date(NOW.getTime() - 2 * 3_600_000),
  };
}

function order(open: boolean): IntakeOrder {
  return {
    id: 'lfd',
    sources: ['reels:*', 'feed:the-verge-ai'],
    lookbackDays: 3,
    scorecards: ['major-news'],
    isOpen: async () => open,
  };
}

const card: Scorecard = {
  id: 'major-news',
  version: 'major-news@3',
  families: ['reels', 'feeds', 'search', 'seed'],
  score: async () => ({ answers: {}, result: { kind: 'major-news', score: 0.5 }, usd: 0 }),
};

type Harness = {
  deps: RunIntakeDeps;
  calls: Calls;
  seen: { fetches: number; feeds: number };
  scored: IntakeStory[][];
  score: ScoreForStories;
};

function harness(o: { open?: boolean; items?: AdapterItem[]; articles?: FetchedArticle[]; now?: Date; capUsd?: number } = {}): Harness {
  const calls: Calls = { screen: 0, grouping: 0, ideaMerge: 0 };
  const seen = { fetches: 0, feeds: 0 };
  const scored: IntakeStory[][] = [];
  const now = o.now ?? NOW;
  const deps: RunIntakeDeps = {
    query: q,
    jev: createIntakeJev(stubTransport(calls), q, null, o.capUsd ?? 1),
    now: () => now,
    adapters: [stubAdapter(() => o.items ?? [], seen)],
    fetchFeeds: async () => {
      seen.feeds += 1;
      return o.articles ?? [];
    },
    fetchPage: async () => {
      throw new Error('offline');
    },
    orders: [order(o.open ?? true)],
    scorecards: [card],
  };
  const score: ScoreForStories = async (_q, _jev, stories) => {
    scored.push(stories);
    return { 'major-news': { scored: stories.length, cached: 0, usd: 0 } } as never;
  };
  return { deps, calls, seen, scored, score };
}

const count = async (sql: string, params: unknown[] = []) => Number((await q.query<{ n: number }>(sql, params)).rows[0].n);

/* ── tests ────────────────────────────────────────────────────────────── */

test('with no open order, nothing is fetched and the run says no-orders', async () => {
  const h = harness({ open: false, items: [adapterItem('https://example.com/a', 'Acme launches Rocket')] });
  const { record } = await runIntakeWith(h.deps, 'main', h.score);
  assert.equal(record.stopReason, 'no-orders');
  assert.equal(h.seen.fetches, 0);
  assert.equal(h.seen.feeds, 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items`), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.runs WHERE status = 'skipped' AND stop_reason = 'no-orders'`), 1);
});

test('reels off (no reels tables at all): the adapters still fill intake.items', async () => {
  const exists = await pg.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name IN ('reels', 'social')`);
  assert.equal(exists.rows.length, 0, 'no reels or social schema in this database');
  const h = harness({ items: [adapterItem('https://example.com/a', 'Acme launches Rocket'), adapterItem('https://example.com/b', 'Beta ships a compiler')] });
  const { record } = await runIntakeWith(h.deps, 'main', h.score);
  assert.equal(record.stopReason, undefined);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items WHERE family = 'reels'`), 2);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.watermarks WHERE source_id = 'stub-blog' AND last_success_at IS NOT NULL`), 1);
});

test('a URL on both lists is stored once', async () => {
  const h = harness({
    items: [adapterItem('https://www.example.com/a?utm_source=rss', 'Acme launches Rocket')],
    articles: [article('https://example.com/a', 'Acme launches Rocket')],
  });
  await runIntakeWith(h.deps, 'main', h.score);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items`), 1);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items WHERE key = 'https://example.com/a'`), 1);
});

test('the reels screen drops a junk item: stored with its reason, never in a story', async () => {
  const h = harness({ items: [adapterItem('https://example.com/junk', 'JUNK ten deals today'), adapterItem('https://example.com/a', 'Acme launches Rocket')] });
  const { record } = await runIntakeWith(h.deps, 'main', h.score);
  const { rows } = await q.query<{ drop_reason: string | null; story_id: string | null }>(`SELECT drop_reason, story_id FROM intake.items WHERE key = 'https://example.com/junk'`);
  assert.equal(rows[0].drop_reason, 'junk');
  assert.equal(rows[0].story_id, null);
  assert.equal(record.sources.find((s) => s.id === 'stub-blog')?.dropped.junk, 1);
  assert.equal(h.calls.screen, 2);
});

test('grouping joins two same-event items and caches the pair; a re-group makes 0 pair calls', async () => {
  const items = [adapterItem('https://example.com/acme-1', 'Acme launches Rocket model')];
  const articles = [article('https://news.example.org/acme-2', 'Acme launches Rocket model for coders')];
  const h = harness({ items, articles });
  const first = await runIntakeWith(h.deps, 'main', h.score);
  assert.equal(first.record.grouping.created, 1);
  assert.equal(first.record.grouping.joined, 1);
  assert.ok(first.record.grouping.pairCalls >= 1);
  const { rows } = await q.query<{ n: number }>(`SELECT count(DISTINCT story_id)::int AS n FROM intake.items WHERE story_id IS NOT NULL`);
  assert.equal(rows[0].n, 1, 'one story');
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.pair_decisions WHERE action = 'link'`), 1);

  // Undo the grouping (as if it had never happened) and run again an hour later: the cached pair decides it.
  await pg.exec(`UPDATE intake.items SET story_id = NULL, role = NULL, joined_at = NULL; DELETE FROM intake.stories;`);
  const again = harness({ items, articles, now: new Date(NOW.getTime() + 3_600_000) });
  const second = await runIntakeWith(again.deps, 'topup', again.score);
  assert.equal(second.record.grouping.pairCalls, 0);
  assert.ok(second.record.grouping.cacheHits >= 1);
  assert.equal(second.record.grouping.joined, 1);
  assert.equal(again.calls.grouping, 0);
});

test('only stories touched in this run are passed to scoreForStories', async () => {
  const h1 = harness({ items: [adapterItem('https://example.com/acme-1', 'Acme launches Rocket model'), adapterItem('https://example.com/beta', 'Beta ships a compiler')] });
  await runIntakeWith(h1.deps, 'main', h1.score);
  assert.equal(h1.scored[0].length, 2);
  const beta = (await q.query<{ story_id: string }>(`SELECT story_id::text AS story_id FROM intake.items WHERE key = 'https://example.com/beta'`)).rows[0].story_id;
  const acme = (await q.query<{ story_id: string }>(`SELECT story_id::text AS story_id FROM intake.items WHERE key = 'https://example.com/acme-1'`)).rows[0].story_id;

  // Next run: one new Acme item joins the Acme story; Beta is untouched.
  const h2 = harness({
    now: new Date(NOW.getTime() + 3 * 3_600_000),
    items: [adapterItem('https://example.com/acme-1', 'Acme launches Rocket model'), adapterItem('https://example.com/beta', 'Beta ships a compiler')],
    articles: [article('https://news.example.org/acme-2', 'Acme launches Rocket model for coders')],
  });
  await runIntakeWith(h2.deps, 'topup', h2.score);
  assert.equal(h2.scored.length, 1);
  assert.deepEqual(h2.scored[0].map((s) => s.id), [acme]);
  assert.ok(!h2.scored[0].some((s) => s.id === beta));
  assert.equal(h2.scored[0][0].members.length, 2);
});

test('the cap stops asking and records cap; what was stored stays', async () => {
  // 1000 input tokens = $0.000042 a call: the cap allows two calls.
  const h = harness({
    capUsd: 0.00008,
    items: [adapterItem('https://example.com/a', 'Acme launches Rocket'), adapterItem('https://example.com/b', 'Beta ships a compiler'), adapterItem('https://example.com/c', 'Gamma raises money')],
  });
  const { runId, record } = await runIntakeWith(h.deps, 'topup', h.score);
  assert.equal(record.stopReason, 'cap');
  assert.equal(h.calls.screen, 2);
  assert.equal(h.scored.length, 0, 'no scoring after the cap');
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items`), 2, 'the two screened items stay');
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.runs WHERE id = $1 AND status = 'partial' AND stop_reason = 'cap'`, [runId]), 1);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.cost_events`), 2);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.watermarks WHERE last_success_at IS NOT NULL`), 0, 'the watermark does not move');
});

test('ensureIntakeFresh never throws', async () => {
  const broken: IntakeQuery = { query: async () => { throw new Error('db down'); } };
  const a = await ensureIntakeFresh(broken, async () => { throw new Error('no deps'); });
  assert.equal(a.ran, false);
  const b = await ensureIntakeFresh(q, async () => { throw new Error('no deps'); });
  assert.equal(b.ran, false);
  assert.match(b.reason, /no deps/);
  const h = harness({ items: [] });
  const c = await ensureIntakeFresh(q, h.deps, (deps, kind) => runIntakeWith(deps, kind, h.score));
  assert.equal(c.ran, true);
  const d = await ensureIntakeFresh(q, h.deps, () => { throw new Error('run blew up'); });
  assert.equal(d.ran, false, 'fresh now, so it does not run');
});

test('the pure headline similarity matches pg_trgm', async () => {
  const pairs: Array<[string, string]> = [
    ['Claude Opus 5.5', 'Anthropic releases Opus 5.5 with lower prices and Fable-level performance'],
    ['word', 'two words'],
    ['OpenAI ships GPT-6 to developers', 'GPT-6 is here: OpenAI opens its new model to developers'],
    ['Acme launches Rocket', 'Beta ships a compiler'],
  ];
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  for (const [a, b] of pairs) {
    const { rows } = await pg.query<{ s: number }>(
      `SELECT greatest(similarity($1::text, $2::text), word_similarity($1::text, $2::text), word_similarity($2::text, $1::text))::float8 AS s`,
      [a, b],
    );
    assert.ok(Math.abs(headlineSimilarity(trigrams(a), trigrams(b)) - rows[0].s) < 0.02, `${a} | ${b}: ${headlineSimilarity(trigrams(a), trigrams(b))} vs ${rows[0].s}`);
  }
  const rows = ['Acme launches Rocket model for coders', 'Beta ships a compiler'].map((h, i) => ({ key: `k${i}`, trg: trigrams(h) }));
  assert.deepEqual(candidatesFor({ key: 'new', headline: 'Acme launches Rocket model', body: '' }, rows, null), ['k0']);
});

/* ── review fixes ─────────────────────────────────────────────────────── */

const realScore: ScoreForStories = (q2, jev, stories, orders, cards, opts) => scoreForStories(q2, jev, stories, orders, cards, opts);
const openOrder = (scorecards: IntakeOrder['scorecards']): IntakeOrder => ({ id: 'md', sources: ['reels:*', 'feeds:*'], lookbackDays: 3, scorecards, isOpen: async () => true });

function recordingCard(id: 'story-scoring' | 'reels-score', families: Scorecard['families'], seen: IntakeStory[]): Scorecard {
  return {
    id,
    version: `${id}@test`,
    families,
    score: async (story) => {
      seen.push(story);
      const g = storyGroupOf(story, id === 'story-scoring' ? feedMembersOf(story) : membersOf(story, families));
      return {
        answers: {},
        result: id === 'story-scoring'
          ? { kind: 'story-scoring', status: 'qualified', probSum: 1, outletCount: g.outletCount, answers: {} }
          : ({ kind: 'reels-score', score: { net: 0.5, blockbuster: 0 } } as never),
        usd: 0,
      };
    },
  };
}

test('fix 1: a URL on a reels adapter AND a feed is a feeds member: story-scoring sees it, with the feed\'s outlet', async () => {
  const h = harness({
    items: [adapterItem('https://example.com/acme', 'Acme launches Rocket model')],
    articles: [
      article('https://example.com/acme', 'Acme launches Rocket model', { slug: 'techcrunch-ai', source: 'TechCrunch' }),
      article('https://news.example.org/acme-2', 'Acme launches Rocket model for coders', { slug: 'techcrunch-ai', source: 'TechCrunch' }),
      article('https://wired.example.com/acme-3', 'Acme launches Rocket model, explained', { slug: 'wired-ai', source: 'Wired' }),
    ],
  });
  const seen: IntakeStory[] = [];
  h.deps.orders = [openOrder(['story-scoring'])];
  h.deps.scorecards = [recordingCard('story-scoring', ['feeds'], seen)];
  const { record } = await runIntakeWith(h.deps, 'main', realScore);
  const row = (await q.query<{ family: string; feed_slug: string; feed_source_name: string; reels_source_id: string; drop_reason: string | null }>(
    `SELECT family, feed_slug, feed_source_name, reels_source_id, drop_reason FROM intake.items WHERE key = 'https://example.com/acme'`,
  )).rows[0];
  assert.deepEqual(row, { family: 'reels', feed_slug: 'techcrunch-ai', feed_source_name: 'TechCrunch', reels_source_id: 'stub-blog', drop_reason: null });
  assert.equal(record.sources.find((s) => s.id === 'feed:techcrunch-ai')?.kept, 2, 'the shared URL counts as kept by its feed');
  assert.equal(seen.length, 1, 'one story, scored once');
  const group = storyGroupOf(seen[0]!, feedMembersOf(seen[0]!));
  assert.equal(group.members.length, 3, 'the reels-first URL is one of the feed members');
  assert.equal(group.outletCount, 2, 'TechCrunch + Wired (the shared URL counts as TechCrunch, not the adapter)');
  const stored = (await q.query<{ result: { outletCount: number } }>(`SELECT result FROM intake.scores WHERE scorecard = 'story-scoring'`)).rows[0];
  assert.equal(stored.result.outletCount, 2);
});

test('fix 1: a reels-screen-dropped URL still counts as a feed member (and not as a reels member)', async () => {
  const h = harness({
    items: [adapterItem('https://example.com/junk', 'JUNK Acme launches Rocket')],
    articles: [article('https://example.com/junk', 'JUNK Acme launches Rocket')],
  });
  const feeds: IntakeStory[] = [];
  const reels: IntakeStory[] = [];
  h.deps.orders = [openOrder(['story-scoring', 'reels-score'])];
  h.deps.scorecards = [recordingCard('story-scoring', ['feeds'], feeds), recordingCard('reels-score', ['reels', 'search'], reels)];
  await runIntakeWith(h.deps, 'main', realScore);
  const row = (await q.query<{ drop_reason: string | null; reels_drop_reason: string; feed_slug: string; feed_drop_reason: string | null; story_id: string | null }>(
    `SELECT drop_reason, reels_drop_reason, feed_slug, feed_drop_reason, story_id::text AS story_id FROM intake.items WHERE key = 'https://example.com/junk'`,
  )).rows[0];
  assert.equal(row.reels_drop_reason, 'junk');
  assert.equal(row.feed_slug, 'the-verge-ai');
  assert.equal(row.feed_drop_reason, null);
  assert.equal(row.drop_reason, null, 'kept by its feed, so it joins a story');
  assert.ok(row.story_id);
  assert.equal(feeds.length, 1, 'story-scoring scores it');
  assert.equal(reels.length, 0, 'reels-score has no member to score');
});

test('fix 1: a feed-first URL a reels adapter sees the next night gains reels membership and its story is re-scored', async () => {
  const h1 = harness({ articles: [article('https://example.com/x', 'Acme launches Rocket model')] });
  h1.deps.orders = [openOrder(['reels-score'])];
  const seen1: IntakeStory[] = [];
  h1.deps.scorecards = [recordingCard('reels-score', ['reels', 'search'], seen1)];
  await runIntakeWith(h1.deps, 'main', realScore);
  assert.equal(seen1.length, 0, 'feeds only: nothing for reels-score');

  const h2 = harness({ now: new Date(NOW.getTime() + 24 * 3_600_000), items: [adapterItem('https://example.com/x', 'Acme launches Rocket model')] });
  h2.deps.orders = [openOrder(['reels-score'])];
  const seen2: IntakeStory[] = [];
  h2.deps.scorecards = [recordingCard('reels-score', ['reels', 'search'], seen2)];
  const { record } = await runIntakeWith(h2.deps, 'main', realScore);
  assert.equal(h2.calls.screen, 1, 'the reels side screens it once');
  assert.equal(record.sources.find((s) => s.id === 'stub-blog')?.kept, 1);
  const row = (await q.query<{ family: string; reels_source_id: string; feed_slug: string }>(`SELECT family, reels_source_id, feed_slug FROM intake.items WHERE key = 'https://example.com/x'`)).rows[0];
  assert.deepEqual(row, { family: 'feeds', reels_source_id: 'stub-blog', feed_slug: 'the-verge-ai' });
  assert.equal(seen2.length, 1, 'its story was touched and scored by reels-score');
  assert.equal(membersOf(seen2[0]!, ['reels']).length, 1);
});

test('fix 3: the cap spent in the screen: screening stops, feeds are stored, grouping makes 0 pair calls, the run is not fresh', async () => {
  // 1000 input tokens = $0.000042 a call: a $0.00004 cap allows exactly one call.
  const h = harness({
    capUsd: 0.00004,
    items: [adapterItem('https://example.com/a', 'Acme launches Rocket model'), adapterItem('https://example.com/b', 'Beta ships a compiler')],
    articles: [article('https://news.example.org/acme-2', 'Acme launches Rocket model for coders')],
  });
  const { runId, record } = await runIntakeWith(h.deps, 'main', h.score);
  assert.equal(h.calls.screen, 1);
  assert.equal(record.stopReason, 'cap');
  assert.equal(record.capStage, 'screen');
  assert.match(record.unscreened ?? '', /stub-blog.*not stored/);
  assert.equal(record.scored, false);
  assert.equal(record.grouping.pairCalls, 0);
  assert.equal(h.calls.grouping, 0);
  assert.equal(h.scored.length, 0, 'nothing left to score with');
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items WHERE key = 'https://news.example.org/acme-2' AND story_id IS NOT NULL`), 1, 'the feed item is stored and grouped');
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items WHERE key = 'https://example.com/b'`), 0, 'the unscreened item is not stored');
  assert.equal(record.unscored?.length, 2, 'both new stories wait for the next run');
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.runs WHERE id = $1 AND status = 'partial'`, [runId]), 1);
  assert.equal((await lastRuns(q)).main, null, 'a run whose scoring never ran is not fresh');
});

test('fix 4: the next run scores ONLY the previous run\'s unscored stories, once', async () => {
  const h1 = harness({ capUsd: 0.00004, items: [adapterItem('https://example.com/a', 'Acme launches Rocket model')], articles: [article('https://example.org/beta', 'Beta ships a compiler')] });
  const first = await runIntakeWith(h1.deps, 'main', h1.score);
  const orphans = first.record.unscored ?? [];
  assert.equal(orphans.length, 2);

  const h2 = harness({ now: new Date(NOW.getTime() + 3_600_000) });
  const second = await runIntakeWith(h2.deps, 'topup', h2.score);
  assert.equal(second.record.carried, 2);
  assert.deepEqual(h2.scored[0]!.map((s) => s.id).sort(), [...orphans].sort());
  assert.equal(second.record.scored, true);
  assert.equal(second.record.unscored, undefined);

  const h3 = harness({ now: new Date(NOW.getTime() + 2 * 3_600_000) });
  const third = await runIntakeWith(h3.deps, 'topup', h3.score);
  assert.equal(third.record.carried, undefined);
  assert.equal(h3.scored.length, 0, 'not carried twice');
});

test('fix 11: per-scorecard scoring failures are recorded in the run record', async () => {
  const h = harness({ items: [adapterItem('https://example.com/a', 'Acme launches Rocket model'), adapterItem('https://example.com/b', 'Beta ships a compiler')] });
  const lines: string[] = [];
  h.deps.log = (line) => lines.push(line);
  h.deps.scorecards = [{ ...card, score: async () => { throw new Error('Jev 500'); } }];
  const { record } = await runIntakeWith(h.deps, 'main', realScore);
  assert.deepEqual(record.scoringFailures, { 'major-news': 2 });
  assert.equal(record.scored, true);
  assert.ok(lines.some((l) => l.includes('Jev 500')), 'the score step got the log');
});

test('a run stuck running for over 2 h is reaped, so it does not block the day\'s main', async () => {
  const later = new Date(NOW.getTime() + 3 * 3_600_000); // 3:00 AM New York, same date
  await q.query(`INSERT INTO intake.runs (kind, status, started_at) VALUES ('main', 'running', $1)`, [NOW]);
  assert.equal(await mainRanToday(q, later), false, 'the stuck main is reaped');
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.runs WHERE status = 'failed' AND error LIKE 'abandoned%'`), 1);
  await q.query(`INSERT INTO intake.runs (kind, status, started_at) VALUES ('main', 'running', $1)`, [new Date(later.getTime() - 30 * 60_000)]);
  assert.equal(await mainRanToday(q, later), true, 'a main running for 30 min still counts');
});
