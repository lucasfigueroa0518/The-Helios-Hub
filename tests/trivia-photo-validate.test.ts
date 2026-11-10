// AT-28: named photos are allowed; slide 1's photo never gives the answer away.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TriviaWriteItem } from '@/lib/stories/trivia/prompts';
import { validateQuestion } from '@/lib/stories/trivia/validate';

const base: TriviaWriteItem = {
  cell_id: 't06a03',
  question: 'Which lab did the team behind the first chess engine work at?',
  difficulty: 'hard',
  options: [{ letter: 'A', text: 'Bell Labs' }, { letter: 'B', text: 'Los Alamos' }],
  correct: 'B',
  answer_line: 'The engine ran on a machine built to model weapons.',
  photo_kind: 'thematic', photo_name: '', photo_subject: 'an old chessboard under a lamp',
  answer_photo_kind: 'company', answer_photo_name: 'Los Alamos', answer_photo_subject: 'the lab buildings',
  sources: ['https://example.org/a'],
  score: { surprise: 0.7, about_you: 0.3, social_currency: 0.6 },
};
const ctx = { offered: new Set(['t06a03']), open: new Set(['t06a03']) };
const problems = (item: TriviaWriteItem) => { const v = validateQuestion(item, ctx); return v.ok ? [] : v.problems; };

test('a thematic slide 1 with a named answer photo on slide 2 passes', () => {
  const v = validateQuestion(base, ctx);
  assert.ok(v.ok);
  if (v.ok) assert.equal(v.q.answerPhotoName, 'Los Alamos');
});

test('slide 1 naming the correct option is rejected', () => {
  assert.ok(problems({ ...base, photo_kind: 'company', photo_name: 'Los Alamos' }).some((p) => p.includes('slide 1')));
  assert.ok(problems({ ...base, photo_subject: 'the Los Alamos gate' }).some((p) => p.includes('gives the answer away')));
});

test('slide 1 may only name someone the question names', () => {
  assert.ok(problems({ ...base, photo_kind: 'person', photo_name: 'Alan Turing' }).some((p) => p.includes('does not')));
});

test('a named photo needs a name', () => {
  assert.ok(problems({ ...base, answer_photo_name: '' }).some((p) => p.includes('answer photo name')));
});
