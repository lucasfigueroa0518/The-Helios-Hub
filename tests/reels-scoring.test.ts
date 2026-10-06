/**
 * Offline tests for the scoring rules. No Jev calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLOCKBUSTER_BONUS,
  CARRYOVER_TWO_DAY_DEPTH,
  CARRYOVER_WINDOW,
  SCORE_TOP_LEVEL,
} from '@/lib/reels/config';
import { SCORING_PASS_1 } from '@/lib/reels/jev/questions/scoring-pass1';
import { SCORING_PASS_2 } from '@/lib/reels/jev/questions/scoring-pass2';
import { BUCKETS } from '@/lib/reels/jev/questions/scoring-shared';
import {
  applyPass2,
  interpretPass1,
  type Pass1Answers,
} from '@/lib/reels/scoring/interpret';
import { buildPass1State, excerptWords } from '@/lib/reels/scoring/state';
import {
  blockbusterBonus,
  boostedEntertainment,
  candidateOrigins,
  carryoverMisses,
  heldFromCarryover,
  earlierNyDateKey,
  isPreviousNyDay,
  isSameNyDay,
  netScore,
  tieredBlockbuster,
  normalizeJevScore,
  openBuckets,
  pickBucket,
  previousNyDateKey,
  psychologyTerm,
  rankForSlate,
  selectTopThree,
  survivingFrameworks,
  valueTerm,
  winningFramework,
  type BucketJudgment,
  type FrameworkScores,
  type RankedIdea,
} from '@/lib/reels/scoring/decide';

const scores = (curiosity: number, arousal: number, identity: number): FrameworkScores => ({
  curiosity,
  arousal,
  identity,
});

function idea(partial: Partial<RankedIdea> & Pick<RankedIdea, 'id' | 'net'>): RankedIdea {
  return {
    bucketScore: 0.5,
    psychologyScore: 0.5,
    lastJoinedMs: 0,
    confidence: 0.9,
    ...partial,
  };
}

test('normalizeJevScore maps the five-level rubric onto 0–1', () => {
  assert.equal(normalizeJevScore(0), 0);
  assert.equal(normalizeJevScore(2), 0.5);
  assert.equal(normalizeJevScore(2.4), 0.6);
  assert.equal(normalizeJevScore(3), 0.75);
  assert.equal(normalizeJevScore(4), 1);
  assert.equal(normalizeJevScore(-1), 0);
  assert.equal(normalizeJevScore(9), 1);
});

test('a framework survives at 0.60 and drops when it trails the leader by 0.25', () => {
  assert.deepEqual(survivingFrameworks(scores(0.6, 0.59, 0.1)), ['curiosity']);
  // 0.90, 0.70, 0.62 keeps the first two. 0.62 trails by more than 0.25.
  assert.deepEqual(survivingFrameworks(scores(0.9, 0.7, 0.62)), ['curiosity', 'arousal']);
  // A gap of exactly 0.25 drops the lower score.
  assert.deepEqual(survivingFrameworks(scores(0.9, 0.65, 0.4)), ['curiosity']);
  assert.deepEqual(survivingFrameworks(scores(0.59, 0.4, 0.2)), []);
});

test('a surviving framework opens every bucket that lists it', () => {
  assert.deepEqual(openBuckets(['identity']), [
    'ball_knowledge',
    'personal_profile',
    'the_callout',
  ]);
  assert.deepEqual(openBuckets(['curiosity']), [
    'ball_knowledge',
    'the_number',
    'the_saga',
    'personal_profile',
    'the_warning',
  ]);
  assert.deepEqual(openBuckets(['curiosity', 'arousal', 'identity']), [
    'ball_knowledge',
    'the_number',
    'the_saga',
    'personal_profile',
    'the_warning',
    'the_callout',
  ]);
});

test('the psychology term is the higher surviving framework the bucket lists', () => {
  const both = survivingFrameworks(scores(0.7, 0.5, 0.85));
  assert.equal(psychologyTerm('ball_knowledge', scores(0.7, 0.5, 0.85), both), 0.85);

  // Identity trails curiosity by 0.32, so it is dropped and cannot supply the term.
  const curiosityOnly = survivingFrameworks(scores(0.92, 0.4, 0.6));
  assert.deepEqual(curiosityOnly, ['curiosity']);
  assert.equal(psychologyTerm('ball_knowledge', scores(0.92, 0.4, 0.6), curiosityOnly), 0.92);
  assert.throws(() => psychologyTerm('the_callout', scores(0.92, 0.4, 0.6), curiosityOnly));
});

test('bucket ties break by psychology, then confidence, then spec order', () => {
  const frameworkScores = scores(0.9, 0.8, 0.7);
  const surviving = survivingFrameworks(frameworkScores);
  const judgments: BucketJudgment[] = [
    { bucket: 'the_number', score: 0.8, confidence: 0.95 },
    { bucket: 'ball_knowledge', score: 0.8, confidence: 0.4 },
    { bucket: 'the_saga', score: 0.5, confidence: 0.99 },
  ];
  // Ball Knowledge's psychology term is curiosity at 0.90. The Number's is the
  // higher of arousal 0.80 and curiosity 0.90, so they tie on psychology too.
  // Confidence then prefers The Number. Spec order is not reached.
  assert.equal(pickBucket(judgments, frameworkScores, surviving), 'the_number');

  const sameConfidence: BucketJudgment[] = [
    { bucket: 'the_warning', score: 0.8, confidence: 0.5 },
    { bucket: 'ball_knowledge', score: 0.8, confidence: 0.5 },
  ];
  assert.equal(pickBucket(sameConfidence, frameworkScores, surviving), 'ball_knowledge');
  assert.equal(pickBucket([], frameworkScores, []), null);
});

test('value takes the highest of three scores and blockbuster does not stack (D-255)', () => {
  assert.equal(valueTerm(0.4, 0.7, 0.55), 0.7);
  assert.equal(blockbusterBonus({ frontierDrop: 0.8, company: 0.99, person: 0.99 }), 0.1);
  assert.equal(blockbusterBonus({ frontierDrop: 0.79, company: 0.79, person: 0.79 }), 0);
  const net = netScore({ psychology: 0.8, bucket: 0.7, value: 0.6, blockbuster: 0.1 });
  assert.ok(Math.abs(net - (0.8 + 0.35 + 1.2 + 0.1)) < 1e-9, 'half the bucket, twice the value (D-253)');
});

test('the blockbuster bonus doubles only when value clears 0.70 (D-254)', () => {
  assert.equal(tieredBlockbuster(0.1, 0.7), 0.2);
  assert.equal(tieredBlockbuster(0.1, 0.69), 0.1);
  assert.equal(tieredBlockbuster(0, 1), 0);
});

test('a known name breaks a near-tie but cannot jump a story one level better (D-217)', () => {
  assert.equal(BLOCKBUSTER_BONUS, 0.1);
  const oneLevel = 1 / SCORE_TOP_LEVEL;
  assert.ok(BLOCKBUSTER_BONUS < oneLevel / 2);
  const known = netScore({ psychology: 0.75, bucket: 0.75, value: 0.75, blockbuster: tieredBlockbuster(blockbusterBonus({ frontierDrop: 0, company: 0.95, person: 0 }), 0.75) });
  assert.ok(netScore({ psychology: 0.75 + oneLevel, bucket: 0.75, value: 0.75, blockbuster: 0 }) > known, 'one psychology level');
  assert.ok(netScore({ psychology: 0.75, bucket: 0.75, value: 0.75 + oneLevel, blockbuster: 0 }) > known, 'one value level');
  // D-253, D-254: at half weight, one bucket-fit level (0.125) no longer outweighs the 0.20 bonus.
  assert.ok(netScore({ psychology: 0.75, bucket: 0.75 + oneLevel, value: 0.75, blockbuster: 0 }) < known);
});

test('the slate is the three highest nets, and confidence does not rerank them', () => {
  const ranked = rankForSlate([
    idea({ id: 'low-confidence', net: 2.4, confidence: 0.1 }),
    idea({ id: 'no-net', net: null, confidence: 1 }),
    idea({ id: 'steady', net: 2.0, confidence: 0.99 }),
    idea({ id: 'tied-older', net: 2.4, bucketScore: 0.8, lastJoinedMs: 1, confidence: 0.99 }),
    idea({ id: 'tied-newer', net: 2.4, bucketScore: 0.8, lastJoinedMs: 2, confidence: 0.2 }),
  ]);
  // The two 2.4s with the higher bucket score lead. The newer of them wins.
  // The low-confidence 2.4 still beats the confident 2.0. The idea with no net is gone.
  assert.deepEqual(
    ranked.map((item) => item.id),
    ['tied-newer', 'tied-older', 'low-confidence', 'steady'],
  );
  assert.deepEqual(
    selectTopThree(ranked).map((item) => item.id),
    ['tied-newer', 'tied-older', 'low-confidence'],
  );
});

test('equal nets break by bucket score, then psychology, then recency', () => {
  const selected = selectTopThree([
    idea({ id: 'psych', net: 2, bucketScore: 0.5, psychologyScore: 0.9, lastJoinedMs: 1 }),
    idea({ id: 'bucket', net: 2, bucketScore: 0.8, psychologyScore: 0.2, lastJoinedMs: 1 }),
    idea({ id: 'recent', net: 2, bucketScore: 0.5, psychologyScore: 0.4, lastJoinedMs: 50 }),
    idea({ id: 'older', net: 2, bucketScore: 0.5, psychologyScore: 0.4, lastJoinedMs: 10 }),
  ]);
  assert.deepEqual(
    selected.map((item) => item.id),
    ['bucket', 'psych', 'recent'],
  );
});

test('carryover is the twenty best misses, and a tie at the cutoff is kept', () => {
  assert.equal(CARRYOVER_WINDOW, 20);
  assert.equal(CARRYOVER_TWO_DAY_DEPTH, 10);
  const yesterday = [
    idea({ id: 's1', net: 3 }),
    idea({ id: 's2', net: 2.9 }),
    idea({ id: 's3', net: 2.8 }),
    ...Array.from({ length: 19 }, (_, index) => idea({ id: `m${index}`, net: 2 - index * 0.05 })),
    idea({ id: 'cutoff-a', net: 1 }),
    idea({ id: 'cutoff-b', net: 1 }),
    idea({ id: 'below', net: 0.9 }),
    idea({ id: 'unscored', net: null }),
  ];
  const misses = carryoverMisses(yesterday, ['s1', 's2', 's3']);
  const ids = misses.map((item) => item.id);
  assert.equal(ids.includes('s1'), false);
  assert.equal(ids.includes('unscored'), false);
  assert.equal(ids.includes('below'), false);
  assert.equal(ids.includes('cutoff-a'), true);
  assert.equal(ids.includes('cutoff-b'), true);
  assert.equal(ids.includes('m0'), true);
  assert.equal(ids.length, 21);

  // An idea tied with the winners, but not selected, is a miss and comes back.
  const tied = carryoverMisses(
    [idea({ id: 'won-a', net: 2 }), idea({ id: 'won-b', net: 2 }), idea({ id: 'left-out', net: 2 })],
    ['won-a', 'won-b'],
  );
  assert.deepEqual(tied.map((item) => item.id), ['left-out']);
});

test('a miss from two days ago joins only inside the first ten (D-227)', () => {
  const yesterday = [
    idea({ id: 's1', net: 5 }),
    ...Array.from({ length: 25 }, (_, index) => idea({ id: `y${index}`, net: 4 - index * 0.1 })),
    idea({ id: 'rescored-low', net: 0.2 }),
  ];
  const twoDaysAgo = [
    idea({ id: 'old-high', net: 3.95 }),
    idea({ id: 'old-tie', net: 3.2 }),
    idea({ id: 'old-tie-b', net: 3.2 }),
    idea({ id: 'old-tenth', net: 3.05 }),
    idea({ id: 'old-low', net: 2.5 }),
    idea({ id: 'old-winner', net: 4.5 }),
    idea({ id: 'rescored-low', net: 4.5 }),
    idea({ id: 's1', net: 9 }),
    idea({ id: 'old-unscored', net: null }),
  ];
  const ids = carryoverMisses(yesterday, ['s1'], twoDaysAgo, ['old-winner']).map((item) => item.id);

  // old-high and the 3.2 tie sit in the first ten. They take seats, so the
  // yesterday misses stop at y16 instead of y19. The older 4.5 on rescored-low
  // does not replay: yesterday already scored it at 0.2.
  assert.deepEqual(ids, [
    'y0', 'old-high', 'y1', 'y2', 'y3', 'y4', 'y5', 'y6', 'y7',
    'old-tie', 'old-tie-b', 'y8', 'y9', 'y10', 'y11', 'y12', 'y13', 'y14', 'y15', 'y16',
  ]);
});

test('with no yesterday slate, ten misses from two days ago still carry', () => {
  const older = [
    ...Array.from({ length: 9 }, (_, index) => idea({ id: `d${index}`, net: 2 - index * 0.1 })),
    idea({ id: 'cutoff-a', net: 1 }),
    idea({ id: 'cutoff-b', net: 1 }),
    idea({ id: 'below', net: 0.9 }),
  ];
  const ids = carryoverMisses([], [], older, []).map((item) => item.id);
  assert.equal(ids.includes('below'), false);
  assert.equal(ids.includes('cutoff-a'), true);
  assert.equal(ids.includes('cutoff-b'), true);
  assert.equal(ids.length, 11);
});

test('a top-three reel that never posted carries, and the bench does not', () => {
  const held = heldFromCarryover([
    { id: 'posted', selected: true, rank: 1, published: true },
    { id: 'missed', selected: true, rank: 2, published: false },
    { id: 'missed-3', selected: true, rank: 3, published: false },
    { id: 'bench', selected: true, rank: 4, published: false },
    { id: 'plain-miss', selected: false, rank: 5, published: false },
  ]);
  assert.deepEqual([...held].sort(), ['bench', 'posted']);
  const misses = carryoverMisses(
    [
      idea({ id: 'posted', net: 2.6 }),
      idea({ id: 'missed', net: 2.57 }),
      idea({ id: 'missed-3', net: 2.46 }),
      idea({ id: 'bench', net: 2.41 }),
      idea({ id: 'plain-miss', net: 2.3 }),
    ],
    held,
  ).map((item) => item.id);
  assert.equal(misses.includes('posted'), false);
  assert.equal(misses.includes('bench'), false);
  assert.equal(misses.includes('missed'), true);
  assert.equal(misses.includes('missed-3'), true);
  assert.equal(misses.includes('plain-miss'), true);
});

test('an idea already on the clock is not a miss, even when it has not posted', () => {
  const held = heldFromCarryover([
    { id: 'waiting', selected: true, rank: 1, published: false, onClock: true },
    { id: 'open', selected: true, rank: 2, published: false, onClock: false },
  ]);
  assert.deepEqual(held, ['waiting']);
});

test('carryover looks at the previous New York day, not the same day or an older one', () => {
  // 05:00 UTC is 1:00 AM EDT. 15:00 UTC the same date is 11:00 AM EDT.
  const night = new Date('2026-09-22T05:00:00Z');
  const sameMorning = new Date('2026-09-22T15:00:00Z');
  const nextNight = new Date('2026-09-23T05:00:00Z');
  const twoNightsOn = new Date('2026-09-24T05:00:00Z');

  assert.equal(isSameNyDay(night, sameMorning), true);
  assert.equal(isPreviousNyDay(night, sameMorning), false);
  assert.equal(isPreviousNyDay(night, nextNight), true);
  assert.equal(isPreviousNyDay(night, twoNightsOn), false);
});

test('every scoring question uses the same five-level scale', () => {
  for (const question of Object.values(SCORING_PASS_1.questions)) {
    if (question.type !== 'score') continue;
    assert.equal(question.criteria.length, SCORE_TOP_LEVEL + 1);
  }
  for (const question of Object.values(SCORING_PASS_2.questions)) {
    assert.equal(question.type, 'score');
    if (question.type !== 'score') continue;
    assert.equal(question.criteria.length, SCORE_TOP_LEVEL + 1);
  }
  assert.equal(Object.keys(SCORING_PASS_1.questions).length, 12);
  assert.equal(Object.keys(SCORING_PASS_2.questions).length, 3);
});

test('value needs a viewer stake, and a Callout needs something the viewer chooses (D-218)', () => {
  for (const id of ['useful', 'knowledge', 'entertainment'] as const) {
    const wording = JSON.stringify(SCORING_PASS_2.questions[id]);
    assert.match(wording, /one plain sentence about the viewer's money, safety, health, work, or tools/, id);
    assert.match(wording, /A model, a benchmark, or a lab test is not a person/, id);
    assert.match(wording, /stays at Workable at most/, id);
  }
  const callout = JSON.stringify(SCORING_PASS_1.questions.theCallout);
  assert.match(callout, /the viewer chooses for themselves/);
  assert.match(callout, /what a company, a lab, or a government should do stays at Workable at most/);
  assert.match(BUCKETS.theCallout.meaning, /is a weak fit/);
});

test('scoring judges for the AI-curious viewer with a builder minority (D-206)', () => {
  assert.equal(SCORING_PASS_1.version, 'scoring-pass1-v4');
  assert.equal(SCORING_PASS_2.version, 'scoring-pass2-v4');
  const wording = JSON.stringify([SCORING_PASS_1.questions, SCORING_PASS_2.questions]);
  assert.match(wording, /curious about AI/);
  assert.match(wording, /About one in seven builds with AI/);
  assert.match(wording, /not at the top of the scale/);
  assert.doesNotMatch(wording, /developer|founder|operator|hardest-hit|one of the audiences|one of those audiences|\bpeer\b/i);
});

function pass1(overrides: Partial<Pass1Answers> = {}): Pass1Answers {
  const scored = { score: 3, confidence: 0.8 };
  const no = { noul: 0.1 };
  return {
    curiosity: scored,
    arousal: { score: 0, confidence: 0.8 },
    identity: { score: 0, confidence: 0.8 },
    ballKnowledge: scored,
    theNumber: { score: 1, confidence: 0.8 },
    theSaga: scored,
    personalProfile: { score: 1, confidence: 0.8 },
    theWarning: { score: 1, confidence: 0.8 },
    theCallout: { score: 1, confidence: 0.8 },
    frontierDrop: no,
    blueChipCompany: no,
    blueChipPerson: no,
    ...overrides,
  };
}

test('pass 1 keeps a strong curiosity fit and pass 2 adds the higher value', () => {
  const first = interpretPass1(pass1());
  assert.equal(first.chosenBucket, 'ball_knowledge');
  assert.equal(first.chosenFramework, 'curiosity');
  assert.equal(first.net, null);

  const second = applyPass2(first, {
    useful: { score: 1, confidence: 0.7 },
    knowledge: { score: 3, confidence: 0.7 },
    entertainment: { score: 2, confidence: 0.7 },
  });
  assert.equal(second.value, 0.75);
  assert.equal(second.entertainmentBoosted, false);
  assert.equal(second.ballKnowledge, undefined);
  assert.equal(second.net, 0.75 + 0.5 * 0.75 + 2 * 0.75);
});

test('D-261: no Ball Knowledge bump; a Ball Knowledge story and a Saga with the same scores tie', () => {
  const answers = {
    useful: { score: 0, confidence: 0.7 },
    knowledge: { score: 3, confidence: 0.7 },
    entertainment: { score: 1, confidence: 0.7 },
  };
  const bk = applyPass2(interpretPass1(pass1({ theSaga: { score: 1, confidence: 0.8 } })), answers);
  const saga = applyPass2(interpretPass1(pass1({ ballKnowledge: { score: 1, confidence: 0.8 } })), answers);
  assert.equal(bk.chosenBucket, 'ball_knowledge');
  assert.equal(saga.chosenBucket, 'the_saga');
  assert.equal(bk.net, saga.net);
});

test('D-261: entertainment is boosted ×1.2 when it is the highest value score', () => {
  const scored = applyPass2(interpretPass1(pass1()), {
    useful: { score: 0, confidence: 0.7 },
    knowledge: { score: 2, confidence: 0.7 },
    entertainment: { score: 2, confidence: 0.7 },
  });
  assert.equal(scored.entertainment?.score, 0.5);
  assert.equal(scored.entertainmentBoosted, true);
  assert.ok(Math.abs((scored.value ?? 0) - 0.6) < 1e-9);
});

test('D-261: entertainment above 0.70 is boosted even when another value score is higher', () => {
  assert.ok(Math.abs(boostedEntertainment(0.8, 0.9, 0.75) - 0.9) < 1e-9);
  assert.ok(Math.abs(boostedEntertainment(0.2, 0.95, 0.8) - 0.96) < 1e-9);
  assert.equal(boostedEntertainment(0.2, 0.95, 0.96 / 1.2 - 0.1), 0.96 / 1.2 - 0.1);
  assert.equal(boostedEntertainment(0.2, 0.6, 0.5), 0.5);
  assert.equal(boostedEntertainment(0.2, 0.8, 0.7), 0.7, "0.70 exactly is not over the bar");
  assert.ok(Math.abs(boostedEntertainment(1, 0.5, 1) - 1.2) < 1e-9, 'value is not capped at 1');
});

test('a total miss stores psychology and does not invent a net', () => {
  const missed = interpretPass1(
    pass1({
      curiosity: { score: 1, confidence: 0.9 },
      arousal: { score: 1, confidence: 0.9 },
      identity: { score: 1, confidence: 0.9 },
    }),
  );
  assert.equal(missed.chosenBucket, null);
  assert.equal(missed.net, null);
  assert.equal(applyPass2(missed, {
    useful: { score: 4, confidence: 1 },
    knowledge: { score: 4, confidence: 1 },
    entertainment: { score: 4, confidence: 1 },
  }).net, null);
});

test('the higher framework on a bucket is the one that counts', () => {
  const scores = { curiosity: 0.7, arousal: 0.4, identity: 0.85 };
  const surviving = survivingFrameworks(scores);
  assert.equal(
    winningFramework('ball_knowledge', scores, surviving, {
      curiosity: 0.99,
      arousal: 0.99,
      identity: 0.5,
    }),
    'identity',
  );
});

test('same-day ideas stay today, and a timely carryover is not labeled a carryover', () => {
  const origins = candidateOrigins({
    timelyIds: ['today', 'also-yesterday'],
    sameDayIds: ['earlier-today'],
    carryoverIds: ['also-yesterday', 'miss'],
  });
  assert.equal(origins.get('today'), 'timely');
  assert.equal(origins.get('earlier-today'), 'timely');
  assert.equal(origins.get('also-yesterday'), 'timely');
  assert.equal(origins.get('miss'), 'carryover');
  assert.equal(previousNyDateKey(new Date('2026-09-22T05:00:00Z')), '2026-09-21');
  assert.equal(earlierNyDateKey(new Date('2026-09-22T05:00:00Z'), 2), '2026-09-20');
});

test('excerpts keep the primary long, supporting short, and duplicates headlined', () => {
  const words = Array.from({ length: 20 }, (_, index) => `word${index}`).join(' ');
  assert.equal(excerptWords(words, 5), 'word0 word1 word2 word3 word4…');

  const state = buildPass1State([
    { role: 'merged_duplicate', sourceName: 'HN', headline: 'Dup', body: words },
    { role: 'supporting', sourceName: 'Ars', headline: 'Angle', body: words },
    { role: 'primary', sourceName: 'TC', headline: 'Main', body: 'One short body.' },
  ]);
  const [primary, supporting, duplicate] = state.post_idea.members;
  assert.equal(primary.role, 'primary');
  assert.equal(primary.untrusted_content, 'One short body.');
  assert.equal(supporting.untrusted_content?.split(/\s+/).length, 20);
  assert.equal(duplicate.headline, 'Dup');
  assert.equal('untrusted_content' in duplicate, false);
});

test('pass 2 can win on useful, and a blue-chip story with high value gets 0.20 (D-254, D-255)', () => {
  const first = interpretPass1(pass1({ blueChipCompany: { noul: 0.95 } }));
  assert.equal(first.blockbuster, 0.1);
  const high = applyPass2(first, {
    useful: { score: 4, confidence: 0.9 },
    knowledge: { score: 1, confidence: 0.9 },
    entertainment: { score: 1, confidence: 0.9 },
  });
  assert.equal(high.value, 1);
  assert.equal(high.blockbuster, 0.2);
  const low = applyPass2(first, {
    useful: { score: 2, confidence: 0.9 },
    knowledge: { score: 2, confidence: 0.9 },
    entertainment: { score: 2, confidence: 0.9 },
  });
  assert.equal(low.blockbuster, 0.1);
});

test('the top levels of every psychology and bucket score need people on the line (D-257)', () => {
  for (const id of ['curiosity', 'arousal', 'identity', 'ballKnowledge', 'theNumber', 'theSaga', 'personalProfile', 'theWarning', 'theCallout'] as const) {
    assert.match(JSON.stringify(SCORING_PASS_1.questions[id]), /behavior in a test or benchmark is at stake, the score stays at Workable at most/, id);
  }
});
