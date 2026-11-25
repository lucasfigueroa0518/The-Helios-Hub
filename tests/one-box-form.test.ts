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

// Final fixes 1: Trivia aims for 50 unused and Real or AI? for 40; their caps never cut seeds, so Seed stays on.
test('the seed control is enabled for ai_trivia and real_or_ai with 50 open rows', async () => {
  const { seedPoolFull } = await import('@/lib/content-type/pool-rules');
  for (const vertical of ['ai_trivia', 'real_or_ai'] as const) {
    const at = { vertical, poolOpen: 50, hidden: 0, group: vertical, groups: [vertical], openIn: () => 50 };
    assert.equal(seedPoolFull(at), false, vertical);
    assert.equal(seedPoolFull({ ...at, group: null }), false, `${vertical}, no series picked`);
  }
  // Morning Download and Explainers still switch Seed off at the cap.
  assert.equal(seedPoolFull({ vertical: 'stories', poolOpen: 30, hidden: 0, group: 'morning_download', groups: ['morning_download'], openIn: () => 30 }), true);
  assert.equal(seedPoolFull({ vertical: 'explainers', poolOpen: 30, hidden: 0, group: null, groups: [], openIn: () => 0 }), true);
  assert.equal(seedPoolFull({ vertical: 'explainers', poolOpen: 30, hidden: 1, group: null, groups: [], openIn: () => 0 }), false);
  assert.equal(seedPoolFull({ vertical: 'reels', poolOpen: 90, hidden: 0, group: null, groups: [], openIn: () => 0 }), false);
});

// Final fixes 7: the submit toast says who does the work.
test('the submit toast: a source search on Vercel, the worker queue otherwise', async () => {
  const { submittedText } = await form();
  for (const v of ['reels', 'carousels', 'last_few_days', 'stories', 'explainers', 'field_notes'] as const) {
    assert.equal(submittedText(v), 'Looking for a source. It will appear in the queue when it is found.', v);
  }
  for (const v of ['ai_trivia', 'real_or_ai', 'reel_ai_drama'] as const) {
    assert.equal(submittedText(v), "Queued for the worker. It will appear in the queue when it's made.", v);
  }
});

// Final fixes 8 and 9: the worker stages have words, and polling slows while every working card is only queued.
test('every worker stage has its words; the old ones are kept', async () => {
  const { STAGE_TEXT, stageText } = await import('@/components/content-type/SeedRequestCards');
  assert.equal(STAGE_TEXT.claimed, 'Starting…');
  assert.equal(STAGE_TEXT.writing, 'Writing…');
  assert.equal(STAGE_TEXT.making, 'Making the images…');
  assert.equal(stageText({ vertical: 'reel_ai_drama', stage: 'checking' }), 'Checking…');
  assert.equal(stageText({ vertical: 'real_or_ai', stage: 'making' }), 'Making the images…');
  assert.equal(stageText({ vertical: 'ai_trivia', stage: 'claimed' }), 'Starting…');
  // The Vercel source match keeps its words.
  assert.equal(stageText({ vertical: 'reels', stage: 'checking' }), 'Checking the match…');
  assert.equal(stageText({ vertical: 'reels', stage: 'nope' }), 'Working…');
  assert.equal(STAGE_TEXT.queued, 'Starting…');
  assert.equal(STAGE_TEXT.searching, 'Searching for a source…');
  assert.equal(STAGE_TEXT.reading, 'Reading the sources…');
  assert.equal(STAGE_TEXT.filing, 'Adding it to the queue…');
});
test('polling: 3 s while a card is working and not queued, 15 s while every working card is queued, none otherwise', async () => {
  const { pollEveryMs } = await import('@/components/content-type/SeedRequestCards');
  const card = (status: 'working' | 'failed' | 'done', cancellable: boolean) => ({ id: 'x', vertical: 'ai_trivia', blurb: 'b', status, stage: cancellable ? 'queued' : 'writing', message: null, createdAt: '', cancellable });
  assert.equal(pollEveryMs([card('working', false)]), 3000);
  assert.equal(pollEveryMs([card('working', true), card('working', false)]), 3000);
  assert.equal(pollEveryMs([card('working', true)]), 15000);
  assert.equal(pollEveryMs([card('working', true), card('failed', false)]), 15000);
  assert.equal(pollEveryMs([card('done', false)]), null);
  assert.equal(pollEveryMs([]), null);
});
