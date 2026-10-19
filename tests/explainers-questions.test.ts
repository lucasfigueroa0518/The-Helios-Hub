import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ANALOGY_SCORING, ANALOGY_SCORING_FIELDS } from '@/lib/explainers/jev/questions/analogy-scoring';
import { DUPLICATE_GATE, DUPLICATE_JUDGE } from '@/lib/explainers/jev/questions/duplicate';
import { IDEA_SCORING, IDEA_SCORING_FIELDS } from '@/lib/explainers/jev/questions/idea-scoring';
import { ANALOGY_KEYS, IDEA_SCORE_KEYS, SCORE_KEYS } from '@/lib/explainers/types';

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), 'planning', 'Explainer Reels', name), 'utf8');
const kickoff = read('KICKOFF_DECISIONS.md');
const register = read('DECISIONS.md');

function section(doc: string, from: string, to: string): string {
  const start = doc.indexOf(from);
  assert.ok(start >= 0, `missing ${from}`);
  return doc.slice(start, doc.indexOf(to, start));
}

/** Question blocks in the packet format: **Q1 — …** / Key / Question / State fields / Judge rule / Levels. */
function blocks(doc: string, from: string, to: string, marker: string): string[] {
  return section(doc, from, to)
    .split(new RegExp(`\\n\\*\\*${marker}\\d — [^*]+\\*\\*\\n`))
    .map((block) => block.trim())
    .filter(Boolean);
}

function parts(block: string) {
  return {
    key: /Key: (\w+)/.exec(block)![1],
    question: /Question:\n(.+?)\nState fields:/s.exec(block)![1].trim(),
    judge: /Judge rule:\n(.+?)\nLevels:/s.exec(block)![1].trim(),
    levels: [...block.matchAll(/^- \d — (.+)$/gm)].map((m) => m[1]),
    fields: /State fields:\n(.+?)\n\nJudge rule:/s
      .exec(block)![1]
      .trim()
      .split('\n')
      .map((line) => line.trim().slice(2)),
  };
}

test('idea scoring v3 matches the register verbatim (EX3-32, EX3-33, EX3-73)', () => {
  const questions = blocks('\n' + register, '**Q1 — Audience fit', '**End of idea scoring v3**', 'Q');
  assert.equal(questions.length, 7);
  assert.deepEqual(Object.keys(IDEA_SCORING.questions), [...IDEA_SCORE_KEYS]);
  assert.equal(IDEA_SCORING.version, 'explainers-idea-scoring-v3');

  for (const block of questions) {
    const key = /Key: (\w+)/.exec(block)![1] as (typeof IDEA_SCORE_KEYS)[number];
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

test('idea scoring v3 keeps E-15\'s six keys and fields and adds ai_focus; Q5 differs only in "one-minute"', () => {
  const e15 = blocks(kickoff, '**Q1 — Audience fit', '**Weighted score**', 'Q').map(parts);
  const v3 = blocks('\n' + register, '**Q1 — Audience fit', '**End of idea scoring v3**', 'Q').map(parts);
  assert.deepEqual(v3.slice(0, 6).map((b) => b.key), e15.map((b) => b.key));
  assert.deepEqual(v3.slice(0, 6).map((b) => b.fields), e15.map((b) => b.fields));
  assert.deepEqual(v3.map((b) => b.key), [...IDEA_SCORE_KEYS]);
  assert.deepEqual(IDEA_SCORE_KEYS.slice(0, 6), [...SCORE_KEYS]);
  const q5 = (list: ReturnType<typeof parts>[]) => list.find((b) => b.key === 'accuracy_under_simplification');
  const oneMinute = (b: ReturnType<typeof parts> | undefined) => JSON.parse(JSON.stringify(b).replaceAll('45-second', 'one-minute'));
  assert.deepEqual(oneMinute(q5(e15)), q5(v3));
  // The beginner tilt lives in audience_fit (EX3-32).
  assert.match(v3[0].judge, /Favor beginner concepts/);
  // The one-minute reel throughout (EX3-35).
  assert.ok(!JSON.stringify(v3).includes('45-second'));
  assert.ok(!JSON.stringify(IDEA_SCORING.questions).includes('45-second'));
});

test('analogy scoring v3 matches the register verbatim (EX3-30, EX3-67, EX3-85)', () => {
  const questions = blocks('\n' + register, '**A1 — Simplicity', '**End of analogy scoring v3**', 'A').map(parts);
  assert.equal(ANALOGY_SCORING.version, 'explainers-analogy-scoring-v3');
  // Simplicity is the right rung, never simplicity for its own sake (Lucas, 2026-10-13).
  assert.match(questions[0].judge, /The ladder: rung 1 is one object or physical effect/);
  assert.match(questions[0].judge, /Do not reward simplicity for its own sake/);
  // Familiarity caps any invented rule; the hook is judged alone.
  assert.match(questions[5].judge, /any such invented rule scores at most 1/);
  assert.match(questions[6].judge, /with no title, no narration, and no idea what the video is about/);
  assert.equal(questions.length, 7);
  assert.deepEqual(Object.keys(ANALOGY_SCORING.questions), [...ANALOGY_KEYS]);
  assert.deepEqual(questions.map((q) => q.key), [...ANALOGY_KEYS]);
  for (const q of questions) {
    const set = ANALOGY_SCORING.questions[q.key as (typeof ANALOGY_KEYS)[number]];
    const instructions = set.instructions as { question: string; judge: string };
    assert.equal(instructions.question, q.question, q.key);
    assert.equal(instructions.judge, q.judge, q.key);
    assert.deepEqual([...set.criteria], q.levels, q.key);
    assert.deepEqual([...ANALOGY_SCORING_FIELDS], q.fields, q.key);
  }
});

test('E-15 duplicate gate matches the approved packet verbatim', () => {
  const block = section(kickoff, '**Duplicate gate**', '**Hard-gate processing order**');
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
