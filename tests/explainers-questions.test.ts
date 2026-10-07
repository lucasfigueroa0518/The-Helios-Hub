import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { DUPLICATE_GATE, DUPLICATE_JUDGE } from '@/lib/explainers/jev/questions/duplicate';
import { IDEA_SCORING, IDEA_SCORING_FIELDS } from '@/lib/explainers/jev/questions/idea-scoring';
import { SCORE_KEYS } from '@/lib/explainers/types';

const kickoff = fs.readFileSync(
  path.join(process.cwd(), 'planning', 'Explainer Reels', 'KICKOFF_DECISIONS.md'),
  'utf8',
);

function section(from: string, to: string): string {
  const start = kickoff.indexOf(from);
  assert.ok(start >= 0, `missing ${from}`);
  return kickoff.slice(start, kickoff.indexOf(to, start));
}

test('E-15 scoring questions match the approved packet verbatim', () => {
  const questions = section('**Q1 — Audience fit', '**Weighted score**')
    .split(/\n\*\*Q\d — [^*]+\*\*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  assert.equal(questions.length, 6);
  assert.deepEqual(Object.keys(IDEA_SCORING.questions), [...SCORE_KEYS]);

  for (const block of questions) {
    const key = /Key: (\w+)/.exec(block)![1] as (typeof SCORE_KEYS)[number];
    const question = IDEA_SCORING.questions[key];
    const instructions = question.instructions as { question: string; judge: string };
    assert.equal(instructions.question, /Question:\n(.+?)\nState fields:/s.exec(block)![1].trim(), key);
    assert.equal(instructions.judge, /Judge rule:\n(.+?)\nLevels:/s.exec(block)![1].trim(), key);
    const levels = [...block.matchAll(/^- \d — (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual([...question.criteria], levels, key);
    const fields = /State fields:\n(.+?)\n\nJudge rule:/s
      .exec(block)![1]
      .trim()
      .split('\n')
      .map((line) => line.trim().slice(2));
    assert.deepEqual([...IDEA_SCORING_FIELDS[key]], fields, key);
  }
});

test('E-15 duplicate gate matches the approved packet verbatim', () => {
  const block = section('**Duplicate gate**', '**Hard-gate processing order**');
  const question = /Question:\n(.+?)\nJudge:/s.exec(block)![1].trim();
  const judge = /Judge:\n(.+)$/s.exec(block.trim())![1].trim();
  const gate = DUPLICATE_GATE.questions.duplicate_of_existing_topic.instructions as {
    question: string;
    judge: string;
  };
  assert.equal(gate.question, question);
  assert.equal(gate.judge, judge);
  assert.equal(DUPLICATE_JUDGE, judge);
});
