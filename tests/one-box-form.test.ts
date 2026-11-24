/** One-box seeding: the form's shape, rendered to static markup (no network). */
import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { isSeedable, seedableVerticals, type SeedVertical } from '@/lib/content-type/seed-verticals';
import { LIMIT_USD } from '@/lib/seed/one-box/budget';

// The test runner compiles JSX with the classic transform; the app (Next) uses the automatic one.
(globalThis as { React?: unknown }).React = React;
const form = () => import('@/components/content-type/OneBoxSeedForm');
async function html(vertical: SeedVertical) {
  const { OneBoxSeedForm } = await form();
  return renderToStaticMarkup(React.createElement(OneBoxSeedForm, { vertical, done: () => undefined }));
}

test('submitLabel for real_or_ai reads "Add · about 30¢ (60¢ limit)"', async () => {
  const { submitLabel } = await form();
  assert.equal(submitLabel('real_or_ai', false), 'Add · about 30¢ (60¢ limit)');
  assert.equal(submitLabel('reels', false), 'Add · about 12¢ (35¢ limit)');
  assert.equal(submitLabel('reel_ai_drama', false), 'Add · about 25¢ (50¢ limit)');
});
test('estimates are fixed per type, and every limit comes from the budget', async () => {
  const { ESTIMATE_CENTS, submitLabel } = await form();
  assert.deepEqual(ESTIMATE_CENTS, {
    reels: 12, carousels: 12, last_few_days: 12, stories: 12, explainers: 15, field_notes: 12, fieldNotesWithLink: 1, ai_trivia: 8, real_or_ai: 30, reel_ai_drama: 25,
  });
  for (const v of seedableVerticals()) assert.ok(submitLabel(v, false).endsWith(`(${Math.round(LIMIT_USD[v as keyof typeof LIMIT_USD] * 100)}¢ limit)`), v);
});
test('field_notes label drops to about 1¢ when a link is given', async () => {
  const { submitLabel } = await form();
  assert.equal(submitLabel('field_notes', false), 'Add · about 12¢ (35¢ limit)');
  assert.equal(submitLabel('field_notes', true), 'Add · about 1¢ (35¢ limit)');
  assert.equal(submitLabel('reels', true), 'Add · about 12¢ (35¢ limit)');
});
test('every seedable type has a placeholder and after-line, shown in its form', async () => {
  const { PLACEHOLDER, AFTER_LINE } = await form();
  for (const v of seedableVerticals()) {
    assert.ok(PLACEHOLDER[v] && AFTER_LINE[v], v);
    const out = await html(v);
    assert.ok(out.includes(`placeholder="${PLACEHOLDER[v]}"`), `${v} placeholder`);
    assert.ok(out.includes(AFTER_LINE[v].replace(/'/g, '&#x27;')), `${v} after-line`);
  }
  assert.equal(PLACEHOLDER.real_or_ai, 'A subject to photograph.');
  assert.equal(PLACEHOLDER.explainers, 'A concept, or a sentence about it.');
});
test('no series choice is rendered', async () => {
  for (const v of seedableVerticals()) {
    const s = await html(v);
    assert.ok(!s.includes('Guess the Number') && !s.includes('type="radio"') && !s.includes('<select'), v);
  }
});
test('every seedable pool renders the one box', async () => {
  for (const v of ['ai_trivia', 'real_or_ai', 'reel_ai_drama', 'field_notes'] as const) assert.ok((await html(v)).includes('aria-label="Your idea"'), v);
});
test('the link box is hidden until Add a link is pressed, and the blurb limit is 600', async () => {
  const out = await html('reels');
  assert.ok(out.includes('Add a link'));
  assert.ok(!out.includes('aria-label="Link"'));
  assert.equal((await form()).MAX_BLURB, 600);
});
test('the submit is disabled while the box is empty', async () => {
  assert.match(await html('reels'), /<button type="submit"[^>]*disabled/);
});
test('AI Events still has no seed', () => assert.equal(isSeedable('ai_events'), false));
