import assert from 'node:assert/strict';
import test from 'node:test';

import { failedGates, weightedScore, type TopicScores } from '@/lib/explainers/scoring';

function s(
  audience_fit: number,
  teachability_45s: number,
  analogy_potential: number,
  visual_potential: number,
  accuracy_under_simplification: number,
  hook_strength: number,
): TopicScores {
  return {
    audience_fit,
    teachability_45s,
    analogy_potential,
    visual_potential,
    accuracy_under_simplification,
    hook_strength,
  };
}

// The E-15 six-topic sanity check, exact values.
const SANITY: [string, TopicScores, number, boolean][] = [
  ['API call', s(4, 4, 4, 4, 4, 3), 96.25, true],
  ['Auth vs authz', s(4, 4, 4, 3, 4, 3), 93.125, true],
  ['Vector search', s(4, 3, 3, 4, 3, 4), 86.875, true],
  ['React', s(3, 3, 3, 3, 4, 2), 76.25, true],
  ['Everything about agents', s(4, 0, 2, 3, 1, 4), 55.625, false],
  ['Will AI replace employees', s(0, 2, 1, 2, 0, 4), 34.375, false],
];

test('weighted score matches the E-15 sanity table', () => {
  for (const [name, scores, expected] of SANITY) {
    assert.equal(weightedScore(scores), expected, name);
  }
  assert.equal(weightedScore(s(4, 4, 4, 4, 4, 4)), 100);
  assert.equal(weightedScore(s(0, 0, 0, 0, 0, 0)), 0);
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
  assert.equal(weightedScore(s(3.5, 3, 3, 3, 3, 3)), 77.5);
});
