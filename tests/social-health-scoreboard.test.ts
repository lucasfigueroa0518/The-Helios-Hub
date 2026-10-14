import assert from 'node:assert/strict';
import test from 'node:test';

import { approvalAlertLines, approvalsDue } from '@/lib/social-hub/health/approvals';
import { scoreboardLines } from '@/lib/social-hub/health/scoreboard';
import type { NightReport, StoredReport } from '@/lib/social-hub/health/types';
import { nightVerdict } from '@/lib/social-hub/health/verdict';
import type { HubPost, Vertical } from '@/lib/social-hub/types';

const label = (v: Vertical) => ({ reels: 'Text on Screen', explainers: 'Explainers', carousels: 'Carousels', stories: 'IG Stories' })[v];

const report = (vertical: Vertical, night: string, over: Partial<NightReport> = {}): NightReport => ({
  vertical, night, due: true, ran: true, target: 1, made: 1, needed: 1, ready: 1, scheduledYesterday: 1, postedYesterday: 1,
  retriedOk: 0, funnel: [], failures: [], spendUsd: 0.5, unknownCostCalls: 0, feedsStale: [], nearCap: false, reportError: null, ...over,
});

const stored = (night: string, reports: NightReport[]): StoredReport => ({
  night, builtAt: `${night}T11:30:00Z`, verdict: nightVerdict(night, reports, 'worked'), reports, failures: reports.flatMap((r) => r.failures),
});

test('scoreboard: one line per type per night, the failure reason, and clean nights over the window', () => {
  const n1 = stored('2026-10-12', [report('reels', '2026-10-12'), report('carousels', '2026-10-12')]);
  const n2 = stored('2026-10-13', [
    report('reels', '2026-10-13'),
    report('carousels', '2026-10-13', { made: 0, ready: 0, spendUsd: 0.64, failures: [{ vertical: 'carousels', night: '2026-10-13', at: '2026-10-13T07:00:00Z', stage: 'reporter', reason: 'Reporter cap hit', severity: 'failed' }] }),
  ]);
  const lines = scoreboardLines([n1, n2], label);
  assert.equal(lines[0], '2026-10-12  2 of 2 types worked · publisher ✔');
  const bad = lines.find((l) => l.includes('Carousels') && l.startsWith('  ✖'))!;
  assert.match(bad, /0 of 1 made/);
  assert.match(bad, /\$0\.64/);
  assert.match(bad, /1 failed/);
  assert.ok(lines.includes('2 nights · $2.14 spent'));
  assert.ok(lines.some((l) => /Carousels\s+1 of 2 nights clean/.test(l)));
  assert.ok(lines.some((l) => /Text on Screen\s+2 of 2 nights clean/.test(l)));
});

test('scoreboard: a type that was off is grey and not counted against its clean nights', () => {
  const n = stored('2026-10-13', [report('explainers', '2026-10-13', { due: false, ran: false, target: 0, made: 0, needed: 0, ready: 0, scheduledYesterday: 0, postedYesterday: 0 })]);
  const lines = scoreboardLines([n, n], label);
  assert.ok(lines.some((l) => l.startsWith('  · Explainers')));
  assert.ok(!lines.some((l) => /Explainers\s+\d+ of \d+ nights clean/.test(l)));
});

const post = (vertical: Vertical, name: string, over: Partial<HubPost> = {}): HubPost =>
  ({ id: name, vertical, name, status: 'ready', publishAt: null, approval: { required: true, approvedAt: null, note: null }, ...over }) as HubPost;

// 7:59 AM New York, Oct 14 (EDT, UTC-4).
const NOW = new Date('2026-10-14T11:59:00Z');

test('approval alert: a scheduled post is due at its slot, an unscheduled one at its type\'s last window, soonest first', () => {
  const due = approvalsDue(
    [
      post('carousels', 'Gemini agent'),
      post('stories', 'Morning Download'),
      post('reels', 'Coding AIs', { status: 'scheduled', publishAt: '2026-10-14T12:45:00Z' }),
    ],
    '2026-10-14',
    NOW,
  );
  assert.deepEqual(due.map((d) => d.post.name), ['Coding AIs', 'Morning Download', 'Gemini agent']);
  assert.equal(due[0]!.consequence, 'its slot is cancelled');
  assert.equal(due[1]!.deadline.toISOString(), '2026-10-14T14:00:00.000Z');
  assert.equal(due[1]!.consequence, 'the set is never scheduled');
  assert.equal(due[2]!.deadline.toISOString(), '2026-10-14T19:30:00.000Z');
  const lines = approvalAlertLines(due, label);
  assert.equal(lines[0], '3 posts waiting for approval; the first deadline is 8:45 AM.');
  assert.equal(lines[1], '⚠ Text on Screen · by 8:45 AM or its slot is cancelled: Coding AIs');
});

test('approval alert: a passed deadline is marked missed; nothing waiting means no alert', () => {
  const late = new Date('2026-10-14T14:30:00Z');
  const due = approvalsDue([post('stories', 'Morning Download')], '2026-10-14', late);
  assert.equal(due[0]!.overdue, true);
  assert.match(approvalAlertLines(due, label)[1]!, /^✖ IG Stories · missed 10:00 AM/);
  assert.deepEqual(approvalAlertLines([], label), []);
});
