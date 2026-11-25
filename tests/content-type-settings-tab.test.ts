/**
 * The pool's Settings tab helpers (settings standard D8, D9, D16–D18; planning/settings-standard/CONTRACT.md §2).
 * Pure and offline: no database, no model calls.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ALSO_AFFECTED,
  CALENDAR_HREF,
  LIVE_CONFIRM,
  daysLabel,
  parseCapUsd,
  pauseConfirm,
  refillLine,
  scheduleLine,
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
  assert.equal(refillLine('reel_ai_drama'), 'Refills every night at 10 PM while fewer than five pitches wait');
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

const base = { days: null, schedule: null } as const;
const day = (nyDate: string, count: number) => ({ nyDate, count, trial: 0, main: count, series: [], override: false });

test('the Schedule line says what the Calendar set and nothing more (D20)', () => {
  // Explainers this week: Mon Nov 16 and Thu Nov 19, once each.
  const week = [day('2026-11-16', 1), day('2026-11-17', 0), day('2026-11-19', 1)];
  assert.equal(scheduleLine({ ...base, type: 'explainers', schedule: week }), 'Posts once a day, Mon, Thu');
  assert.equal(scheduleLine({ ...base, type: 'reels', schedule: [day('2026-11-16', 2), day('2026-11-18', 2)] }), 'Posts twice a day, Mon, Wed');
  assert.equal(scheduleLine({ ...base, type: 'reels', schedule: [day('2026-11-16', 3), day('2026-11-20', 2)] }), 'Posts 5 times this week, Mon, Fri');
  const everyDay = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'].map((d) => day(d, 1));
  assert.equal(scheduleLine({ ...base, type: 'stories', schedule: everyDay }), 'Posts once a day, every day');
  assert.equal(scheduleLine({ ...base, type: 'carousels', schedule: [day('2026-11-16', 0)] }), 'No times on the Calendar this week.');
  // Without the calendar (legacy): the plan's windows and days.
  assert.equal(scheduleLine({ ...base, type: 'last_few_days', days: [2, 5] }), `${windowsLine('last_few_days')} · Tue, Fri`);
  assert.equal(CALENDAR_HREF, '/social/calendar?view=week');
});

test('the Settings tab has no daily limit, posts-per-day stepper or week strip (D20)', () => {
  const src = readFileSync('components/content-type/pool/SettingsTab.tsx', 'utf8');
  for (const gone of ['Daily limit', 'Posts per day', 'ScheduleStrip', 'Posting windows']) assert.ok(!src.includes(gone), gone);
  assert.match(src, /Edit in Calendar/);
});

test('also affected by: publisher (D10; the Schedule line links the Calendar)', () => {
  assert.deepEqual(ALSO_AFFECTED.map((a) => a.label), ['publisher']);
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

test('Explainers and AI Drama Settings show a short list; the rest is behind Advanced settings', () => {
  const parts = readFileSync('components/content-type/type-parts.tsx', 'utf8');
  assert.match(parts, /<SettingsForm initial=\{view\.settings\} only=\{EXPLAINERS_TAB_KEYS\} \/>/);
  assert.match(parts, /<ReelAiDramaSettingsForm only=\{RAD_TAB_KEYS\} \/>/);
  assert.match(parts, /href="\/explainers\/settings">Advanced settings/);
  assert.match(parts, /href="\/reel-ai-drama\/lab\?tab=settings">Advanced settings/);
  const form = readFileSync('app/explainers/settings/settings-form.tsx', 'utf8');
  assert.match(form, /TAB_KEYS: readonly SettingKey\[\] = \['music_enabled', 'sfx_enabled', 'opener_voice', 'per_reel_cap_usd', 'daily_spend_cap_usd'\]/);
  const rad = readFileSync('components/content-type/ReelAiDramaSettingsForm.tsx', 'utf8');
  assert.match(rad, /RAD_TAB_KEYS: readonly string\[\] = \['per_reel_cap_usd', 'daily_spend_cap_usd', 'nightly_dev_cap_usd'\]/);
  // The Advanced pages: Explainers' own page (not a redirect), and the Lab opening on its Settings tab.
  const advanced = readFileSync('app/explainers/settings/page.tsx', 'utf8');
  assert.doesNotMatch(advanced, /redirect\('\/explainers\?tab=settings'\)/);
  assert.match(advanced, /hide=\{\[\.\.\.TAB_KEYS, 'auto_render', 'daily_render_cap'\]\}/);
  assert.match(readFileSync('app/reel-ai-drama/lab/page.tsx', 'utf8'), /<ReelAiDramaLab initialTab=\{tab\} \/>/);
});

test('every type has a refill line and a windows line', () => {
  const types: Vertical[] = ['reels', 'explainers', 'carousels', 'stories', 'ai_trivia', 'real_or_ai', 'last_few_days', 'ai_events', 'field_notes', 'reel_ai_drama'];
  for (const t of types) {
    assert.ok(refillLine(t).length > 0, t);
    assert.ok(windowsLine(t).length > 0, t);
  }
});
