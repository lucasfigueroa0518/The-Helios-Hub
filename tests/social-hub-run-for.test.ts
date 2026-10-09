import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProgressItem } from '@/lib/content-type/progress';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { inFlightKey, runForCandidate, runningSummary } from '@/lib/social-hub/views/run-for';

const none = { carousels: [], stories: [], explainers: [] };

function item(over: Partial<ProgressItem> = {}): ProgressItem {
  return {
    id: 'run-1',
    label: 'Carousel run',
    state: 'running',
    stage: null,
    error: null,
    topicId: null,
    requestedAt: '2026-10-09T15:00:00Z',
    startedAt: '2026-10-09T15:00:01Z',
    typicalSeconds: 600,
    ...over,
  };
}

function candidate(over: Partial<QuotaCandidate> = {}): QuotaCandidate {
  return { vertical: 'carousels', idea: { id: 'carousels:story:s1' } as QuotaCandidate['idea'], post: { status: 'scheduled' } as QuotaCandidate['post'], locked: true, rank: 1, moved: null, ...over };
}

test('a carousel run shows on today’s carousel cards even when the post already exists', () => {
  const runs = { ...none, carousels: [item()] };
  assert.equal(runForCandidate(candidate(), runs)?.id, 'run-1');
  assert.equal(runForCandidate(candidate({ post: null, locked: false }), runs)?.label, 'Carousel run');
  assert.equal(runForCandidate(candidate(), none), null);
  assert.deepEqual(runningSummary(runs), ['Carousels running']);
});

test('an explainer run stays on its own topic, and a stories run stays on its series', () => {
  const explainer = item({ id: 'job-1', label: 'What is an API?', topicId: 'topic-1', stage: 'session_a' });
  const story = item({ id: 'set-1', label: 'Morning Download', topicId: null });
  const runs = { ...none, explainers: [explainer], stories: [story] };
  const mine = candidate({ vertical: 'explainers', idea: { id: 'explainers:topic:topic-1' } as QuotaCandidate['idea'] });
  const other = candidate({ vertical: 'explainers', idea: { id: 'explainers:topic:topic-2' } as QuotaCandidate['idea'] });
  assert.equal(runForCandidate(mine, runs)?.id, 'job-1');
  assert.equal(runForCandidate(other, runs), null);
  assert.equal(runForCandidate(candidate({ vertical: 'stories', series: 'Morning Download', idea: null }), runs)?.id, 'set-1');
  assert.equal(runForCandidate(candidate({ vertical: 'stories', series: 'Free vs. Paid', idea: null }), runs), null);
  assert.equal(runForCandidate(candidate({ vertical: 'reels' }), runs), null);
  assert.equal(inFlightKey(runs), inFlightKey({ ...runs, carousels: [] }));
  assert.notEqual(inFlightKey(runs), inFlightKey(none));
});
