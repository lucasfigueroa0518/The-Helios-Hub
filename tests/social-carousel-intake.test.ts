/**
 * Carousel selection in intake mode (Central Intake Phase 2, Owner C). Offline:
 * the intake read, the posted list and Jev are stubs; nothing is fetched.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { readConsumerMode } from '@/lib/intake/read';
import type { IntakeItem, IntakeQuery, IntakeRunRecord, ScoredStory } from '@/lib/intake/types';
import type { FeedConfig } from '@/lib/social/feeds';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';
import * as DifferentStory from '@/lib/social/jev/questions/different-story.v1';
import * as SameEvent from '@/lib/social/jev/questions/same-event.v1';
import * as Scoring from '@/lib/social/jev/questions/story-scoring.v4';
import { createStubJev, stubKey } from '@/lib/social/jev/stub';
import type { FetchBody } from '@/lib/social/ingest/select/enrich';
import { createInMemoryFeedHealthLog } from '@/lib/social/ingest/select/feed-health';
import { carouselMember, readLatestIntakeRecord, type ListOrderStories } from '@/lib/social/ingest/select/intake';
import { STORY_SCORING } from '@/lib/intake/scorecards';
import { createInMemoryPosted } from '@/lib/social/ingest/select/posted';
import { selectStories, type Selection } from '@/lib/social/ingest/select/select';
import type { IngestArticle } from '@/lib/social/ingest/select/types';
import { createSelectionStage, type IntakeSelectionDeps } from '@/lib/social/pipeline/selection-stage';

const NOW = new Date('2026-11-10T13:00:00Z'); // a Tuesday
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const LONG = 'Full story text. '.repeat(120); // over THIN_BODY_CHARS: read without a fetch

const FEEDS: FeedConfig[] = [
  { slug: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed', kind: 'native' },
  { slug: 'verge', name: 'The Verge', url: 'https://theverge.com/rss', kind: 'native' },
];

/** Every story-scoring@4 question at 0.1 unless overridden. */
function answers(over: Record<string, number> = {}): Record<string, number> {
  return { ...Object.fromEntries(Object.keys(Scoring.buildQuestions([])).map((id) => [id, 0.1])), ...over };
}
const QUALIFIED = { ai_main_subject: 0.9, substance: 0.9, news_event: 0.9, commentary: 0.1, must_know: 0.7, common_person: 0.6, sourcing: 0.8 };

function feedItem(o: { url: string; headline: string; outlet: string; slug: string; at?: Date }): IntakeItem {
  return {
    key: o.url, family: 'feeds', sourceId: `feed:${o.slug}`, sourceName: o.outlet, sourceType: 'feed',
    headline: o.headline, body: LONG, url: o.url, publishTime: o.at ?? hoursAgo(3),
    firstSeenAt: hoursAgo(2), lastSeenAt: hoursAgo(2), engagement: null, dropReason: null,
    feedSlug: o.slug, feedDropReason: null, feedSourceName: o.outlet, reelsSourceId: null, reelsDropReason: null,
    storyId: null, role: 'primary',
  };
}

function story(id: string, members: IntakeItem[], ans: Record<string, number>): ScoredStory {
  const outletCount = new Set(members.map((m) => m.sourceName)).size;
  const g = Scoring.gate(ans);
  return {
    id, representativeKey: members[0]!.key, headline: members[0]!.headline,
    firstSeenAt: hoursAgo(2), lastJoinedAt: hoursAgo(2), mergedInto: null,
    members: members.map((m, i) => ({ ...m, storyId: id, role: i === 0 ? 'primary' : 'supporting' })),
    scores: { 'story-scoring': { kind: 'story-scoring', status: g.status, probSum: Scoring.engagementScore(ans, outletCount), outletCount, answers: ans } },
    eventDate: null, yours: false,
  };
}

const U = (s: string) => `https://news.example.com/${s}`;
const S1 = story('s1', [
  feedItem({ url: U('zentrix-1'), headline: 'Zentrix ships a robot arm model that learns from video', outlet: 'TechCrunch', slug: 'techcrunch' }),
  feedItem({ url: 'https://verge.example.com/zentrix-2', headline: 'Zentrix robot arm model learns from video', outlet: 'The Verge', slug: 'verge' }),
], answers({ ...QUALIFIED, field_shift: 0.9 }));
const S2 = story('s2', [
  feedItem({ url: U('quorly'), headline: 'Quorly opens its speech model to every developer', outlet: 'TechCrunch', slug: 'techcrunch' }),
  { ...feedItem({ url: U('quorly-hn'), headline: 'Quorly speech model is open', outlet: 'Hacker News', slug: 'unused' }),
    family: 'reels', sourceId: 'hacker-news', feedSlug: null, feedSourceName: null, reelsSourceId: 'hacker-news' } as IntakeItem,
], answers({ ...QUALIFIED, field_shift: 0.7 }));
const S3 = story('s3', [
  feedItem({ url: U('listicle'), headline: 'The 10 best AI tools for writing', outlet: 'The Verge', slug: 'verge' }),
], answers({ ...QUALIFIED }));
const S4 = story('s4', [
  feedItem({ url: U('opinion'), headline: 'Why Plinth thinks agents are overrated', outlet: 'The Verge', slug: 'verge' }),
], answers({ ...QUALIFIED, commentary: 0.9 }));
const S5 = story('s5', [
  feedItem({ url: U('posted'), headline: 'Vexa raises a new round for its chip startup', outlet: 'TechCrunch', slug: 'techcrunch' }),
], answers({ ...QUALIFIED, field_shift: 0.8 }));
const STORIES = [S1, S2, S3, S4, S5];
/** Whether story-scoring reads reels-adapter members too (the intake core's call). */
const WITH_REELS = STORY_SCORING.families.includes('reels');

/** Jev: DifferentStory (and SameEvent) answered "different"; every call counted by version. */
function countingJev(table: Record<string, Record<string, number>> = {}) {
  const calls: Record<string, string[]> = {};
  const different: JevAsk = async (req) => ({
    answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, { noul: 0.1 }])) as JevResult['answers'],
    usage: { input_tokens: 10, output_tokens: 0 },
    model: 'stub',
  });
  const inner = createStubJev(table, { [DifferentStory.VERSION]: different, [SameEvent.VERSION]: different });
  const ask: JevAsk = async (req, meta) => {
    (calls[meta.version] ??= []).push(meta.subjectId);
    return inner(req, meta);
  };
  return { ask, calls };
}

const RECORD: IntakeRunRecord = {
  kind: 'main', orders: ['carousel'],
  sources: [
    { id: 'feed:techcrunch', fetched: 12, kept: 10, dropped: {} },
    { id: 'hacker-news', fetched: 0, kept: 0, dropped: {}, error: 'timeout' },
    { id: 'search:b6', fetched: 3, kept: 3, dropped: {} },
  ],
  grouping: { created: 0, joined: 0, merges: 0, pairCalls: 0, cacheHits: 0 },
  scoring: {} as IntakeRunRecord['scoring'],
  usd: 0,
};

const Q: IntakeQuery = { query: async () => ({ rows: [] }) };

function intakeStage(o: { stories?: ScoredStory[]; list?: ListOrderStories; posted?: string[]; jev?: JevAsk; fallback?: IntakeSelectionDeps['fallback'] } = {}) {
  const fetches: string[] = [];
  const fetchBody: FetchBody = async (url) => {
    fetches.push(url);
    return null;
  };
  const fallbackCalls: number[] = [];
  const feedHealthLog = createInMemoryFeedHealthLog();
  const jev = o.jev ?? countingJev().ask;
  let selection: Selection | null = null;
  const lists: Array<{ order: string; since: Date }> = [];
  const stage = createSelectionStage({
    feeds: FEEDS,
    jev,
    posted: createInMemoryPosted((o.posted ?? []).map((headline) => ({ headline, postedAt: hoursAgo(48).toISOString() }))),
    fetchBody,
    feedHealthLog,
    onSelection: (s) => {
      selection = s;
    },
    intake: {
      query: Q,
      listOrderStories: o.list ?? (async (_q, order, input) => {
        lists.push({ order, since: input.since });
        return o.stories ?? STORIES;
      }),
      adapterNames: new Map([['hacker-news', 'Hacker News']]),
      readRunRecord: async () => RECORD,
      fallback: o.fallback ?? (async () => {
        fallbackCalls.push(1);
        return { articles: [], feeds: FEEDS };
      }),
    },
  });
  return { stage, fetches, fallbackCalls, feedHealthLog, lists, selection: () => selection! };
}

// ── intake mode: no fetch, no grouping/scoring Jev ─────────────────────

test('intake mode: zero feed/adapter fetch, no scoring-time page fetch, zero grouping or scoring Jev calls', async () => {
  const jev = countingJev();
  const t = intakeStage({ jev: jev.ask });
  const res = await t.stage([], NOW);
  assert.ok(res.ok);
  assert.deepEqual(t.fallbackCalls, []); // today's fetch never ran
  // Scoring reads no page (every member already had its text). The only read is today's shortlist top-up of the
  // Reporter's starting sources: S2's second member, a reels-adapter article the carousel scores (families feeds+reels).
  assert.deepEqual(t.fetches, [U('quorly-hn')]);
  assert.equal(jev.calls[Scoring.VERSION], undefined); // no scoreGroups (and no posted list, so no posted check)
  assert.equal(jev.calls[SameEvent.VERSION], undefined); // no groupArticles (and no same-company stories to fold)
  assert.deepEqual(Object.keys(jev.calls), [DifferentStory.VERSION]); // the pick of #2 only, as today
  assert.deepEqual(t.lists.map((l) => l.order), ['carousel']);
  assert.equal(t.lists[0]!.since.getTime(), hoursAgo(48).getTime());

  const sel = t.selection();
  assert.deepEqual(sel.winners.map((g) => g.id), [U('zentrix-1'), U('posted')]);
  assert.deepEqual(res.value.map((c) => c.id), [U('zentrix-1'), U('posted'), U('quorly')]);
  // Code filters: the listicle member is dropped and logged; the commentary story is not qualified.
  assert.ok(sel.skipped.some((s) => s.id === U('listicle') && s.reason === 'listicle' && s.stage === 'code-filter'));
  assert.ok(sel.skipped.some((s) => s.id === U('opinion') && s.stage === 'scoring' && /^not-qualified: required: commentary/.test(s.reason)));
  // Members are the ones story-scoring read (its families); a reels-adapter member shows as its hub feed, as
  // fetchHubSources maps it.
  const quorly = sel.scored.find((g) => g.id === U('quorly'))!;
  assert.deepEqual(quorly.members.map((m) => m.feedSlug).sort(), WITH_REELS ? ['reels-hacker-news', 'techcrunch'] : ['techcrunch']);
  assert.equal(carouselMember(S2.members[1]!).sourceId, 'feed:reels-hacker-news');
});

// ── shape parity with the legacy selection ─────────────────────────────

/** The type shape of a JSON value (answers is a record whose keys depend on the posted list). */
function shape(v: unknown, key = ''): unknown {
  if (key === 'answers') return 'record';
  if (Array.isArray(v)) return v.length ? ['array', shape(v[0])] : ['array'];
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as Record<string, unknown>)[k], k)]));
  return v === null ? 'null' : typeof v;
}
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, unknown>;

test('record.selection.scored and .shortlist: the same shape (and values) as the legacy path for an equivalent fixture', async () => {
  const article = (url: string, headline: string, source: string, feedSlug: string): IngestArticle => ({
    feedSlug, feedKind: 'native', source, sourceUrl: url, headline, byline: null, body: LONG, publishedAt: hoursAgo(3),
  });
  const A = article(U('zentrix-1'), 'Zentrix ships a robot arm model that learns from video', 'TechCrunch', 'techcrunch');
  const B = article(U('quorly'), 'Quorly opens its speech model to every developer', 'The Verge', 'verge');
  const ansA = answers({ ...QUALIFIED, field_shift: 0.9 });
  const ansB = answers({ ...QUALIFIED, field_shift: 0.7 });

  const legacyJev = countingJev({ [stubKey(Scoring.VERSION, A.sourceUrl)]: ansA, [stubKey(Scoring.VERSION, B.sourceUrl)]: ansB });
  const legacy = await selectStories({
    feeds: FEEDS, articles: [A, B], now: NOW, jev: legacyJev.ask, posted: createInMemoryPosted(), fetchBody: async () => null,
  });

  const asItem = (a: IngestArticle): IntakeItem => feedItem({ url: a.sourceUrl, headline: a.headline, outlet: a.source, slug: a.feedSlug, at: a.publishedAt });
  const t = intakeStage({ stories: [story('a', [asItem(A)], ansA), story('b', [asItem(B)], ansB)] });
  assert.ok((await t.stage([], NOW)).ok);
  const intake = t.selection();

  assert.equal(legacy.scored.length, 2);
  assert.deepEqual(shape(json(intake).scored), shape(json(legacy).scored));
  assert.deepEqual(shape(json(intake).shortlist), shape(json(legacy).shortlist));
  assert.deepEqual(shape(Object.keys(json(intake)).sort()), shape(Object.keys(json(legacy)).sort()));
  // Beyond shape: the same groups, ranked the same, with the same scores.
  const byId = (s: Selection) => [...json(s).shortlist as Array<Record<string, unknown>>].sort((x, y) => String(x.id).localeCompare(String(y.id)));
  assert.deepEqual(byId(intake), byId(legacy));
  assert.deepEqual(intake.winners.map((g) => g.id), legacy.winners.map((g) => g.id));
});

// ── the posted check at pick time ──────────────────────────────────────

test('posted check: a story the carousel already posted is skipped (already_posted), never shortlisted', async () => {
  // lib/intake/posted.ts postedCheck, live, over the stub Jev: only the already_posted question, per qualified story.
  const posted: Record<string, Record<string, number>> = {};
  for (const s of STORIES) posted[stubKey(Scoring.VERSION, s.id)] = { [Scoring.POSTED_ID]: s.id === 's5' ? 0.95 : 0.05 };
  const jev = countingJev(posted);
  const t = intakeStage({ jev: jev.ask, posted: ['Vexa raises a new round for its chip startup'] });
  const res = await t.stage([], NOW);
  assert.ok(res.ok);
  const sel = t.selection();
  const s5 = sel.scored.find((g) => g.id === U('posted'))!;
  assert.equal(s5.status, 'skipped');
  assert.equal(s5.reason, Scoring.POSTED_ID);
  assert.ok(!sel.shortlist.some((g) => g.id === U('posted')));
  assert.ok(sel.skipped.some((s) => s.id === U('posted') && s.reason === 'skipped: already_posted'));
  assert.deepEqual(sel.winners.map((g) => g.id), [U('zentrix-1'), U('quorly')]);
  // Checked once each, qualified stories only (the commentary story is not asked).
  assert.deepEqual([...(jev.calls[Scoring.VERSION] ?? [])].sort(), ['s1', 's2', 's5']);
  assert.ok(res.costUsd > 0);
});

// ── feed health from the intake run record ─────────────────────────────

test('feed health: one row per carousel feed and hub adapter, from the intake run record', async () => {
  const t = intakeStage();
  assert.ok((await t.stage([], NOW)).ok);
  const rows = t.feedHealthLog.entries;
  assert.deepEqual(rows.map((r) => [r.slug, r.name, r.fetched, r.flagged]), [
    ['techcrunch', 'TechCrunch', 12, false],
    ['verge', 'The Verge', 0, true], // not in the record: counted as nothing fetched
    ['reels-hacker-news', 'Hacker News', 0, true], // failed
  ]);
  // In window: the pool's members from that source inside tonight's 24 h.
  assert.deepEqual(rows.map((r) => r.inWindow), [3, 2, WITH_REELS ? 1 : 0]);
  assert.ok(rows.every((r) => r.day === rows[0]!.day));
  assert.deepEqual(t.selection().feedHealth, rows);
});

test('readLatestIntakeRecord: the newer of the last successful main and top-up runs', async () => {
  const asked: unknown[][] = [];
  const q: IntakeQuery = {
    query: async <T>(text: string, params?: unknown[]) => {
      if (/DISTINCT ON \(kind\)/.test(text)) {
        return { rows: [{ id: 'm1', kind: 'main', started_at: hoursAgo(13) }, { id: 't1', kind: 'topup', started_at: hoursAgo(10) }] as T[] };
      }
      asked.push(params ?? []);
      return { rows: [{ record: JSON.stringify(RECORD) }] as T[] };
    },
  };
  const rec = await readLatestIntakeRecord(q);
  assert.deepEqual(asked, [['t1']]);
  assert.equal(rec?.sources.length, 3);
  assert.equal(await readLatestIntakeRecord({ query: async <T>() => ({ rows: [] as T[] }) }), null);
});

// ── fallbacks: today's path ────────────────────────────────────────────

test('an intake read that throws takes today\'s path: fetch, then group and score the articles', async () => {
  const A: IngestArticle = { feedSlug: 'techcrunch', feedKind: 'native', source: 'TechCrunch', sourceUrl: U('zentrix-1'), headline: 'Zentrix ships a robot arm model', byline: null, body: LONG, publishedAt: hoursAgo(3) };
  const jev = countingJev({ [stubKey(Scoring.VERSION, A.sourceUrl)]: answers(QUALIFIED) });
  const fetched: number[] = [];
  const t = intakeStage({
    jev: jev.ask,
    list: async () => {
      throw new Error('intake down');
    },
    fallback: async () => {
      fetched.push(1);
      return { articles: [A], feeds: FEEDS };
    },
  });
  const res = await t.stage([], NOW);
  assert.ok(res.ok);
  assert.deepEqual(fetched, [1]);
  assert.deepEqual(jev.calls[Scoring.VERSION], [A.sourceUrl, A.sourceUrl]); // scored the legacy way (one story: the window widens and it is scored again)
  assert.deepEqual(res.value.map((c) => c.id), [A.sourceUrl]);
  assert.deepEqual(t.feedHealthLog.entries.map((r) => [r.slug, r.fetched]), [['techcrunch', 1], ['verge', 0]]); // buildFeedHealth
});

test('stale intake → not intake mode; a stage without intake deps is today\'s path', async () => {
  // The switch says intake, but the last main run is older than INTAKE_FRESH_HOURS: the script builds no intake deps.
  const q: IntakeQuery = {
    query: async <T>(text: string) => {
      if (/intake\.settings/.test(text)) return { rows: [{ value: { carousel: 'intake' } }] as T[] };
      if (/DISTINCT ON \(kind\)/.test(text)) return { rows: [{ id: 'm1', kind: 'main', started_at: hoursAgo(30) }] as T[] };
      return { rows: [] as T[] };
    },
  };
  assert.notEqual(await readConsumerMode(q, 'carousel', NOW), 'intake');

  const A: IngestArticle = { feedSlug: 'verge', feedKind: 'native', source: 'The Verge', sourceUrl: U('quorly'), headline: 'Quorly opens its speech model', byline: null, body: LONG, publishedAt: hoursAgo(3) };
  const jev = countingJev({ [stubKey(Scoring.VERSION, A.sourceUrl)]: answers(QUALIFIED) });
  const feedHealthLog = createInMemoryFeedHealthLog();
  const stage = createSelectionStage({ feeds: FEEDS, jev: jev.ask, posted: createInMemoryPosted(), fetchBody: async () => null, feedHealthLog });
  const res = await stage([A], NOW);
  assert.ok(res.ok);
  assert.deepEqual(res.value.map((c) => c.id), [A.sourceUrl]);
  assert.deepEqual(jev.calls[Scoring.VERSION], [A.sourceUrl, A.sourceUrl]);
  assert.equal(feedHealthLog.entries.length, FEEDS.length);
});
