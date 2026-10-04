/**
 * Helios Social rebuild — M1 ingest and story selection tests.
 *
 * Offline only: stubbed Jev answers (fixtures/social/ingest/day.ts), no
 * Claude, no network, no DB (CLAUDE.md; spec §9).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  A1, A2, A4, ARTICLES, B1, B2, C1, D1, E1, F1, FEEDS, FULL_TEXT, G1, H1, I1, K1, NOW, POSTED, fixtureJev,
} from '@/fixtures/social/ingest/day';
import { createJevAsk, jevCostUsd, type JevAsk } from '@/lib/social/jev/client';
import * as DifferentStory from '@/lib/social/jev/questions/different-story.v1';
import * as SameEvent from '@/lib/social/jev/questions/same-event.v1';
import * as Scoring from '@/lib/social/jev/questions/story-scoring.v1';
import { createStubJev } from '@/lib/social/jev/stub';
import { applyCodeFilters } from '@/lib/social/ingest/select/code-filters';
import type { FetchBody } from '@/lib/social/ingest/select/enrich';
import { createInMemoryFeedHealthLog } from '@/lib/social/ingest/select/feed-health';
import { groupArticles, outletKey } from '@/lib/social/ingest/select/group';
import { createInMemoryPosted } from '@/lib/social/ingest/select/posted';
import { compareScored, SHORTLIST_MAX } from '@/lib/social/ingest/select/rank';
import { judge } from '@/lib/social/ingest/select/score';
import { selectStories } from '@/lib/social/ingest/select/select';
import type { ScoredGroup, StoryGroup } from '@/lib/social/ingest/select/types';
import { inWindow, isWeekend, windowHours } from '@/lib/social/ingest/select/window';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createSelectionStage } from '@/lib/social/pipeline/selection-stage';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { createStubStages } from '@/lib/social/pipeline/stubs';

const stubFetchBody = (calls: string[] = []): FetchBody => async (url) => {
  calls.push(url);
  return FULL_TEXT[url] ?? null;
};

/** Wrap a JevAsk to count calls per question-set version. */
function counting(ask: JevAsk) {
  const calls: Record<string, string[]> = {};
  const wrapped: JevAsk = async (req, meta) => {
    (calls[meta.version] ??= []).push(meta.subjectId);
    return ask(req, meta);
  };
  return { ask: wrapped, calls };
}

const select = (articles = ARTICLES, jev: JevAsk = fixtureJev(), fetchCalls: string[] = []) =>
  selectStories({
    feeds: FEEDS,
    articles,
    now: NOW,
    jev,
    posted: createInMemoryPosted(POSTED),
    fetchBody: stubFetchBody(fetchCalls),
  });

// ── Freshness ──────────────────────────────────────────────────────────

test('freshness: 24h on weekdays, 36h on weekends, 48h widened (New York day)', () => {
  assert.equal(windowHours(NOW, false), 24); // Tuesday
  const saturday = new Date('2026-10-10T15:00:00Z');
  assert.equal(isWeekend(saturday), true);
  assert.equal(windowHours(saturday, false), 36);
  assert.equal(windowHours(saturday, true), 48);
  // 02:00Z Monday is still Sunday evening in New York.
  assert.equal(isWeekend(new Date('2026-10-12T02:00:00Z')), true);
  assert.equal(isWeekend(new Date('2026-10-12T05:00:00Z')), false);
  assert.equal(inWindow(A1, NOW, 24), true);
  assert.equal(inWindow(H1, NOW, 24), false);
  assert.equal(inWindow(H1, NOW, 36), true);
});

// ── Code filters ───────────────────────────────────────────────────────

test('code filters skip listicles, deals and tutorials, and log the reason', () => {
  const { kept, skipped } = applyCodeFilters([A1, F1]);
  assert.deepEqual(kept, [A1]);
  assert.deepEqual(skipped, [{ id: F1.sourceUrl, reason: 'listicle', stage: 'code-filter' }]);
  const more = applyCodeFilters([
    { ...A1, headline: 'How to use ChatGPT for email' },
    { ...A1, headline: 'Get 40% off ChatGPT Plus today' },
    { ...A1, headline: 'Top 5 AI laptops' },
  ]);
  assert.deepEqual(more.skipped.map((s) => s.reason), ['tutorial', 'deal', 'listicle']);
});

// ── Grouping ───────────────────────────────────────────────────────────

test('grouping: a 3-outlet story becomes one group carrying all 3 member URLs', async () => {
  const groups = await groupArticles([A1, A2, A4, K1], fixtureJev());
  const x = groups.find((g) => g.members.some((m) => m.url === A1.sourceUrl))!;
  assert.equal(x.outletCount, 3);
  assert.deepEqual(new Set(x.members.map((m) => m.url)), new Set([A1.sourceUrl, A2.sourceUrl, A4.sourceUrl]));
  assert.equal(x.members.length, 3);
  for (const m of x.members) {
    assert.ok(m.outlet && m.title && m.publishedAt instanceof Date && m.feedSlug);
  }
  assert.equal(x.id, A1.sourceUrl); // native + longest body
  assert.equal(x.publishedAt.getTime(), A1.publishedAt.getTime()); // newest member
});

test('grouping: a pair under the threshold stays split', async () => {
  const groups = await groupArticles([A1, A2, A4, K1], fixtureJev());
  assert.equal(groups.length, 2);
  const k = groups.find((g) => g.id === K1.sourceUrl)!;
  assert.equal(k.members.length, 1);
});

test('grouping: native and Google News copies of one outlet count once', async () => {
  assert.equal(outletKey('Wired'), outletKey('WIRED'));
  const [b] = await groupArticles([B1, B2], fixtureJev());
  assert.equal(b!.members.length, 2);
  assert.equal(b!.outletCount, 1);
  assert.equal(b!.id, B1.sourceUrl); // native preferred over the Google News copy
});

// ── Scoring rules ──────────────────────────────────────────────────────

const group = (over: Partial<StoryGroup> = {}): StoryGroup => ({
  id: 'g', members: [], outlets: ['X'], outletCount: 1, publishedAt: NOW, representative: A1, body: A1.body, ...over,
});

test('scoring: skip list, already posted, and the required questions', () => {
  const base = { ai_main_subject: 0.9, substance: 0.9, number_or_quote: 0.9, why_it_matters: 0.9, sourcing: 0.9, photographable_subject: 0.9 };
  assert.equal(judge(group(), { ...base, skip_crime_violence: 0.9 }).status, 'skipped');
  assert.equal(judge(group(), { ...base, skip_crime_violence: 0.84 }).status, 'qualified');
  assert.equal(judge(group(), { ...base, already_posted: 0.8 }).reason, 'already_posted');
  const nq = judge(group(), { ...base, substance: 0.5 });
  assert.equal(nq.status, 'not-qualified');
  assert.match(nq.reason!, /substance/);
  const scored = judge(group(), { ...base, sourcing: 0.4 });
  assert.equal(scored.passes, 3);
  assert.ok(Math.abs(scored.probSum - 3.1) < 1e-9);
});

test('scoring: the already-posted question is only asked when something was posted', () => {
  assert.ok(!(Scoring.POSTED_ID in Scoring.buildQuestions([])));
  assert.ok(Scoring.POSTED_ID in Scoring.buildQuestions(['x']));
  assert.equal(Object.keys(Scoring.buildQuestions(['x'])).length, 11);
});

// ── Ranking ────────────────────────────────────────────────────────────

const scored = (id: string, passes: number, outletCount: number, probSum: number, hoursOld = 1): ScoredGroup => ({
  ...group({ id, outletCount, publishedAt: new Date(NOW.getTime() - hoursOld * 3_600_000) }),
  answers: {}, status: 'qualified', passes, probSum,
});

test('ranking: passes beat probability sum; equal passes tie-break by outlets, then sum, then newest', () => {
  const list = [
    scored('sum-high', 3, 1, 3.9),
    scored('passes-4', 4, 1, 2.1),
    scored('outlets-3', 3, 3, 1.6),
    scored('same-older', 3, 1, 3.9, 5),
  ].sort(compareScored);
  assert.deepEqual(list.map((g) => g.id), ['passes-4', 'outlets-3', 'sum-high', 'same-older']);
});

// ── Full selection on the fixture day ──────────────────────────────────

test('selection: winners, backups in order, skips logged, one scoring call per group', async () => {
  const { ask, calls } = counting(fixtureJev());
  const fetchCalls: string[] = [];
  const s = await select(ARTICLES, ask, fetchCalls);

  assert.equal(s.windowHours, 24);
  assert.equal(s.widened, false);

  // 24h groups: X(A1,A2,A4), K, B(B1,B2), C(C1,C2), D, E, G → 7; F filtered, H and I outside.
  assert.equal(s.scored.length, 7);
  assert.equal(calls[Scoring.VERSION]!.length, 7);
  assert.equal(new Set(calls[Scoring.VERSION]).size, 7);
  assert.equal(calls[DifferentStory.VERSION]!.length, 1);
  assert.ok(calls[SameEvent.VERSION]!.length > 0);

  // Rank: X (4 passes, 3 outlets) > K (4, 1) > C (3 passes, 2 outlets) > B (3, 1, higher sum).
  assert.deepEqual(s.shortlist.map((g) => g.id), [A1.sourceUrl, K1.sourceUrl, C1.sourceUrl, B1.sourceUrl]);
  // K is OpenAI/GPT-6 like X, so it is passed over for #2 and stays first backup.
  assert.deepEqual(s.winners.map((g) => g.id), [A1.sourceUrl, C1.sourceUrl]);
  assert.deepEqual(s.backups.map((g) => g.id), [K1.sourceUrl, B1.sourceUrl]);
  assert.deepEqual(s.sameTopicAsFirst, [K1.sourceUrl]);
  assert.ok(s.shortlist.length <= SHORTLIST_MAX);

  // Defense business news is not skipped; the weapons test, already-posted and side-detail stories are.
  const reasons = Object.fromEntries(s.skipped.map((k) => [k.id, k.reason]));
  assert.equal(reasons[C1.sourceUrl], undefined);
  assert.equal(reasons[D1.sourceUrl], 'skipped: skip_weapons_war');
  assert.equal(reasons[E1.sourceUrl], 'skipped: already_posted');
  assert.match(reasons[G1.sourceUrl]!, /^not-qualified: required: ai_main_subject/);
  assert.equal(reasons[F1.sourceUrl], 'listicle');

  // Only the thin body was fetched, and its full text was scored.
  assert.deepEqual(fetchCalls, [G1.sourceUrl]);
  assert.ok(s.scored.find((g) => g.id === G1.sourceUrl)!.body.length > 1500);

  // Winner X carries its three member URLs for the Reporter.
  assert.equal(s.winners[0]!.members.length, 3);

  // Cost: input tokens only, at the Jev rate.
  assert.ok(s.jevInputTokens > 0);
  assert.ok(Math.abs(s.costUsd - jevCostUsd({ input_tokens: s.jevInputTokens, output_tokens: 0 })) < 1e-12);
  assert.equal(s.jevCalls, Object.values(calls).flat().length);
});

test('feed health: per-feed counts, and a feed returning 0 is flagged', async () => {
  const s = await select();
  const byFeed = Object.fromEntries(s.feedHealth.map((h) => [h.slug, h]));
  assert.equal(byFeed['empty-feed']!.flagged, true);
  assert.equal(byFeed['empty-feed']!.fetched, 0);
  assert.equal(byFeed['verge']!.fetched, 3); // A1, D1, H1
  assert.equal(byFeed['verge']!.inWindow, 2); // H1 is 30h old
  assert.equal(byFeed['verge']!.flagged, false);
  assert.equal(s.feedHealth.filter((h) => h.flagged).length, 1);
  assert.equal(s.feedHealth[0]!.day, '2026-10-06');
});

test('widening: fewer than 2 qualify at 24h, so the window widens to 48h', async () => {
  const { ask, calls } = counting(fixtureJev());
  const s = await select([A1, A2, A4, H1, I1], ask);
  assert.equal(s.widened, true);
  assert.equal(s.windowHours, 48);
  assert.deepEqual(s.winners.map((g) => g.id), [A1.sourceUrl, H1.sourceUrl]);
  // I1 is inside 48h but lacks substance.
  assert.ok(s.skipped.some((k) => k.id === I1.sourceUrl && /substance/.test(k.reason)));
  // 1 group at 24h, then 3 groups at 48h.
  assert.equal(calls[Scoring.VERSION]!.length, 4);
});

test('a single qualifying story is the only winner', async () => {
  const s = await select([A1, A2, A4]);
  assert.equal(s.widened, true);
  assert.deepEqual(s.winners.map((g) => g.id), [A1.sourceUrl]);
  assert.deepEqual(s.backups, []);
});

// ── Jev client ─────────────────────────────────────────────────────────

test('Jev client: building it needs no API key; the stub throws on unknown keys', async () => {
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    assert.doesNotThrow(() => createJevAsk());
  } finally {
    if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
  }
  const stub = createStubJev({});
  await assert.rejects(
    stub({ state: 'x', questions: Scoring.buildQuestions([]) }, { version: Scoring.VERSION, subjectId: 'nope' }),
    /no answers/,
  );
  assert.equal(jevCostUsd({ input_tokens: 1_000_000, output_tokens: 5_000 }), 0.042);
});

test('every question set is versioned', () => {
  for (const v of [Scoring.VERSION, SameEvent.VERSION, DifferentStory.VERSION]) assert.match(v, /^[a-z-]+@\d+$/);
});

// ── Integration with runDay ────────────────────────────────────────────

function selectionDay(failStory?: string) {
  const feedHealthLog = createInMemoryFeedHealthLog();
  const meter = createCostMeter();
  const stub = createStubStages(
    failStory ? { failures: [{ stage: 'reporter', reasonCode: 'malformed-output', storyId: failStory }] } : {},
  );
  const stages = {
    ...stub,
    score: createSelectionStage({
      feeds: FEEDS,
      jev: fixtureJev(),
      posted: createInMemoryPosted(POSTED),
      fetchBody: stubFetchBody(),
      feedHealthLog,
    }),
  };
  return { feedHealthLog, meter, run: runDay({ articles: ARTICLES, stages, meter, log: createInMemorySetAsideLog(), now: NOW }) };
}

test('runDay with real selection runs both winners; Jev cost lands under jev-scoring', async () => {
  const { run, meter, feedHealthLog } = selectionDay();
  const r = await run;
  assert.equal(r.stopReason, 'target-reached');
  assert.deepEqual(r.posts.map((p) => p.storyId), [A1.sourceUrl, C1.sourceUrl]);
  assert.ok((meter.byStage()['jev-scoring'] ?? 0) > 0);
  assert.equal(feedHealthLog.entries.length, FEEDS.length);
});

test('runDay: when winner #1 is set aside, backup #1 takes the slot', async () => {
  const r = await selectionDay(A1.sourceUrl).run;
  assert.deepEqual(r.posts.map((p) => p.storyId), [C1.sourceUrl, K1.sourceUrl]);
  assert.equal(r.setAsides[0]!.storyId, A1.sourceUrl);
});

test('a Jev failure during selection ends the day as scoring-failed', async () => {
  const broken: JevAsk = async () => {
    throw new Error('service unavailable');
  };
  const r = await runDay({
    articles: ARTICLES,
    stages: {
      ...createStubStages(),
      score: createSelectionStage({
        feeds: FEEDS, jev: broken, posted: createInMemoryPosted(), fetchBody: stubFetchBody(), feedHealthLog: createInMemoryFeedHealthLog(),
      }),
    },
    meter: createCostMeter(),
    log: createInMemorySetAsideLog(),
    now: NOW,
  });
  assert.equal(r.stopReason, 'scoring-failed');
  assert.equal(r.setAsides[0]!.reasonCode, 'service-error');
  assert.equal(r.posts.length, 0);
});
