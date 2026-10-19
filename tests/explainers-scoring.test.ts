import assert from 'node:assert/strict';
import test from 'node:test';

import { SCORE_POINTS, failedGates, topicAiFocus, weightedScore, type TopicScores } from '@/lib/explainers/scoring';

function s(
  audience_fit: number,
  teachability_45s: number,
  analogy_potential: number,
  visual_potential: number,
  accuracy_under_simplification: number,
  hook_strength: number,
  ai_focus?: number,
): TopicScores {
  return {
    audience_fit,
    teachability_45s,
    analogy_potential,
    visual_potential,
    accuracy_under_simplification,
    hook_strength,
    ...(ai_focus === undefined ? {} : { ai_focus }),
  };
}

// The E-15 six-topic sanity check under idea scoring v3 (EX3-73): the six weights ×0.9, plus
// ai_focus worth 10. Exact values.
const SANITY: [string, TopicScores, number, boolean][] = [
  ['API call', s(4, 4, 4, 4, 4, 3, 1), 89.125, true],
  ['Auth vs authz', s(4, 4, 4, 3, 4, 3, 0), 83.813, true],
  ['Vector search', s(4, 3, 3, 4, 3, 4, 3), 85.688, true],
  ['React', s(3, 3, 3, 3, 4, 2, 0), 68.625, true],
  ['Everything about agents', s(4, 0, 2, 3, 1, 4, 4), 60.063, false],
  ['Will AI replace employees', s(0, 2, 1, 2, 0, 4, 1), 33.438, false],
];

test('weighted score matches the sanity table under idea scoring v3 (EX3-73)', () => {
  for (const [name, scores, expected] of SANITY) {
    assert.equal(weightedScore(scores), expected, name);
  }
  assert.equal(weightedScore(s(4, 4, 4, 4, 4, 4, 4)), 100);
  assert.equal(weightedScore(s(0, 0, 0, 0, 0, 0, 0)), 0);
  assert.equal(Object.values(SCORE_POINTS).reduce((a, b) => a + b, 0), 100);
  // The register's weights.
  assert.deepEqual(SCORE_POINTS, {
    audience_fit: 18,
    teachability_45s: 18,
    analogy_potential: 11.25,
    visual_potential: 11.25,
    accuracy_under_simplification: 18,
    hook_strength: 13.5,
    ai_focus: 10,
  });
});

test('a topic scored before v3 carries no AI points until rescored', () => {
  assert.equal(weightedScore(s(4, 4, 4, 4, 4, 4)), 90);
  assert.equal(weightedScore(s(4, 4, 4, 4, 4, 4, 2)), 95);
  assert.equal(topicAiFocus({ jev_notes: { ai_focus: 3 } }), 3);
  assert.equal(topicAiFocus({ jev_notes: { ai_focus: null } }), null);
  assert.equal(topicAiFocus({ jev_notes: {} }), null);
});

test('ai_focus has no gate: a CS topic is never rejected for not being AI', () => {
  assert.deepEqual(failedGates(s(4, 4, 4, 4, 4, 4, 0)), []);
});

test('gates reject exactly the two failing sanity topics', () => {
  for (const [name, scores, , survives] of SANITY) {
    assert.equal(failedGates(scores).length === 0, survives, name);
  }
  assert.deepEqual(failedGates(s(4, 0, 2, 3, 1, 4)), ['teachability_45s', 'accuracy_under_simplification']);
  assert.deepEqual(failedGates(s(0, 2, 1, 2, 0, 4)), ['audience_fit', 'accuracy_under_simplification']);
  // Boundaries: teachability and accuracy pass at 2; the others pass at 1; hook has no gate.
  assert.deepEqual(failedGates(s(1, 2, 1, 1, 2, 0)), []);
  assert.deepEqual(failedGates(s(1, 1, 1, 1, 2, 0)), ['teachability_45s']);
  assert.deepEqual(failedGates(s(1, 2, 0, 1, 2, 0)), ['analogy_potential']);
  assert.deepEqual(failedGates(s(1, 2, 1, 0, 2, 0)), ['visual_potential']);
});

test('raw Jev scores: gates compare the raw value with the E-15 minimums', () => {
  assert.deepEqual(failedGates(s(1, 1.99, 1, 1, 2, 0)), ['teachability_45s']);
  assert.deepEqual(failedGates(s(0.99, 1.99, 0.99, 0.99, 1.99, 0)), [
    'audience_fit',
    'teachability_45s',
    'analogy_potential',
    'visual_potential',
    'accuracy_under_simplification',
  ]);
  assert.deepEqual(failedGates(s(1, 2, 1, 1, 2, 0)), []);
  assert.equal(weightedScore(s(3.5, 3, 3, 3, 3, 3, 0)), 69.75);
});
