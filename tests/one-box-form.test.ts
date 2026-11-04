/** One-box seeding: the form's shape, rendered to static markup (no network). */
import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { isSeedable } from '@/lib/content-type/seed-verticals';

// The test runner compiles JSX with the classic transform; the app (Next) uses the automatic one.
(globalThis as { React?: unknown }).React = React;
const form = () => import('@/components/content-type/OneBoxSeedForm');
async function html(vertical: 'reels' | 'stories' | 'explainers') {
  const { OneBoxSeedForm } = await form();
  return renderToStaticMarkup(React.createElement(OneBoxSeedForm, { vertical, done: () => undefined }));
}

test('the submit text states the price and the ceiling', async () => {
  const { ONE_BOX_SUBMIT } = await form();
  assert.equal(ONE_BOX_SUBMIT, 'Find source and add, about 12¢ (35¢ limit)');
  assert.ok((await html('reels')).includes(ONE_BOX_SUBMIT));
});
test('Stories shows the series choice; the other pools do not', async () => {
  const s = await html('stories');
  assert.ok(s.includes('Morning Download') && s.includes('Guess the Number') && s.includes('Free vs. Paid'));
  assert.ok(!(await html('reels')).includes('Morning Download'));
  assert.ok(!(await html('explainers')).includes('Morning Download'));
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
