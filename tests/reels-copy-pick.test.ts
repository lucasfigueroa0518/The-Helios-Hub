/**
 * Offline tests for the on-screen copy pick (D-195). No model calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { buildCopyVariants, rankCopyLines, type CopyLineScore } from '@/lib/reels/copy/pick';
import type { CopyCall } from '@/lib/reels/copy/report';
import { scoreCopyLine } from '@/lib/reels/copy/score';
import { COPY_PICK, copyPickState } from '@/lib/reels/jev/questions/copy-pick';
import type { JevRequest, JevRunner } from '@/lib/reels/jev/runner';

function scores(plain: number, loop: number, care: number, reward: number): CopyLineScore {
  return { plain, loop, care, reward };
}

function call(caption: string, first: string, second: string): CopyCall {
  return {
    onScreenCopies: [first, second],
    caption,
    callToAction: 'Save this.',
    hashtags: ['#AI'],
    sources: [],
    working: { hookDrafts: [], copyDraft: '', captionDraft: '', remainingPatterns: [] },
  };
}

test('a line under the comprehension gate loses to one that clears it', () => {
  const { winner } = rankCopyLines([
    scores(2, 4, 4, 4),
    scores(3, 0, 0, 0),
  ]);
  assert.equal(winner, 1);
});

test('when every line is under the gate, the clearest one ships', () => {
  const { winner, ranked } = rankCopyLines([
    scores(1, 4, 4, 4),
    scores(2, 0, 0, 0),
  ]);
  assert.equal(ranked.every((line) => !line.eligible), true);
  assert.equal(winner, 1);
});

test('ties break on comprehension, then reward, then earlier line', () => {
  const clearer = rankCopyLines([
    scores(3, 2, 2, 2),
    scores(4, 2, 2, 2),
  ]);
  assert.equal(clearer.winner, 1);

  const richer = rankCopyLines([
    scores(4, 4, 2, 0),
    scores(4, 2, 2, 2),
  ]);
  assert.equal(richer.ranked[0].performance, richer.ranked[1].performance);
  assert.equal(richer.winner, 1);

  const earlier = rankCopyLines([
    scores(4, 2, 2, 2),
    scores(4, 2, 2, 2),
  ]);
  assert.equal(earlier.winner, 0);
});

test('an empty slate cannot be ranked', () => {
  assert.throws(() => rankCopyLines([]), /at least one/);
});

test('the winning line keeps the caption from the call that wrote it', () => {
  const first = call('Caption A', 'Line A1', 'Line A2');
  const second = call('Caption B', 'Line B1', 'Line B2');
  const { winner, variants } = buildCopyVariants(
    [
      { call: first, error: null },
      { call: second, error: null },
    ],
    [scores(4, 1, 1, 1), scores(4, 1, 1, 1), scores(4, 4, 4, 4), scores(4, 1, 1, 1)],
  );
  assert.equal(variants.complete, true);
  assert.equal(variants.winnerIndex, 2);
  assert.equal(winner?.onScreenCopy, 'Line B1');
  assert.equal(winner?.call.caption, 'Caption B');
  assert.equal(variants.lines.filter((line) => line.winner).length, 1);
});

test('one failed call is an incomplete pick among the lines that came back', () => {
  const { winner, variants } = buildCopyVariants(
    [
      { call: null, error: 'Copy request failed: overloaded' },
      { call: call('Caption B', 'Line B1', 'Line B2'), error: null },
    ],
    [scores(2, 0, 0, 0), scores(4, 3, 3, 3)],
  );
  assert.equal(variants.complete, false);
  assert.equal(variants.lines.length, 2);
  assert.equal(winner?.onScreenCopy, 'Line B2');
  assert.equal(winner?.call.caption, 'Caption B');
});

test('Jev scores one line from the on-screen text alone', async () => {
  const seen: JevRequest<Questions>[] = [];
  const stub: JevRunner = {
    callCount: 0,
    async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
      seen.push(request as JevRequest<Questions>);
      return {
        model: 'jev-test',
        answers: {
          plain: { type: 'score', score: 3, confidence: 0.8, probabilities: {}, legend: {} },
          loop: { type: 'score', score: 2, confidence: 0.7, probabilities: {}, legend: {} },
          care: { type: 'score', score: 4, confidence: 0.9, probabilities: {}, legend: {} },
          reward: { type: 'score', score: 1, confidence: 0.6, probabilities: {}, legend: {} },
        },
        usage: { input_tokens: 80, output_tokens: 10 },
      } as unknown as SystemOneResult<Q>;
    },
  };
  const scored = await scoreCopyLine(stub, {
    onScreenCopy: '  Google shut the API overnight.  ',
    postIdeaId: 'idea-1',
    runId: 'run-1',
  });
  assert.deepEqual(scored, { plain: 3, loop: 2, care: 4, reward: 1 });
  assert.deepEqual(seen[0]?.state, copyPickState('Google shut the API overnight.'));
  assert.deepEqual(Object.keys(seen[0]?.state ?? {}), ['on_screen_copy']);
  assert.deepEqual(seen[0]?.sets, [COPY_PICK]);
  assert.deepEqual(Object.keys(COPY_PICK.questions), ['plain', 'loop', 'care', 'reward']);
  assert.equal(COPY_PICK.version, 'copy-pick-v1');
  assert.equal(seen[0]?.postIdeaId, 'idea-1');
  assert.equal(seen[0]?.runId, 'run-1');
});
