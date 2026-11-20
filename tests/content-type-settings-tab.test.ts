/**
 * The pool's Settings tab helpers (settings standard D8, D9, D16–D18; planning/settings-standard/CONTRACT.md §2).
 * Pure and offline: no database, no model calls.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ALSO_AFFECTED,
  LIVE_CONFIRM,
  capMax,
  daysLabel,
  parseCapUsd,
  pauseConfirm,
  refillLine,
  settingsLayout,
  stateAsk,
  stateLine,
  windowsLine,
} from '@/components/content-type/pool/settings-tab';
import { generateCopy } from '@/lib/content-type/config';
import { STATE_COPY } from '@/lib/content-type/state';
import type { Vertical } from '@/lib/social-hub/types';

test('moving to Live asks with the contract line', () => {
  const ask = stateAsk('reels', 'approval', 'live', 3);
  assert.ok(ask);
  assert.deepEqual(ask.lines, [LIVE_CONFIRM]);
  assert.equal(LIVE_CONFIRM, 'Approved posts will go to Instagram at their slot times.');
  assert.equal(ask.ok, 'Go live');
});

test('moving to Paused says how many scheduled posts go back to the Made tab (D17)', () => {
  assert.equal(pauseConfirm(4), '4 scheduled posts will go back to the Made tab.');
  assert.equal(pauseConfirm(1), '1 scheduled post will go back to the Made tab.');
  assert.equal(pauseConfirm(0), 'No scheduled posts will go back to the Made tab.');
  assert.equal(pauseConfirm(-2), 'No scheduled posts will go back to the Made tab.');
  for (const from of ['approval', 'live'] as const) {
    const ask = stateAsk('explainers', from, 'paused', 2);
    assert.ok(ask);
    assert.equal(ask.lines[0], '2 scheduled posts will go back to the Made tab.');
    assert.equal(ask.ok, 'Pause');
  }
});

test('leaving Paused states the make step’s spend; Live to Approval and no move ask nothing', () => {
  const toApproval = stateAsk('last_few_days', 'paused', 'approval', 0);
  assert.ok(toApproval);
  assert.deepEqual(toApproval.lines, [generateCopy('last_few_days').confirm]);
  const toLive = stateAsk('carousels', 'paused', 'live', 0);
  assert.ok(toLive);
  assert.deepEqual(toLive.lines, [generateCopy('carousels').confirm, LIVE_CONFIRM]);
  assert.equal(stateAsk('reels', 'live', 'approval', 5), null);
  assert.equal(stateAsk('reels', 'live', 'live', 5), null);
});

test('the state line is STATE_COPY’s', () => {
  for (const s of ['paused', 'approval', 'live'] as const) assert.equal(stateLine(s), STATE_COPY[s].line);
});

test('refill line: "Refills every night", or the type’s own cadence sentence', () => {
  assert.equal(refillLine('reels'), 'Refills every night');
  assert.equal(refillLine('ai_events'), 'Refills every Sunday at noon');
  assert.match(refillLine('reel_ai_drama'), /^Weekly development session/);
});

test('refill cap input: a positive amount to the cent; empty, zero and junk are errors', () => {
  assert.deepEqual(parseCapUsd('0.25'), { ok: true, value: 0.25 });
  assert.deepEqual(parseCapUsd(' $0.505 '), { ok: true, value: 0.51 });
  for (const bad of ['', '  ', '0', '-1', 'abc']) assert.equal(parseCapUsd(bad).ok, false, bad);
});

test('days and windows read only', () => {
  assert.equal(daysLabel([5, 2]), 'Tue, Fri');
  assert.equal(daysLabel([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.equal(windowsLine('reel_ai_drama'), 'Evening 8:00 PM–8:45 PM');
  assert.match(windowsLine('carousels'), /^No set windows/);
});

const base = { perDay: null, maxPerDay: null, days: null, schedule: null, cap: null } as const;

test('which blocks show per type: daily limit in template mode, posts per day in legacy, days for days-based types', () => {
  // Template mode: the calendar strip and the daily limit.
  const week = [{ nyDate: '2026-11-16', count: 1 }] as never;
  assert.deepEqual(settingsLayout({ ...base, type: 'reels', schedule: week, cap: 2, perDay: 3, maxPerDay: 3 }), { posts: 'limit', days: null, windows: 'calendar', capsInTypeForm: false });
  // Legacy: the posts-per-day stepper and the plan's windows.
  assert.deepEqual(settingsLayout({ ...base, type: 'explainers', perDay: 1, maxPerDay: 2 }), { posts: 'perDay', days: null, windows: 'plan', capsInTypeForm: true });
  // A days-based type: its days, no count.
  assert.deepEqual(settingsLayout({ ...base, type: 'last_few_days', days: [2, 5] }), { posts: null, days: [2, 5], windows: 'plan', capsInTypeForm: false });
  // Days from the plan when the posting state has none.
  assert.deepEqual(settingsLayout({ ...base, type: 'ai_trivia' }).days, [0, 1, 4]);
  assert.equal(settingsLayout({ ...base, type: 'reel_ai_drama' }).capsInTypeForm, true);
});

test('daily limit bounds: Trivia and Real or AI? once a day, Morning Download by its config', () => {
  assert.equal(capMax('ai_trivia'), 1);
  assert.equal(capMax('real_or_ai'), 1);
  assert.ok(capMax('stories') >= 2);
});

test('also affected by: calendar template mode · publisher (D10)', () => {
  assert.deepEqual(ALSO_AFFECTED.map((a) => a.label), ['calendar template mode', 'publisher']);
  for (const a of ALSO_AFFECTED) assert.match(a.href, /^\/social\//);
});

test('wiring: no Auto-publish or approval control, no gear drawer, every pool gets Ideas | Made | Settings', () => {
  const tab = readFileSync('components/content-type/pool/SettingsTab.tsx', 'utf8');
  // Code only: the doc comment says there is no such control.
  const code = tab.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(code, /autoPublish|Auto-publish|requireApproval|require_approval|[Aa]pproval required/);
  assert.match(tab, /\/api\/content-type\/posting/);
  assert.match(tab, /refreshHubPage/);
  const controls = readFileSync('components/content-type/TypeControls.tsx', 'utf8');
  assert.doesNotMatch(controls, /export function (SettingsButton|PostingSettings|LiveToggle)\b/);
  for (const file of ['components/content-type/ContentTypePage.tsx', 'app/reels/reels-hub.tsx', 'components/social-hub/content/ContentScreen.tsx', 'components/social-hub/content/HubControls.tsx']) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /SettingsButton|PostingSettings|LiveToggle/, file);
  }
  assert.match(readFileSync('components/content-type/ContentTypePage.tsx', 'utf8'), /settings=\{<SettingsTab /);
  assert.match(readFileSync('app/reels/reels-hub.tsx', 'utf8'), /settings=\{<SettingsTab type="reels"/);
  const tabs = readFileSync('components/content-type/pool/PoolTabs.tsx', 'utf8');
  assert.match(tabs, /segment\('settings', 'Settings', null\)/);
});

test('every type has a refill line and a windows line', () => {
  const types: Vertical[] = ['reels', 'explainers', 'carousels', 'stories', 'ai_trivia', 'real_or_ai', 'last_few_days', 'ai_events', 'field_notes', 'reel_ai_drama'];
  for (const t of types) {
    assert.ok(refillLine(t).length > 0, t);
    assert.ok(windowsLine(t).length > 0, t);
  }
});
