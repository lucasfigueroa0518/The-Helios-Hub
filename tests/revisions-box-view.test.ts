/**
 * Targeted Revisions task 12: the revision box rendered to HTML in each state (offline; the
 * router is a stub, nothing is fetched during a server render). And the post view leaves the box
 * out while the `revise` flag is off.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RevisionBox, RevisionBoxView, type RevisionBoxViewProps } from '@/components/social-hub/post/RevisionBox';
import { revisionBoxState, type BoxRow } from '@/lib/revisions/box-state';
import type { Vertical } from '@/lib/social-hub/types';

(globalThis as { React?: unknown }).React = React;
const { createElement } = React;
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const NOW = new Date('2026-10-29T15:00:00Z');
const noop = () => {};

let seq = 0;
function row(over: Partial<BoxRow>): BoxRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, status: 'requested', instruction: 'Make the headline shorter', question: null, note: null,
    part: null, fixKind: null, stageTag: null, spendUsd: 0, capUsd: null, ceilingUsd: null, overrideUsd: null,
    createdAt: new Date(NOW.getTime() - (100 - seq) * 1000).toISOString(), startedAt: null, finishedAt: null, parentId: null, undoneAt: null, ...over,
  };
}

function view(rows: BoxRow[], extra: Partial<RevisionBoxViewProps> = {}, vertical: Vertical = 'carousels', lock: string | null = null): string {
  const props: RevisionBoxViewProps = {
    state: revisionBoxState(rows, { vertical, lock, now: NOW }),
    busy: null, note: null, text: '', reply: '', amount: '', armed: null,
    onText: noop, onArm: noop, onReply: noop, onAmount: noop, onSubmit: noop, onAnswer: noop, onContinue: noop, onUndo: noop,
    ...extra,
  };
  return renderToStaticMarkup(createElement(RevisionBoxView, props));
}

const slide3 = { kind: 'slide', key: '3' };

test('empty: a labelled text area, a counter, Revise, and a polite live region', () => {
  const html = view([]);
  assert.match(html, /<label class="sh-revise__label" for="[^"]+">Describe what’s off in this carousels post, in your words\.<\/label>/);
  assert.match(html, /<textarea[^>]*maxLength="1000"/);
  assert.match(html, /0\/1000/);
  assert.match(html, /<button type="submit"[^>]*disabled=""[^>]*>Revise<\/button>/, 'nothing to send yet');
  assert.match(html, /role="status" aria-live="polite"/);
});

test('typing enables Revise and counts characters', () => {
  const html = view([], { text: 'Slide 3 headline is too long' });
  assert.match(html, /28\/1000/);
  assert.doesNotMatch(html, /<button type="submit"[^>]*disabled/);
});

test('revising: the spinner line and the hint; no second request meanwhile', () => {
  const html = view([row({ status: 'running', startedAt: new Date(NOW.getTime() - 120_000).toISOString() })]);
  assert.match(html, /data-state="revising"/);
  assert.match(html, /Revising…/);
  assert.match(html, /Started 2 minutes ago/);
  assert.doesNotMatch(html, /<textarea/);
});

test('asking: the question, a labelled reply field and Answer', () => {
  const html = view([row({ status: 'asking', question: 'Slide 3 or slide 5?' })], { reply: 'Slide 3' });
  assert.match(html, /data-state="asking"/);
  assert.match(html, /Slide 3 or slide 5\?/);
  assert.match(html, />Your answer<\/label>/);
  assert.match(html, />Answer<\/button>/);
  assert.doesNotMatch(html, /<textarea/, 'the reply field is the way to go on');
});

test('a second reply refused by the server shows its note', () => {
  const html = view([row({ status: 'asking', question: 'Which slide?' })], { note: { ok: false, text: 'That question was already answered.' } });
  assert.match(html, /sh-actions__note--failed">That question was already answered\./);
});

test('applied: Done with the summary, Undo; two on one part add Restore original', () => {
  const one = view([row({ status: 'applied', part: slide3, instruction: 'Shorter' })]);
  assert.match(one, /data-state="applied"/);
  assert.match(one, /Done: “Shorter” \(slide 3\)\./);
  assert.match(one, />Undo<\/button>/);
  assert.doesNotMatch(one, /Restore original/);
  const two = view([row({ status: 'applied', part: slide3, instruction: 'Shorter' }), row({ status: 'applied', part: slide3, instruction: 'Even shorter' })]);
  assert.match(two, />Undo<\/button>/);
  assert.match(two, />Restore original<\/button>/);
  assert.match(two, /2 changes, last: “Even shorter”/);
});

test('blocked and failed: the plain note, and the box is ready again', () => {
  const html = view([row({ status: 'blocked', note: 'The new headline did not match the article, so it was not changed.' })], { text: 'try again' });
  assert.match(html, /data-state="blocked"/);
  assert.match(html, /did not match the article/);
  assert.doesNotMatch(html, /<textarea[^>]*disabled/);
  const failed = view([row({ status: 'failed', note: 'The fix failed and the original was kept: TypeError: x is undefined.' })]);
  assert.doesNotMatch(failed, /TypeError/);
});

test('paused at the cap: the note and Allow up to $X, prefilled from the estimate', () => {
  const note = 'This photo fix is estimated at $0.80, above the $0.50 cap for carousels. Allow a higher amount to run it.';
  const html = view([row({ status: 'paused_at_cap', note, capUsd: 0.5 })], { amount: '0.8' });
  assert.match(html, /data-state="paused-cap"/);
  assert.match(html, /estimated at \$0\.80/);
  assert.match(html, />Allow up to \$0\.80<\/button>/);
  assert.doesNotMatch(html, /notification was sent/);
});

test('paused at the ceiling: the note, the notification line, and Keep going needs an amount', () => {
  const note = 'Paused at the $1.50 ceiling for carousels after spending $1.52. Nothing was changed; you can keep going.';
  const empty = view([row({ status: 'paused_at_ceiling', note, ceilingUsd: 1.5 })]);
  assert.match(empty, /data-state="paused-ceiling"/);
  assert.match(empty, /A notification was sent\./);
  assert.match(empty, /<button type="button" class="sh-btn sh-btn--primary" disabled="">Keep going<\/button>/);
  const typed = view([row({ status: 'paused_at_ceiling', note, ceilingUsd: 1.5 })], { amount: '3' });
  assert.match(typed, />Keep going, up to \$3\.00<\/button>/);
  const zero = view([row({ status: 'paused_at_ceiling', note, ceilingUsd: 1.5 })], { amount: '0' });
  assert.match(zero, /Allow more than \$1\.50/, 'at the ceiling the amount must be above it');
  assert.match(zero, /aria-invalid="true"/);
});

test('published: the box is disabled with a one-line reason and nothing to type into', () => {
  const html = view([row({ status: 'applied', part: slide3 })], {}, 'carousels', 'Published posts can’t be revised.');
  assert.match(html, /Published posts can’t be revised\./);
  assert.doesNotMatch(html, /<textarea/);
  assert.doesNotMatch(html, /Undo/);
});

test('text on screen: the prompt never says reels', () => {
  const html = view([], {}, 'reels');
  assert.match(html, /this text on screen post/);
  assert.doesNotMatch(html, /reel/i);
});

test('the stateful box renders its first paint from rows it is given', () => {
  const html = renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router as never }, createElement(RevisionBox, { vertical: 'stories', refs: { setId: 'x' }, lock: null, initialRows: [row({ status: 'asking', question: 'Which frame?' })] })),
  );
  assert.match(html, /Which frame\?/);
  const loading = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, createElement(RevisionBox, { vertical: 'stories', refs: { setId: 'x' }, lock: null })));
  assert.match(loading, /Loading changes…/);
});

test('the post view leaves the box out while the revise flag is off', async () => {
  const { PostView } = await import('@/components/social-hub/post/PostView');
  const { offerer } = await import('@/lib/social-hub/views/offer');
  const { previewDataset } = await import('./fixtures/social-hub/preview-dataset');
  const dataset = previewDataset();
  const post = dataset.posts.find((p) => p.status !== 'published')!;
  const html = renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router as never }, createElement(PostView, { post, o: offerer(dataset, NOW), dataset })),
  );
  assert.ok(html.includes('sh-post'));
  assert.doesNotMatch(html, /sh-revise/);
});

test('Restore original asks for a second click before it discards the part\'s changes', () => {
  const rows = [row({ status: 'applied', part: slide3, instruction: 'Shorter' }), row({ status: 'applied', part: slide3, instruction: 'Even shorter' })];
  const idle = view(rows);
  assert.match(idle, />Restore original<\/button>/);
  assert.doesNotMatch(idle, /Yes, restore the original/);
  const armed = view(rows, { armed: 'slide:3' });
  assert.match(armed, />Yes, restore the original<\/button>/);
  assert.match(armed, /drops all 2 changes to slide 3/);
  assert.match(armed, />Cancel<\/button>/);
});

test('keep going at the ceiling says why a too-small amount can\'t be used', () => {
  const note = 'Paused at the $1.50 ceiling for carousels after spending $1.52. Nothing was changed; you can keep going.';
  const html = view([row({ status: 'paused_at_ceiling', note, ceilingUsd: 1.5 })], { amount: '1.5' });
  assert.match(html, /more than \$1\.50/);
  assert.match(html, /<button type="button" class="sh-btn sh-btn--primary" disabled="">/);
});

test('keep going after an earlier allowance refuses an amount at or below it', () => {
  const note = 'Paused at the $3.00 ceiling for carousels after spending $3.02. Nothing was changed; you can keep going.';
  const html = view([row({ status: 'paused_at_ceiling', note, ceilingUsd: 1.5, overrideUsd: 3 })], { amount: '2.50' });
  assert.match(html, /Allow more than \$3\.00/);
  assert.match(html, /<button type="button" class="sh-btn sh-btn--primary" disabled="">/);
});
