import assert from 'node:assert/strict';
import test from 'node:test';

import { remarkSpans } from '../lib/social/copy/humanize';
import type { SpanRun } from '../lib/social/render/types';

test('remarkSpans preserves original run when rewrite equals concatenated input', () => {
  const original: SpanRun = [
    { text: 'On ', role: 'narrative' },
    { text: 'September 16,', role: 'pivot' },
    { text: ' OpenAI announced sponsored ads.', role: 'narrative' },
  ];
  const rewritten = 'On September 16, OpenAI announced sponsored ads.';
  const result = remarkSpans(original, rewritten);
  // Identical concatenation → return original untouched.
  assert.equal(result, original);
});

test('remarkSpans re-locates pivot span after em-dash removal', () => {
  const original: SpanRun = [
    { text: 'On ', role: 'narrative' },
    { text: 'September 16,', role: 'pivot' },
    { text: ' OpenAI told advertisers ChatGPT will begin serving ads.', role: 'narrative' },
  ];
  // Haiku removes an em-dash and slightly restructures — the pivot phrase stays verbatim.
  const rewritten = 'On September 16, OpenAI told advertisers ChatGPT will begin running sponsored placements.';
  const result = remarkSpans(original, rewritten);
  const pivotSpan = result.find((s) => s.role === 'pivot');
  assert.ok(pivotSpan, 'pivot role should survive the rewrite');
  assert.equal(pivotSpan?.text, 'September 16,');
});

test('remarkSpans preserves multiple emphasis spans in order', () => {
  const original: SpanRun = [
    { text: 'Placements sit ', role: 'narrative' },
    { text: 'clearly labeled', role: 'hook' },
    { text: ' beside organic answers, and ', role: 'narrative' },
    { text: 'Sam Altman', role: 'pivot' },
    { text: ' called the labeling the whole test.', role: 'narrative' },
  ];
  const rewritten = 'Placements sit clearly labeled beside organic answers. Sam Altman called the labeling the whole contract.';
  const result = remarkSpans(original, rewritten);

  const hook = result.find((s) => s.role === 'hook');
  const pivot = result.find((s) => s.role === 'pivot');
  assert.equal(hook?.text, 'clearly labeled');
  assert.equal(pivot?.text, 'Sam Altman');

  // Hook must land before pivot in the run order.
  const hookIdx = result.findIndex((s) => s.role === 'hook');
  const pivotIdx = result.findIndex((s) => s.role === 'pivot');
  assert.ok(hookIdx < pivotIdx, 'hook precedes pivot');
});

test('remarkSpans falls back to narrative when hook text was dropped in rewrite', () => {
  const original: SpanRun = [
    { text: 'Placements sit ', role: 'narrative' },
    { text: 'clearly labeled', role: 'hook' },
    { text: ' beside organic answers.', role: 'narrative' },
  ];
  // Haiku decides "clearly labeled" is redundant and drops it entirely.
  const rewritten = 'Placements sit beside organic answers with a label.';
  const result = remarkSpans(original, rewritten);
  // No hook survived; whole rewrite renders as narrative.
  const anyHook = result.find((s) => s.role === 'hook');
  assert.equal(anyHook, undefined);
  const concatenated = result.map((s) => s.text).join('');
  assert.equal(concatenated, rewritten);
});

test('remarkSpans does not double-mark overlapping matches', () => {
  const original: SpanRun = [
    { text: 'The ', role: 'narrative' },
    { text: 'labels', role: 'hook' },
    { text: ' say ', role: 'narrative' },
    { text: 'labels', role: 'hook' },
    { text: ' twice.', role: 'narrative' },
  ];
  const rewritten = 'The labels say labels twice.';
  const result = remarkSpans(original, rewritten);
  const hooks = result.filter((s) => s.role === 'hook');
  // Two verbatim "labels" — both re-marked, non-overlapping.
  assert.equal(hooks.length, 2);
  assert.ok(hooks.every((h) => h.text === 'labels'));
});

test('remarkSpans returns a single narrative span when the rewrite has no matches AND no span-emphasis was present', () => {
  const original: SpanRun = [
    { text: 'Everything is narrative.', role: 'narrative' },
  ];
  const rewritten = 'It is all narrative here.';
  const result = remarkSpans(original, rewritten);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.role, 'narrative');
  assert.equal(result[0]!.text, rewritten);
});
