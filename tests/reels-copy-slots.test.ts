/**
 * Offline tests for a generation that fills passing reels (D-224). No model
 * calls and no database: the attempt is a stub.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { latestSonnetModelId } from '@/lib/reels/copy/model';
import {
  COPY_GATE_DAY_PENALTY,
  dayPenalty,
  fillSlots,
  inKnowledgeLane,
  orderedForSlots,
  type GradedLine,
  type SlotIdea,
} from '@/lib/reels/copy/slots';
import type { BucketId, FrameworkId } from '@/lib/reels/scoring/decide';

function idea(
  id: string,
  net: number,
  framework?: FrameworkId,
  bucket?: BucketId,
): SlotIdea {
  return { id, net, bucketScore: 1, psychologyScore: 1, lastJoinedMs: 0, confidence: 1, framework, bucket };
}

/** Raw Jev levels, 0 to 4. rankCopyLines divides by 4. */
function line(ideaId: string, plain: number, stake: number): GradedLine {
  return {
    ideaId,
    lineIndex: 0,
    plain,
    stake,
    loop: 2,
    care: 2,
    reward: 2,
    sameStory: 0.9,
    inRange: true,
  };
}

test('the latest Sonnet is the highest release, and a dated snapshot is not a release', () => {
  assert.equal(
    latestSonnetModelId(['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-sonnet-4-6']),
    'claude-sonnet-5-5',
  );
  assert.equal(latestSonnetModelId(['claude-sonnet-5-5-20260929', 'claude-haiku-4-5']), null);
  assert.equal(latestSonnetModelId([]), null);
});

test('a day penalty is at least one scoring component and drops the idea under this pool', () => {
  assert.equal(dayPenalty(2.6, [2.5, 2.46, 2.43]), COPY_GATE_DAY_PENALTY);
  assert.equal(dayPenalty(2.6, [0.2]), 2.41);
  assert.equal(dayPenalty(2.6, []), COPY_GATE_DAY_PENALTY);

  const ideas = [idea('a', 2.6), idea('b', 2.5), idea('c', 2.46), idea('d', 2.43), idea('e', 2.4)];
  const penalties = new Map<string, number>([['a', dayPenalty(2.6, [2.5, 2.46, 2.43])]]);
  const order = orderedForSlots(ideas, (id) => penalties.get(id) ?? 0).map((row) => row.id);
  assert.deepEqual(order.slice(0, 4), ['b', 'c', 'd', 'e']);
  assert.equal(ideas[0].net, 2.6);
});

test('a lock outside the lane still leaves the reserved slot for the knowledge idea', async () => {
  const ideas = [
    idea('locked', 5, 'arousal', 'the_saga'),
    idea('saga', 4, 'arousal', 'the_saga'),
    idea('know', 1, 'identity', 'ball_knowledge'),
  ];
  const tried: string[] = [];
  const filled = await fillSlots({
    ideas,
    locks: [{ slot: 1, postIdeaId: 'locked' }],
    count: 2,
    penalties: new Map(),
    attempt: async (row) => {
      tried.push(row.id);
      return { passed: false, judged: true, lines: [line(row.id, 2, 2)] };
    },
    onPenalty: () => {},
    onFallback: () => {},
  });
  assert.deepEqual(tried, ['know']);
  assert.deepEqual(filled, [
    { slot: 1, postIdeaId: 'locked', passed: true, locked: true },
    { slot: 2, postIdeaId: 'know', passed: false, locked: false },
  ]);
});

test('a lock already in the lane counts as the reserved reel', async () => {
  const ideas = [
    idea('know', 1, 'curiosity', 'ball_knowledge'),
    idea('saga', 4, 'arousal', 'the_saga'),
  ];
  const tried: string[] = [];
  const filled = await fillSlots({
    ideas,
    locks: [{ slot: 1, postIdeaId: 'know' }],
    count: 2,
    penalties: new Map(),
    attempt: async (row, rewrite) => {
      tried.push(`${row.id}:${rewrite}`);
      return { passed: true, judged: true, lines: [line(row.id, 4, 4)] };
    },
    onPenalty: () => {},
    onFallback: () => {},
  });
  assert.deepEqual(tried, ['saga:true']);
  assert.deepEqual(filled, [
    { slot: 1, postIdeaId: 'know', passed: true, locked: true },
    { slot: 2, postIdeaId: 'saga', passed: true, locked: false },
  ]);
});

test('the knowledge idea ships on a miss even when its net is below the sagas', async () => {
  const ideas = [
    idea('saga-a', 5, 'arousal', 'the_saga'),
    idea('curious-saga', 4.8, 'curiosity', 'the_saga'),
    idea('saga-b', 4, 'arousal', 'the_saga'),
    idea('drama', 3.5, 'identity', 'personal_profile'),
    idea('know', 1, 'identity', 'ball_knowledge'),
  ];
  const tried: string[] = [];
  const filled = await fillSlots({
    ideas,
    locks: [],
    count: 3,
    penalties: new Map(),
    attempt: async (row, rewrite) => {
      tried.push(`${row.id}:${rewrite}`);
      const passed = row.id !== 'know';
      return { passed, judged: true, lines: [line(row.id, passed ? 4 : 2, passed ? 4 : 2)] };
    },
    onPenalty: () => {},
    onFallback: () => {},
  });
  assert.deepEqual(tried, ['know:true', 'saga-a:true', 'curious-saga:true']);
  assert.deepEqual(filled, [
    { slot: 1, postIdeaId: 'know', passed: false, locked: false },
    { slot: 2, postIdeaId: 'saga-a', passed: true, locked: false },
    { slot: 3, postIdeaId: 'curious-saga', passed: true, locked: false },
  ]);
});

test('four general misses still produce a second reel, and a fifth idea is not tried', async () => {
  const ideas = [
    idea('know', 1, 'curiosity', 'the_number'),
    ...['a', 'b', 'c', 'd', 'e'].map((id, index) => idea(id, 5 - index, 'arousal', 'the_saga')),
  ];
  const tried: string[] = [];
  const rewrites: boolean[] = [];
  let fallback: string | null = null;
  const scores: Record<string, [number, number]> = {
    know: [4, 4],
    a: [1.6, 1.6],
    b: [4, 1],
    c: [1, 4],
    d: [2.8, 2.6],
    e: [4, 4],
  };
  const filled = await fillSlots({
    ideas,
    locks: [],
    count: 3,
    penalties: new Map(),
    attempt: async (row, rewrite) => {
      tried.push(row.id);
      rewrites.push(rewrite);
      const [plain, stake] = scores[row.id];
      return { passed: row.id === 'know', judged: true, lines: [line(row.id, plain, stake)] };
    },
    onPenalty: () => {},
    onFallback: (row) => {
      fallback = row.id;
    },
  });
  assert.deepEqual(tried, ['know', 'a', 'b', 'c', 'd']);
  assert.deepEqual(rewrites, [true, true, false, false, false]);
  assert.equal(fallback, 'd');
  assert.deepEqual(filled, [
    { slot: 1, postIdeaId: 'know', passed: true, locked: false },
    { slot: 2, postIdeaId: 'd', passed: false, locked: false },
  ]);
});

test('the knowledge lane is Ball Knowledge, or The Number when curiosity won', () => {
  assert.equal(inKnowledgeLane({ framework: 'curiosity', bucket: 'ball_knowledge' }), true);
  assert.equal(inKnowledgeLane({ framework: 'identity', bucket: 'ball_knowledge' }), true);
  assert.equal(inKnowledgeLane({ framework: 'curiosity', bucket: 'the_number' }), true);
  assert.equal(inKnowledgeLane({ framework: 'identity', bucket: 'the_number' }), false);
  assert.equal(inKnowledgeLane({ framework: 'curiosity', bucket: 'the_saga' }), false);
  assert.equal(inKnowledgeLane({ framework: 'curiosity', bucket: 'the_warning' }), false);
  assert.equal(inKnowledgeLane({ framework: 'identity', bucket: 'personal_profile' }), false);
  assert.equal(inKnowledgeLane({ framework: 'arousal', bucket: 'the_saga' }), false);
});

test('a writer failure draws no penalty and the next idea in that slot still tries', async () => {
  const penalties = new Map<string, number>();
  const tried: string[] = [];
  await fillSlots({
    ideas: [idea('a', 2), idea('b', 1)],
    locks: [],
    count: 1,
    penalties,
    attempt: async (row) => {
      tried.push(row.id);
      if (row.id === 'a') return { passed: false, judged: false, lines: [] };
      return { passed: true, judged: true, lines: [line(row.id, 4, 4)] };
    },
    onPenalty: (row, penalty) => {
      penalties.set(row.id, penalty);
    },
    onFallback: () => {
      throw new Error('the second idea passes');
    },
  });
  assert.deepEqual(tried, ['a', 'b']);
  assert.equal(penalties.size, 0);
});

test('each later slot opens with a rewrite of its own', async () => {
  const rewrites: Array<[string, boolean]> = [];
  await fillSlots({
    ideas: [idea('a', 2), idea('b', 1)],
    locks: [],
    count: 2,
    penalties: new Map(),
    attempt: async (row, rewrite) => {
      rewrites.push([row.id, rewrite]);
      return { passed: true, judged: true, lines: [line(row.id, 4, 4)] };
    },
    onPenalty: () => {},
    onFallback: () => {},
  });
  assert.deepEqual(rewrites, [
    ['a', true],
    ['b', true],
  ]);
});
