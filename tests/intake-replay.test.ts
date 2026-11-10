/**
 * The intake replay script (scripts/intake/replay.ts), offline: PGlite with
 * db/intake_schema.sql, a stub Jev transport, stub scorecards, a stub feed
 * fetch and hand-made legacy lists. No live Jev, Claude, HTTP or real DB.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Scorecard } from '@/lib/intake/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import type { FetchedArticle } from '@/lib/social/ingest/fetch-feeds';

import { compareLists, memoryIntake, renderReport, replay, safeKey, type ReplayItem, type Snapshot } from '../scripts/intake/replay';

const RUN_AT = new Date('2026-11-09T06:05:00Z'); // ~1 AM New York
const LONG = ' The team published the code, the numbers and a long write-up that explains what changed, what it costs and why it matters for people who build with it.'.repeat(12);

function item(url: string, headline: string, sourceId: string): ReplayItem {
  return {
    key: safeKey(url),
    family: 'reels',
    sourceId,
    sourceName: sourceId,
    sourceType: 'B1',
    headline,
    body: `${headline}.${LONG}`,
    url,
    author: null,
    byline: null,
    publishTime: new Date(RUN_AT.getTime() - 3 * 3_600_000),
    firstSeenAt: new Date('2026-11-09T06:00:00Z'),
    engagement: null,
  };
}

function article(url: string, headline: string, publishedAt: Date): FetchedArticle {
  return { feedSlug: 'the-verge-ai', feedKind: 'native', source: 'The Verge', sourceUrl: url, headline, byline: null, body: `${headline}.${LONG}`, publishedAt };
}

const A = item('https://techcrunch.com/acme-rocket', 'Acme launches the Rocket model', 'techcrunch');
const B = item('https://theverge.com/acme-rocket-benchmarks', 'Acme Rocket model tops benchmarks', 'the-verge-ai');
const C = item('https://news.ycombinator.com/globex-lab', 'Globex engineer builds a robot arm from scrap', 'hacker-news');
const D = article('https://www.theverge.com/initech-funding', 'Initech raises a new funding round for chip design', new Date(RUN_AT.getTime() - 2 * 3_600_000));
const LATE = article('https://www.theverge.com/later-story', 'Umbrella Corp story published after the intake ran', new Date(RUN_AT.getTime() + 3_600_000));
const OLD = { key: safeKey('https://old.example.com/x'), headline: 'A story from before the replay' };

function snapshot(): Snapshot {
  return {
    nights: [
      {
        nyDate: '2026-11-09',
        runAt: RUN_AT,
        items: [A, B, C],
        legacy: {
          mdReels: [{ key: A.key, headline: A.headline }, OLD],
          mdCarousel: [],
          gtn: [],
          fvp: [],
          lfdReels: [{ key: A.key, headline: A.headline }, { key: C.key, headline: C.headline }],
          lfdCarousel: [],
        },
        postedHeadlines: [],
        feedSince: new Date(RUN_AT.getTime() - 48 * 3_600_000),
      },
    ],
    previous: [],
  };
}

function stubTransport(calls: { n: number }): JevTransport {
  return {
    async systemOne(state, questions) {
      calls.n += 1;
      const keys = Object.keys(questions);
      const s = state as Record<string, { headline?: string }>;
      let answers: Record<string, unknown>;
      if (keys.includes('relationship')) {
        const same = String(s.item_a?.headline).includes('Acme') && String(s.item_b?.headline).includes('Acme');
        answers = { sameEvent: { type: 'noul', noul: same ? 0.95 : 0.02 }, relationship: { type: 'choice', choice: same ? 'link' : 'unrelated', confidence: 0.9, probabilities: {} } };
      } else if (keys.includes('action')) {
        answers = { sameEvent: { type: 'noul', noul: 0.05 }, action: { type: 'choice', choice: 'keep_separate', confidence: 0.9, probabilities: {} } };
      } else {
        answers = Object.fromEntries(keys.map((k) => [k, { type: 'noul', noul: 0.1 }]));
      }
      return { model: 'stub-jev', answers, usage: { input_tokens: 1000, output_tokens: 0 } } as never;
    },
  };
}

/** Stub scorecards: one Jev call each (so the cap and the tally see them), fixed results. */
function card(id: Scorecard['id'], families: Scorecard['families'], result: (headline: string) => unknown): Scorecard {
  return {
    id,
    version: `${id}@stub`,
    families,
    async score(story, jev) {
      const res = await jev.asSocialAsk()({ state: { headline: story.headline }, questions: { probe: {} } as never }, { version: `${id}@stub`, subjectId: story.id });
      return { answers: res.answers, result: result(story.headline) as never, usd: 0 };
    },
  };
}

const CARDS: Scorecard[] = [
  card('reels-score', ['reels', 'search'], () => ({ kind: 'reels-score', score: { net: 0.5, blockbuster: 0, chosenBucket: 'the_shift' } as unknown as InterpretedScore })),
  card('story-scoring', ['feeds'], () => ({ kind: 'story-scoring', status: 'qualified', probSum: 2, outletCount: 1, answers: { field_shift: 0.9, industry_power: 0.6, must_know: 0.1 } })),
  card('major-news', ['reels', 'feeds', 'search', 'seed'], () => ({ kind: 'major-news', score: 0.3 })),
  card('story-builder', ['reels', 'feeds', 'search', 'seed'], (h) => ({ kind: 'story-builder', score: h.includes('Globex') ? 0.9 : 0.1 })),
];

test('overlap math: matched share of in-replay legacy, outside excluded, intake-only split', () => {
  const legacy = [
    { key: 'a', headline: 'A' },
    { key: 'b', headline: 'B' },
    { key: 'c', headline: 'C' },
    { key: 'old', headline: 'Old' },
  ];
  const intake = [
    { storyId: 's1', keys: ['a', 'a2'], headline: 'A story' },
    { storyId: 's2', keys: ['b'], headline: 'B story' },
    { storyId: 's3', keys: ['f'], headline: 'Feed story' },
    { storyId: 's4', keys: ['g'], headline: 'Builder story' },
    { storyId: 's5', keys: ['h'], headline: 'Other story' },
  ];
  const kinds: Record<string, 'feeds' | 'builder' | 'other'> = { s3: 'feeds', s4: 'builder', s5: 'other' };
  const c = compareLists(legacy, intake, (k) => k !== 'old', (x) => kinds[x.storyId!] ?? 'other');
  assert.equal(c.legacy, 4);
  assert.equal(c.outside, 1);
  assert.equal(c.inScope, 3);
  assert.equal(c.matched, 2);
  assert.equal(c.pct, 2 / 3);
  assert.deepEqual(c.legacyOnly, ['C']);
  assert.deepEqual(c.intakeOnly, { feeds: ['Feed story'], builder: ['Builder story'], other: ['Other story'] });
  assert.equal(compareLists([], intake, () => true, () => 'other').pct, null);
});

test('without --go: a plan only, no Jev call and no feed fetch', async () => {
  const store = await memoryIntake();
  try {
    const calls = { n: 0 };
    let fetched = 0;
    const { plan, result } = await replay(
      snapshot(),
      { intake: store.q, transport: stubTransport(calls), fetchFeeds: async () => (fetched++, [D]), scorecards: CARDS, capUsd: 1 },
      { go: false },
    );
    assert.equal(result, null);
    assert.equal(calls.n, 0);
    assert.equal(fetched, 0);
    assert.equal(plan.nights.length, 1);
    assert.equal(plan.nights[0]!.reels, 3);
    assert.ok(plan.usd > 0);
  } finally {
    await store.close();
  }
});

test('with --go on a fixture night: grouping, scoring, overlap per consumer and builder calibration', async () => {
  const store = await memoryIntake();
  try {
    const calls = { n: 0 };
    let fetched = 0;
    const { result } = await replay(
      snapshot(),
      {
        intake: store.q,
        transport: stubTransport(calls),
        fetchFeeds: async () => (fetched++, [D, LATE]),
        fetchBody: async () => null,
        scorecards: CARDS,
        capUsd: 1,
      },
      { go: true },
    );
    assert.ok(result);
    assert.equal(result.stopped, null);
    assert.equal(fetched, 1);
    const night = result.nights[0]!;
    assert.equal(night.items.reels, 3);
    assert.equal(night.items.feeds, 1);
    assert.equal(night.items.feedsAfterClock, 1, 'the article published after the intake clock is left out');
    assert.equal(night.grouping.joined, 1, 'the two Acme items are one story');

    // MD reels: A matched, the pre-replay story excluded, Globex (builder 0.9) is intake-only as a builder lead.
    const md = night.comparisons.mdReels!;
    assert.equal(md.outside, 1);
    assert.equal(md.matched, 1);
    assert.equal(md.pct, 1);
    assert.equal(md.intakeOnly.builder.length, 1);
    // MD carousel: legacy empty (carousel off); the feed story is new.
    assert.equal(night.comparisons.mdCarousel!.pct, null);
    assert.equal(night.comparisons.mdCarousel!.intakeOnly.feeds.length, 1);
    // LFD reels lane: both legacy stories matched; fresh feed: the one article on both sides.
    assert.equal(night.comparisons.lfdReels!.matched, 2);
    assert.equal(night.comparisons.lfdFeed!.matched, 1);
    assert.equal(night.comparisons.lfdFeed!.pct, 1);

    // Builder calibration.
    assert.equal(result.topBuilders[0]!.headline, C.headline);
    assert.equal(result.lineups.length, 3);
    const at06 = result.lineups.find((l) => l.bar === 0.6)!;
    assert.ok(at06.picks.some((p) => p.lane === 'builder' && p.headline === C.headline));
    assert.equal(night.mdBuilders['0.6']!.builders, 1);
    assert.equal(result.lineups.find((l) => l.bar === 0.5)!.builders >= at06.builders, true);

    // Every Jev call went through the metered, capped surface.
    assert.equal(result.totalCalls, calls.n);
    assert.ok(result.steps.some((s) => s.step === 'story-builder'));

    // The report renders every section, in plain words.
    const report = renderReport(result, snapshot(), new Date('2026-11-09T18:00:00Z'));
    for (const heading of ['## Coverage by night', '## Builder bar calibration', '## Cost and runtime']) assert.ok(report.includes(heading), heading);
    if (process.env.SHOW_REPORT) console.log(report);
  } finally {
    await store.close();
  }
});
