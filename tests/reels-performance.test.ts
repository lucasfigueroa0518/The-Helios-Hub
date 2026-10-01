/**
 * Performance rollups and the insights payload reader. No database and no Graph.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHeadlines,
  creationFacts,
  factorGroups,
  gridNote,
  parseMotionFactors,
  sortReels,
  withHistory,
  type PerformanceReel,
  type PerformanceSnapshot,
} from '@/lib/reels/analytics/performance';
import { createInsightsClient, InsightsPermissionError } from '@/lib/reels/media-insights/client';
import {
  graphErrorIsPermission,
  graphErrorIsToken,
  normalizeSkipRate,
  readingHasSignal,
  readInsightData,
  type ReelInsightReading,
} from '@/lib/reels/media-insights/parse';
import { resolveSlot, slotForInstant } from '@/lib/reels/publish/slots';
import { zonedTime } from '@/lib/reels/schedule';

function snap(patch: Partial<PerformanceSnapshot> = {}): PerformanceSnapshot {
  return {
    nyDate: '2026-09-30',
    views: null,
    reach: null,
    likes: null,
    comments: null,
    saved: null,
    shares: null,
    reposts: null,
    totalInteractions: null,
    avgWatchTimeMs: null,
    totalWatchTimeMs: null,
    skipRate: null,
    sharedToFeed: null,
    ...patch,
  };
}

function reel(
  id: string,
  patch: Partial<Omit<PerformanceReel, 'metrics' | 'history'>> = {},
  snapshots: PerformanceSnapshot[] = [],
): PerformanceReel {
  return withHistory(
    {
      attemptId: id,
      mediaId: id,
      postIdeaId: id,
      videoJobId: null,
      finishedAt: '2026-09-30T14:00:00.000Z',
      permalink: null,
      title: id,
      subtitle: null,
      onScreenCopy: null,
      caption: null,
      songTitle: null,
      songArtist: null,
      genre: null,
      audioType: null,
      slot: 'morning',
      slotLabel: 'Morning',
      framework: null,
      bucket: null,
      blockbuster: false,
      net: null,
      origin: null,
      color: null,
      hook: null,
      hookSound: null,
      fullStory: null,
      graduationStrategy: 'MANUAL',
      ...patch,
    },
    snapshots,
  );
}

test('a blank stays out of the total and a zero stays in', () => {
  const headlines = buildHeadlines([
    reel('blank', {}, [snap()]),
    reel('zero', {}, [snap({ views: 0, skipRate: 0 })]),
    reel('four', {}, [snap({ views: 4, skipRate: 0.5 })]),
  ]);
  const views = headlines.find((stat) => stat.id === 'views');
  const skip = headlines.find((stat) => stat.id === 'skip');
  assert.equal(views?.value, 4);
  assert.equal(views?.reported, 2);
  assert.equal(skip?.value, 0.25);
  assert.equal(skip?.reported, 2);
});

test('no reported numbers stay blank instead of becoming zero', () => {
  const views = buildHeadlines([reel('a'), reel('b')]).find((stat) => stat.id === 'views');
  assert.equal(views?.value, null);
  assert.equal(views?.reported, 0);
});

test('graduate sort leads with shares, then saves, then views, and leaves blanks last', () => {
  const order = sortReels([
    reel('none', {}, [snap()]),
    reel('zero', {}, [snap({ shares: 0, saved: 9, views: 100 })]),
    reel('high-saves', {}, [snap({ shares: 5, saved: 1, views: 10 })]),
    reel('high-shares', {}, [snap({ shares: 5, saved: 3, views: 1 })]),
    reel('views', {}, [snap({ shares: 1, saved: 0, views: 50 })]),
  ], 'graduate').map((item) => item.attemptId);
  assert.deepEqual(order, ['high-shares', 'high-saves', 'views', 'zero', 'none']);
});

test('hook sort leads with the lower skip rate, then the longer watch', () => {
  const order = sortReels([
    reel('short', {}, [snap({ skipRate: 0.2, avgWatchTimeMs: 1000 })]),
    reel('long', {}, [snap({ skipRate: 0.2, avgWatchTimeMs: 5000 })]),
    reel('skippy', {}, [snap({ skipRate: 0.8, avgWatchTimeMs: 9000 })]),
    reel('blank', {}, [snap()]),
  ], 'hook').map((item) => item.attemptId);
  assert.deepEqual(order, ['long', 'short', 'skippy', 'blank']);
});

test('the latest snapshot is the one the totals use', () => {
  const item = reel('a', {}, [
    snap({ nyDate: '2026-09-30', views: 3 }),
    snap({ nyDate: '2026-09-28', views: 80 }),
  ]);
  assert.equal(item.metrics?.views, 3);
  assert.equal(item.history[0]?.nyDate, '2026-09-28');
});

test('factor averages ignore blanks, mark a group under 3 as thin, and sort by shares', () => {
  const groups = factorGroups([
    reel('c1', { framework: 'curiosity' }, [snap({ shares: 2, views: 10 })]),
    reel('c2', { framework: 'curiosity' }, [snap({ shares: 4, views: null })]),
    reel('c3', { framework: 'curiosity' }, [snap({ shares: 6, views: 30 })]),
    reel('a1', { framework: 'arousal' }, [snap({ shares: 10, views: 5 })]),
  ], 'psychology');
  assert.equal(groups[0]?.label, 'Arousal');
  assert.equal(groups[0]?.thin, true);
  assert.equal(groups[0]?.shares, 10);
  assert.equal(groups[1]?.label, 'Curiosity');
  assert.equal(groups[1]?.thin, false);
  assert.equal(groups[1]?.shares, 4);
  assert.equal(groups[1]?.views, 20);
});

test('score groups split at the median of the published reels', () => {
  const groups = factorGroups([
    reel('low', { net: 0.2 }, [snap({ shares: 1 })]),
    reel('mid', { net: 0.4 }, [snap({ shares: 1 })]),
    reel('high', { net: 0.8 }, [snap({ shares: 3 })]),
    reel('higher', { net: 0.9 }, [snap({ shares: 3 })]),
  ], 'score');
  const above = groups.find((group) => group.key === 'above');
  const below = groups.find((group) => group.key === 'below');
  assert.equal(above?.count, 2);
  assert.equal(below?.count, 2);
  assert.equal(above?.thin, true);
});

test('blockbuster is the bonus, and a missing score stays unknown', () => {
  const groups = factorGroups([
    reel('hit', { blockbuster: true }),
    reel('miss', { blockbuster: false }),
    reel('unknown', { blockbuster: null }),
  ], 'blockbuster');
  assert.deepEqual(groups.map((group) => group.key).sort(), ['no', 'unknown', 'yes']);
});

test('motion record lines become the hook and the sound flag', () => {
  const withSound = parseMotionFactors('Hook: glitch\nHook timing: early\nHook SFX: glitch.wav\nMotion: v1, green');
  assert.deepEqual(withSound, { hook: 'glitch', hookSound: true });
  const silent = parseMotionFactors('Hook: none\nHook SFX: none');
  assert.deepEqual(silent, { hook: 'none', hookSound: false });
  assert.deepEqual(parseMotionFactors(null), { hook: null, hookSound: null });
});

test('creation facts use the names the scoring page uses', () => {
  const facts = creationFacts(reel('a', {
    framework: 'curiosity',
    bucket: 'the_number',
    blockbuster: true,
    net: 0.82,
    graduationStrategy: 'MANUAL',
  }));
  assert.equal(facts.find((fact) => fact.label === 'Psychology')?.value, 'Curiosity');
  assert.equal(facts.find((fact) => fact.label === 'Content bucket')?.value, 'The Number');
  assert.equal(facts.find((fact) => fact.label === 'Blockbuster')?.value, 'Blockbuster');
  assert.equal(facts.find((fact) => fact.label === 'Net score')?.value, '0.82');
  assert.match(facts.find((fact) => fact.label === 'Graduation')?.value ?? '', /Instagram app/);
});

test('grid copy follows whether Instagram has shared the reel', () => {
  assert.match(gridNote(true), /on the grid/);
  assert.match(gridNote(false), /Instagram app/);
  assert.match(gridNote(null), /Instagram app/);
});

test('a stored slot wins, and the clock places a reel with no schedule row', () => {
  const morning = zonedTime(2026, 9, 30, 9, 0);
  const afternoon = zonedTime(2026, 9, 30, 15, 0);
  const evening = zonedTime(2026, 9, 30, 19, 0);
  assert.equal(slotForInstant(morning), 'morning');
  assert.equal(slotForInstant(afternoon), 'unscheduled');
  assert.equal(slotForInstant(evening), 'evening');
  assert.equal(resolveSlot('evening', morning), 'evening');
  assert.equal(resolveSlot(null, afternoon), 'unscheduled');
});

test('skip rate accepts a fraction or a percent, and a permissions error is not a missing metric', () => {
  assert.equal(normalizeSkipRate(0.42), 0.42);
  assert.equal(normalizeSkipRate(42), 0.42);
  assert.equal(normalizeSkipRate(140), null);
  const body = readInsightData({
    data: [{ name: 'views', values: [{ value: 8 }] }, { name: 'reels_skip_rate', values: [{ value: 42 }] }],
  });
  assert.equal(body.views, 8);
  assert.equal(body.reels_skip_rate, 0.42);
  assert.equal(graphErrorIsPermission(400, 100, 'reels_skip_rate is not available'), false);
  assert.equal(graphErrorIsPermission(400, 10, 'Application does not have permission'), true);
  assert.equal(graphErrorIsToken(190, 'Error validating access token'), true);
  const empty: ReelInsightReading = {
    views: null, reach: null, likes: null, comments: null, saved: null, shares: null,
    reposts: null, totalInteractions: null, avgWatchTimeMs: null, totalWatchTimeMs: null,
    skipRate: null, sharedToFeed: null, raw: {},
  };
  assert.equal(readingHasSignal(empty), false);
  assert.equal(readingHasSignal({ ...empty, views: 0 }), true);
});

test('an unavailable metric is left blank and the rest of the payload is kept', async () => {
  const token = 'secret-token-value';
  const client = createInsightsClient({
    token,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('access_token'), token);
      if (url.searchParams.has('fields')) {
        return Response.json({ is_shared_to_feed: false });
      }
      const metric = url.searchParams.get('metric') ?? '';
      if (metric.includes('reels_skip_rate') && metric.includes(',')) {
        return Response.json(
          { error: { message: '(#100) reels_skip_rate is not available for this media', code: 100 } },
          { status: 400 },
        );
      }
      const names = metric.split(',').filter(Boolean);
      return Response.json({
        data: names.map((name) => ({ name, values: [{ value: name === 'views' ? 12 : 1 }] })),
      });
    },
  });
  const reading = await client.reelInsights('1789');
  assert.equal(reading.views, 12);
  assert.equal(reading.reach, 1);
  assert.equal(reading.skipRate, null);
  assert.equal(reading.sharedToFeed, false);
});

test('a permissions failure names the missing scope and leaves the token out', async () => {
  const token = 'secret-token-value';
  const client = createInsightsClient({
    token,
    fetchImpl: async () => Response.json(
      { error: { message: '(#10) Application does not have permission for this action', code: 10 } },
      { status: 400 },
    ),
  });
  await assert.rejects(() => client.reelInsights('1789'), (error: unknown) => {
    assert.ok(error instanceof InsightsPermissionError);
    assert.equal(error.message.includes(token), false);
    assert.match(error.message, /permission/i);
    return true;
  });
});
