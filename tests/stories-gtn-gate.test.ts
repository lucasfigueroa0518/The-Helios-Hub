/** Guess the Number's Jev sets (gtn-gate@1, gtn-same-subject@1): shape and wording rules. Offline; no Jev call. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { GTN_CANDIDATE, GTN_GATE, GTN_SAME_SUBJECT, STORIES_QUESTION_SETS } from '@/lib/stories/questions';

type Q = { instructions: string; criteria: { true: string; false: string } };
const qs = (set: { questions: object }) => set.questions as Record<string, Q>;

test('gtn-gate@1 has exactly the six keys and is registered', () => {
  assert.equal(GTN_GATE.id, 'gtn-gate');
  assert.equal(GTN_GATE.version, 'gtn-gate@1');
  assert.deepEqual(Object.keys(GTN_GATE.questions), ['verifiable', 'want_to_guess', 'newly_changed', 'copy_says_new', 'guessable', 'surprise']);
  assert.ok(STORIES_QUESTION_SETS.includes(GTN_GATE));
  for (const k of ['guessable', 'surprise'])
    assert.deepEqual(qs(GTN_GATE)[k], qs(GTN_CANDIDATE)[k]);
});

test('gtn-same-subject@1 has one key and is registered', () => {
  assert.equal(GTN_SAME_SUBJECT.id, 'gtn-same-subject');
  assert.equal(GTN_SAME_SUBJECT.version, 'gtn-same-subject@1');
  assert.deepEqual(Object.keys(GTN_SAME_SUBJECT.questions), ['same_subject']);
  assert.ok(STORIES_QUESTION_SETS.includes(GTN_SAME_SUBJECT));
});

test('no Guess the Number gate question carries an example list', () => {
  const bad = /for example|e\.g\.|such as|\bmoney\b|everyday tools/i;
  for (const set of [GTN_GATE, GTN_SAME_SUBJECT])
    for (const [key, q] of Object.entries(qs(set)))
      for (const text of [q.instructions, q.criteria.true, q.criteria.false])
        assert.ok(!bad.test(text), `${set.version}.${key}: ${text}`);
});
