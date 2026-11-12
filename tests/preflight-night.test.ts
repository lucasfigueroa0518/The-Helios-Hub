import assert from 'node:assert/strict';
import test from 'node:test';

import { hasFailure, judge, type PreflightInput } from '@/lib/preflight/night';

const base: PreflightInput = {
  date: '2026-11-12',
  slots: [{ vertical: 'stories', series: 'morning_download' }, { vertical: 'field_notes', series: null }, { vertical: 'explainers', series: null }],
  autoOn: { field_notes: true, explainers: true },
  storiesSeriesAuto: { morning_download: true },
  publishingLive: { stories: true, field_notes: true, explainers: true },
  fieldNotesPending: 1,
  fieldNotesMaxPending: 3,
  storiesReadyUnapproved: 0,
  recentFailureReasons: [],
  explainers: { perReelCapUsd: 20, dailySpendCapUsd: 25 },
};

test('a calendar that the workers will carry out has no failures, and always lists the manual checks', () => {
  const f = judge(base);
  assert.equal(hasFailure(f), false);
  assert.equal(f.filter((x) => x.level === 'manual').length, 2);
});

test('a slot on the calendar for a type whose auto switch is off is a failure', () => {
  const f = judge({ ...base, autoOn: { field_notes: false, explainers: true } });
  assert.ok(f.some((x) => x.level === 'fail' && /Field Notes.*auto switch is off/.test(x.text)));
  const s = judge({ ...base, storiesSeriesAuto: { morning_download: false } });
  assert.ok(s.some((x) => x.level === 'fail' && /Stories morning_download/.test(x.text)));
});

test('Field Notes skips at the pending limit, not above it: 3 waiting with a limit of 3 is a failure', () => {
  assert.equal(hasFailure(judge({ ...base, fieldNotesPending: 3 })), true);
  assert.equal(hasFailure(judge({ ...base, fieldNotesPending: 2 })), false);
});

test('a daily Explainers cap below the per-reel cap, and failures still in the last report, are failures', () => {
  assert.equal(hasFailure(judge({ ...base, explainers: { perReelCapUsd: 20, dailySpendCapUsd: 10 } })), true);
  assert.equal(hasFailure(judge({ ...base, recentFailureReasons: ['out_of_credits'] })), true);
  assert.equal(hasFailure(judge({ ...base, recentFailureReasons: ['auth'] })), true);
});

test('unapproved Stories sets and publishing_live off are heads-ups, not failures', () => {
  const f = judge({ ...base, storiesReadyUnapproved: 1, publishingLive: { stories: false } });
  assert.equal(hasFailure(f), false);
  assert.ok(f.some((x) => x.level === 'warn' && /unapproved/.test(x.text)));
  assert.ok(f.some((x) => x.level === 'warn' && /publishing_live is off/.test(x.text)));
});
