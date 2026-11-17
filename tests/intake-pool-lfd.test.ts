// tests/intake-pool-lfd.test.ts — LFD's three lanes from the central intake mirror the legacy rules (offline, stubbed).
import assert from 'node:assert/strict';
import test from 'node:test';

import { carouselNights, feedLaneOf, intakeLanes, lastCut, reelsLaneOf } from '@/lib/intake/pool-lfd';
import type { Family, IntakeItem, IntakeJev, IntakeQuery, ListStoriesInput, ScoredStory } from '@/lib/intake/types';
import type { LfdWindow } from '@/lib/lfd/types';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import { storyKey } from '@/lib/stories/sources/reels';

// Tuesday 2026-11-10, 3:05 AM NY (EST): the scheduled LFD run, in the carousel run's place.
const NOW = new Date('2026-11-10T08:05:00Z');
const W: LfdWindow = { after: '2026-11-06', through: '2026-11-10' };
const Q: IntakeQuery = { query: async () => ({ rows: [] }) };
const JEV = { usd: 0, calls: 0 } as unknown as IntakeJev;

let n = 0;
function item(o: Partial<IntakeItem> & { family: Family; seen: string; published?: string | null }): IntakeItem {
  n += 1;
  const url = o.url ?? `https://site${n}.com/story-${n}`;
  return {
    key: url, family: o.family, sourceId: o.family === 'feeds' ? 'feed:verge' : 'hn', sourceName: o.sourceName ?? `Outlet ${n}`, sourceType: o.family === 'feeds' ? 'feed' : 'news',
    headline: o.headline ?? `Headline ${n}`, body: o.body ?? 'body '.repeat(50), url,
    publishTime: o.published === undefined ? new Date(o.seen) : o.published === null ? null : new Date(o.published),
    firstSeenAt: new Date(o.seen), lastSeenAt: new Date(o.seen), engagement: null, dropReason: o.dropReason ?? null, storyId: null, role: o.role ?? 'primary',
  } as IntakeItem;
}

const reelsScore = (net: number, blockbuster = 0) => ({ net, blockbuster } as unknown as InterpretedScore);
const qualified = (probSum: number, status: 'qualified' | 'not-qualified' = 'qualified') => ({ kind: 'story-scoring' as const, status, probSum, outletCount: 1, answers: {} });

function story(id: string, members: IntakeItem[], scores: ScoredStory['scores'] = {}, extra: Partial<ScoredStory> = {}): ScoredStory {
  const first = new Date(Math.min(...members.map((m) => m.firstSeenAt.getTime())));
  return { id, representativeKey: members[0]!.key, headline: members[0]!.headline, firstSeenAt: first, lastJoinedAt: first, mergedInto: null, members: members.map((m) => ({ ...m, storyId: id })), scores, eventDate: null, yours: false, ...extra };
}

test('reels lane: the first reels night must be after the window start (NY midnight edge) and through its end', () => {
  const stories = [
    story('in', [item({ family: 'reels', seen: '2026-11-07T05:00:00Z' })], { 'reels-score': reelsScore(0.5) }), // 00:00 Nov 7 NY
    story('edge-out', [item({ family: 'reels', seen: '2026-11-07T04:59:00Z' })], { 'reels-score': reelsScore(0.9) }), // 23:59 Nov 6 NY = the `after` night
    story('no-score', [item({ family: 'reels', seen: '2026-11-08T06:00:00Z' })]),
    // First seen from a feed before the window; the reels member joined on Nov 8: its reels night is Nov 8.
    story('late-reels', [item({ family: 'feeds', seen: '2026-11-04T12:00:00Z' }), item({ family: 'reels', seen: '2026-11-08T06:00:00Z', role: 'supporting' })], { 'reels-score': reelsScore(0.4) }),
    story('search', [item({ family: 'search', seen: '2026-11-09T06:00:00Z' })], { 'reels-score': reelsScore(0.3) }),
  ];
  const lane = reelsLaneOf(stories, W);
  assert.deepEqual(lane.map((c) => c.refs[0]), ['in', 'late-reels', 'search']);
  assert.deepEqual(lane.map((c) => c.firstSeen), ['2026-11-07', '2026-11-08', '2026-11-09']);
});

test('reels lane: net and blockbuster are the BEST any reels-score reached (reelsBest), else the stored score (nit a)', () => {
  const stories = [
    story('peaked', [item({ family: 'reels', seen: '2026-11-08T06:00:00Z' })], { 'reels-score': reelsScore(0.1, 0) }, { reelsBest: { net: 0.95, blockbuster: 2 } }),
    story('steady', [item({ family: 'reels', seen: '2026-11-08T06:00:00Z' })], { 'reels-score': reelsScore(0.5) }),
  ];
  const lane = reelsLaneOf(stories, W);
  assert.deepEqual(lane.map((c) => [c.refs[0], c.net, c.blockbuster]), [['peaked', 0.95, 2], ['steady', 0.5, 0]]);
});

test('lanes: a URL a reels adapter stored first but a feed also carries is in the feed lane, with the feed\'s outlet (fix 1)', () => {
  const shared: IntakeItem = { ...item({ family: 'reels', seen: '2026-11-10T08:01:00Z', sourceName: 'TechCrunch AI adapter' }), feedSlug: 'techcrunch-ai', feedSourceName: 'TechCrunch', reelsSourceId: 'techcrunch-ai-blog', reelsDropReason: 'off_topic' };
  const lane = feedLaneOf([story('shared', [shared])], NOW);
  assert.deepEqual(lane.map((c) => [c.refs[0], c.sourceName]), [['shared', 'TechCrunch']]);
  assert.deepEqual(reelsLaneOf([story('shared', [shared], { 'reels-score': reelsScore(0.9) })], W), [], 'the reels screen dropped it: no reels member');
});

test('reels lane: net and blockbuster are the stored (latest) reels-score; blockbusters first, then net', () => {
  const stories = [
    story('a', [item({ family: 'reels', seen: '2026-11-08T06:00:00Z' })], { 'reels-score': reelsScore(0.9) }),
    story('b', [item({ family: 'reels', seen: '2026-11-08T06:00:00Z' })], { 'reels-score': reelsScore(0.2, 1) }),
    story('c', [item({ family: 'reels', seen: '2026-11-08T06:00:00Z' })], { 'reels-score': reelsScore(0.6), 'major-news': 0.7, 'story-builder': 0.8 }, { eventDate: new Date('2026-11-07T00:00:00Z') }),
  ];
  const lane = reelsLaneOf(stories, W);
  assert.deepEqual(lane.map((c) => c.refs[0]), ['b', 'a', 'c']);
  assert.equal(lane[1]!.net, 0.9);
  assert.equal(lane[0]!.blockbuster, 1);
  const c = lane[2]!;
  assert.equal(c.major, 0.7);
  assert.equal(c.builder, 0.8);
  assert.equal(c.eventDate, '2026-11-07T00:00:00.000Z');
});

test('keys follow the legacy scheme: storyKey of the lane representative; refs carry the story id and every member key', () => {
  const rep = item({ family: 'reels', seen: '2026-11-08T06:00:00Z', url: 'https://www.example.com/a?utm_source=x' });
  const other = item({ family: 'feeds', seen: '2026-11-08T07:00:00Z', url: 'https://other.com/b', role: 'supporting' });
  const [c] = reelsLaneOf([story('s1', [rep, other], { 'reels-score': reelsScore(0.5) })], W);
  assert.equal(c!.key, storyKey(rep.url));
  assert.deepEqual(c!.refs, ['s1', storyKey(rep.url), storyKey(other.url)]);
  assert.equal(c!.origin, 'reels');
});

test('carousel nights: after through through, a night counts once its 3:00 AM cut has settled (not the run\'s own 3:00 cut)', () => {
  assert.deepEqual(carouselNights(W, NOW).map((x) => x.night), ['2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06']);
  const later = new Date('2026-11-10T19:00:00Z'); // a manual run at 2 PM: tonight's cut has passed
  assert.equal(carouselNights(W, later)[0]!.night, '2026-11-10');
  assert.equal(lastCut(NOW).toISOString(), '2026-11-09T08:00:00.000Z');
});

test('carousel lane: per night the top 10 qualified, posted removed, ranked by story-scoring; the posted check goes only as deep as needed', async () => {
  // Night 2026-11-09 (Monday; 24 h window ending 08:00Z): 14 qualified stories, one not qualified, one posted.
  const night = (i: number) => new Date(Date.parse('2026-11-09T07:00:00Z') - i * 60_000).toISOString();
  const stories: ScoredStory[] = [];
  for (let i = 0; i < 14; i++) stories.push(story(`q${i}`, [item({ family: 'feeds', seen: night(i), headline: `Story number ${i} lands` })], { 'story-scoring': qualified(5 - i * 0.1) }));
  stories.push(story('nq', [item({ family: 'feeds', seen: night(20), headline: 'Not qualified' })], { 'story-scoring': qualified(9, 'not-qualified') }));
  // Published a week ago: outside every night's window.
  stories.push(story('old', [item({ family: 'feeds', seen: '2026-11-02T07:00:00Z', headline: 'Old one' })], { 'story-scoring': qualified(9) }));
  const asked: string[][] = [];
  const lanes = await intakeLanes(Q, W, NOW, JEV, {
    listStories: async (_q, input: ListStoriesInput) => {
      assert.ok(input.since.getTime() <= Date.parse('2026-11-05T08:00:00Z'), 'one read reaches back to the oldest night window');
      return stories;
    },
    readCarouselPosted: async () => ['Story number 1 lands'],
    postedCheck: async (batch) => {
      asked.push(batch.map((s) => s.id));
      return new Set(batch.filter((s) => s.id === 'q1').map((s) => s.id));
    },
  });
  const ids = lanes.carousel.map((c) => c.refs[0]);
  assert.deepEqual(ids, ['q0', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10']);
  assert.ok(lanes.carousel.every((c) => c.origin === 'carousel'));
  assert.deepEqual(asked.map((b) => b.length), [10, 4], 'a second batch only because the first lost one to posted');
  assert.ok(!asked.flat().includes('nq'), 'not-qualified stories are never posted-checked');
});

test('carousel lane: each night contributes its own top 10, newest night first; a story in two nights appears for each', async () => {
  const mk = (id: string, at: string, p: number) => story(id, [item({ family: 'feeds', seen: at, headline: `Headline for ${id}` })], { 'story-scoring': qualified(p) });
  const stories = [mk('mon', '2026-11-09T06:00:00Z', 3), mk('sat', '2026-11-07T06:00:00Z', 4)];
  const lanes = await intakeLanes(Q, W, NOW, JEV, { listStories: async () => stories, readCarouselPosted: async () => [], postedCheck: async () => new Set() });
  // Saturday 06:00Z falls in both Saturday's and Sunday's 36 h weekend windows, as two legacy shortlists would hold it.
  assert.deepEqual(lanes.carousel.map((c) => c.refs[0]), ['mon', 'sat', 'sat']);
});

test('feed lane: feed stories since the last settled cut (at most 48 h), newest first, limit 20; dropped items never count', () => {
  const stories: ScoredStory[] = [];
  for (let i = 0; i < 25; i++) stories.push(story(`f${i}`, [item({ family: 'feeds', seen: new Date(Date.parse('2026-11-10T08:00:00Z') - i * 30 * 60_000).toISOString() })]));
  stories.push(story('before-cut', [item({ family: 'feeds', seen: '2026-11-09T07:59:00Z' })]));
  stories.push(story('dropped', [item({ family: 'feeds', seen: '2026-11-10T08:01:00Z', dropReason: 'too-short' })]));
  stories.push(story('reels-only', [item({ family: 'reels', seen: '2026-11-10T08:02:00Z' })]));
  const lane = feedLaneOf(stories, NOW);
  assert.equal(lane.length, 20);
  assert.deepEqual(lane.slice(0, 3).map((c) => c.refs[0]), ['f0', 'f1', 'f2']);
  assert.ok(lane.every((c) => c.origin === 'feed'));
  assert.ok(!lane.some((c) => ['before-cut', 'dropped', 'reels-only'].includes(c.refs[0]!)));
});

test('feed lane: the 48 h floor holds when the last cut is older', () => {
  const sunday = new Date('2026-11-10T20:00:00Z');
  const s = [story('old', [item({ family: 'feeds', seen: '2026-11-08T19:00:00Z' })]), story('new', [item({ family: 'feeds', seen: '2026-11-10T19:00:00Z' })])];
  assert.deepEqual(feedLaneOf(s, sunday).map((c) => c.refs[0]), ['new']);
});
