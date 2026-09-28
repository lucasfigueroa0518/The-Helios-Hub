import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseRankedClaim,
  claimWaitsForBetterIdea,
  compareIdeaRank,
  ideaRankOrderBy,
  type RankedClaim,
  type SlateSongGate,
} from '@/lib/reels/pipeline/order';

const slate = 'slate-1';

function claim(partial: Partial<RankedClaim> & Pick<RankedClaim, 'id' | 'rank'>): RankedClaim {
  return {
    slateId: slate,
    requestedAt: '2026-09-28T05:00:00.000Z',
    ...partial,
  };
}

function gate(partial: Partial<SlateSongGate> & Pick<SlateSongGate, 'rank'>): SlateSongGate {
  return {
    slateId: slate,
    selected: true,
    hasSongForAssignment: false,
    stillInPipeline: true,
    ...partial,
  };
}

test('rank 1 sorts ahead of a worse idea and a missing rank', () => {
  assert.ok(compareIdeaRank(1, 3) < 0);
  assert.ok(compareIdeaRank(null, 1) > 0);
  assert.equal(compareIdeaRank(2, 2), 0);
});

test('the best idea is claimed before an earlier worse idea', () => {
  const ideas = [gate({ rank: 1 }), gate({ rank: 3 })];
  const chosen = chooseRankedClaim(
    [
      claim({ id: 'worse', rank: 3, requestedAt: '2026-09-28T04:00:00.000Z' }),
      claim({ id: 'best', rank: 1, requestedAt: '2026-09-28T05:00:00.000Z' }),
    ],
    ideas,
  );
  assert.equal(chosen, 'best');
});

test('a worse idea waits while a better selected idea is still being made', () => {
  const ideas = [gate({ rank: 1 }), gate({ rank: 2 })];
  const worse = claim({ id: 'worse', rank: 2 });
  assert.equal(claimWaitsForBetterIdea(worse, ideas), true);
  assert.equal(chooseRankedClaim([worse], ideas), null);
});

test('a worse idea proceeds once the better idea has a song for this assigned day', () => {
  const ideas = [gate({ rank: 1, hasSongForAssignment: true, stillInPipeline: true }), gate({ rank: 2 })];
  assert.equal(chooseRankedClaim([claim({ id: 'worse', rank: 2 })], ideas), 'worse');
});

test('a worse idea proceeds when the better idea has dropped out of the run', () => {
  const ideas = [gate({ rank: 1, stillInPipeline: false }), gate({ rank: 2 })];
  assert.equal(chooseRankedClaim([claim({ id: 'worse', rank: 2 })], ideas), 'worse');
});

test('an idea does not wait for itself or for a better idea that was not selected', () => {
  const self = [gate({ rank: 2 })];
  assert.equal(claimWaitsForBetterIdea(claim({ id: 'same', rank: 2 }), self), false);
  const unselected = [gate({ rank: 1, selected: false }), gate({ rank: 2 })];
  assert.equal(chooseRankedClaim([claim({ id: 'second', rank: 2 })], unselected), 'second');
});

test('ideas on another slate do not hold this one', () => {
  const ideas = [gate({ rank: 1, slateId: 'other-slate' }), gate({ rank: 2 })];
  assert.equal(chooseRankedClaim([claim({ id: 'second', rank: 2 })], ideas), 'second');
});

test('an unranked job waits for a ranked idea still being made on the same slate', () => {
  const ideas = [gate({ rank: 1 })];
  assert.equal(chooseRankedClaim([claim({ id: 'loose', rank: null })], ideas), null);
  assert.equal(
    chooseRankedClaim([claim({ id: 'loose', rank: null, slateId: 'other' })], ideas),
    'loose',
  );
});

test('equal ranks keep the earlier request', () => {
  const ideas = [gate({ rank: 1, hasSongForAssignment: true, stillInPipeline: false })];
  const chosen = chooseRankedClaim(
    [
      claim({ id: 'later', rank: 1, requestedAt: '2026-09-28T06:00:00.000Z' }),
      claim({ id: 'earlier', rank: 1, requestedAt: '2026-09-28T05:00:00.000Z' }),
    ],
    ideas,
  );
  assert.equal(chosen, 'earlier');
});

test('finish requests are ordered by idea rank', () => {
  const order = ideaRankOrderBy('f');
  assert.match(order, /s\.rank/);
  assert.match(order, /ASC NULLS LAST, f\.requested_at/);
  assert.throws(() => ideaRankOrderBy('f;drop'), /Bad job alias/);
});
