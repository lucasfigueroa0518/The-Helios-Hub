import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ANALOGY_COMPARE, ANALOGY_COMPARE_FIELDS, ANALOGY_GATE_FIELDS, ANALOGY_GATES, GOLDEN_MATCH, GOLDEN_MATCH_FIELDS } from '@/lib/explainers/jev/questions/analogy-check';
import { DEFINITION_CHECK, DEFINITION_CHECK_FIELDS } from '@/lib/explainers/jev/questions/definition-check';
import { DUPLICATE_GATE, DUPLICATE_JUDGE } from '@/lib/explainers/jev/questions/duplicate';
import { IDEA_SCORING, IDEA_SCORING_FIELDS } from '@/lib/explainers/jev/questions/idea-scoring';
import { GAP_GATE, GAP_SCORING, GAP_SCORING_FIELDS } from '@/lib/explainers/jev/questions/gap-scoring';
import { UNDERSTANDING, UNDERSTANDING_FIELDS } from '@/lib/explainers/render/understanding';
import { ANALOGY_GATE_KEYS, GAP_KEYS, IDEA_SCORE_KEYS, SCORE_KEYS } from '@/lib/explainers/types';

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

test('idea scoring v4 matches the register verbatim (EX3-32, EX3-33, EX3-73, EX3-123)', () => {
  const questions = blocks('\n' + register, '**Q1 — Audience fit', '**End of idea scoring v4**', 'Q');
  assert.equal(questions.length, 7);
  assert.deepEqual(Object.keys(IDEA_SCORING.questions), [...IDEA_SCORE_KEYS]);
  assert.equal(IDEA_SCORING.version, 'explainers-idea-scoring-v4');
  // v4 (3.9): one well-known analogy whose defining trait is the concept, not a drawable everyday scene.
  const q3 = IDEA_SCORING.questions.analogy_potential.instructions as { question: string; judge: string };
  assert.match(q3.question, /one well-known analogy/);
  assert.doesNotMatch(q3.judge, /drawable everyday scene/);

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

test('idea scoring v4 keeps E-15\'s six keys and fields and adds ai_focus; Q5 differs only in "one-minute"', () => {
  const e15 = blocks(kickoff, '**Q1 — Audience fit', '**Weighted score**', 'Q').map(parts);
  const v3 = blocks('\n' + register, '**Q1 — Audience fit', '**End of idea scoring v4**', 'Q').map(parts);
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

test('gap scoring v2 and the false-claim gate match the register verbatim (EX3-120, EX3-123)', () => {
  const questions = blocks('\n' + register, '**G1 — Pull', '**End of gap scoring v2**', 'G').map(parts);
  assert.equal(GAP_SCORING.version, 'explainers-gap-scoring-v2');
  assert.match(questions[2].judge, /the analogy and its mapping in the analogy field/);
  assert.deepEqual(Object.keys(GAP_SCORING.questions), [...GAP_KEYS]);
  assert.deepEqual(questions.map((q) => q.key), [...GAP_KEYS]);
  for (const q of questions) {
    const set = GAP_SCORING.questions[q.key as (typeof GAP_KEYS)[number]];
    const instructions = set.instructions as { question: string; judge: string };
    assert.equal(instructions.question, q.question, q.key);
    assert.equal(instructions.judge, q.judge, q.key);
    assert.deepEqual([...set.criteria], q.levels, q.key);
    assert.deepEqual([...GAP_SCORING_FIELDS], q.fields, q.key);
  }
  const block = section(register, '### Gap false-claim gate v1', '**End of the gap false-claim gate**');
  const gate = GAP_GATE.questions.false_claim.instructions as { question: string; judge: string };
  assert.equal(GAP_GATE.version, 'explainers-gap-gate-v1');
  assert.equal(gate.question, /Question:\n(.+?)\nJudge rule:/s.exec(block)![1].trim());
  assert.equal(gate.judge, /Judge rule:\n(.+)$/s.exec(block.trim())![1].trim());
});

/** noul blocks in the packet format: **C1 — …** / Key / Question / State fields / Judge rule. */
function noulBlocks(from: string, to: string, marker: string) {
  return blocks('\n' + register, from, to, marker).map((block) => ({
    key: /Key: (\w+)/.exec(block)![1],
    question: /Question:\n(.+?)\nState fields:/s.exec(block)![1].trim(),
    fields: /State fields:\n(.+?)\n\nJudge rule:/s.exec(block)![1].trim().split('\n').map((line) => line.trim().slice(2)),
    judge: /Judge rule:\n(.+?)(?:\n\n|$)/s.exec(block)![1].trim(),
  }));
}

test('analogy checks v1 match the register verbatim: the golden match, the three gates, the comparison (EX3-124)', () => {
  const checks = noulBlocks('**C1 — Same concept', '**End of analogy checks v1**', 'C');
  assert.deepEqual(checks.map((c) => c.key), ['same_concept', ...ANALOGY_GATE_KEYS, 'a_over_b']);
  assert.equal(GOLDEN_MATCH.version, 'explainers-golden-match-v1');
  assert.equal(ANALOGY_GATES.version, 'explainers-analogy-gates-v1');
  assert.equal(ANALOGY_COMPARE.version, 'explainers-analogy-compare-v1');
  assert.deepEqual(Object.keys(ANALOGY_GATES.questions), [...ANALOGY_GATE_KEYS]);
  const sets: Record<string, { set: { questions: object }; fields: readonly string[] }> = {
    same_concept: { set: GOLDEN_MATCH, fields: GOLDEN_MATCH_FIELDS },
    false_mapping: { set: ANALOGY_GATES, fields: ANALOGY_GATE_FIELDS },
    is_the_system: { set: ANALOGY_GATES, fields: ANALOGY_GATE_FIELDS },
    real_names: { set: ANALOGY_GATES, fields: ANALOGY_GATE_FIELDS },
    a_over_b: { set: ANALOGY_COMPARE, fields: ANALOGY_COMPARE_FIELDS },
  };
  for (const c of checks) {
    const { set, fields } = sets[c.key];
    const instructions = (set.questions as Record<string, { instructions: unknown }>)[c.key].instructions as { question: string; judge: string };
    assert.equal(instructions.question, c.question, c.key);
    assert.equal(instructions.judge, c.judge, c.key);
    assert.deepEqual([...fields], c.fields, c.key);
  }
  // Lucas's wording for the leave-one-out and the comparison; the plan's narrowed gate (decision 4).
  assert.equal(checks[0].question, 'Does this example analogy teach the same concept as the topic?');
  assert.equal(checks[4].question, 'Would a viewer be more likely to remember this analogy and repeat it to a friend than the other one?');
  assert.match(checks[2].judge, /Everyday things that resemble the concept's material \(paper, a letter, a note, a conversation\) are a comparison, so the answer is no\./);
  // Jev never sees the golden set when it judges a candidate.
  for (const fields of [ANALOGY_GATE_FIELDS, ANALOGY_COMPARE_FIELDS]) assert.ok(!fields.some((f) => /example|golden/.test(f)));
});

test('the understanding test matches the register verbatim (EX3-133)', () => {
  const checks = noulBlocks('**U1 — Mechanism', '**End of the understanding test**', 'U');
  assert.equal(UNDERSTANDING.version, 'explainers-understanding-v1');
  assert.deepEqual(checks.map((c) => c.key), Object.keys(UNDERSTANDING.questions));
  for (const c of checks) {
    const key = c.key as keyof typeof UNDERSTANDING.questions;
    const instructions = UNDERSTANDING.questions[key].instructions as { question: string; judge: string };
    assert.equal(instructions.question, c.question, c.key);
    assert.equal(instructions.judge, c.judge, c.key);
    assert.deepEqual([...UNDERSTANDING_FIELDS[key]], c.fields, c.key);
  }
});

test('the definition check matches the register verbatim (Explainers 4.1)', (t) => {
  assert.equal(DEFINITION_CHECK.version, 'explainers-definition-check-v1');
  assert.deepEqual(Object.keys(DEFINITION_CHECK.questions), ['same_part']);
  // DECISIONS.md is the docs builder's; the code's text waits for it in
  // .explainers-local/4.1-phase2/PIPELINE-NOTES.md ("Definition check v1"). Once the register has the
  // section, the comparison is strict.
  if (!register.includes('### Definition check v1')) {
    t.diagnostic('planning/Explainer Reels/DECISIONS.md has no "### Definition check v1" yet');
    return;
  }
  const checks = noulBlocks('**D1 — Same part', '**End of the definition check**', 'D');
  assert.deepEqual(checks.map((c) => c.key), Object.keys(DEFINITION_CHECK.questions));
  for (const c of checks) {
    const key = c.key as keyof typeof DEFINITION_CHECK.questions;
    const instructions = DEFINITION_CHECK.questions[key].instructions as { question: string; judge: string };
    assert.equal(instructions.question, c.question, c.key);
    assert.equal(instructions.judge, c.judge, c.key);
    assert.deepEqual([...DEFINITION_CHECK_FIELDS], c.fields, c.key);
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
