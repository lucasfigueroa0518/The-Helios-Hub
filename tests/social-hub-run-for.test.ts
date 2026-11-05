import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProgressItem } from '@/lib/content-type/progress';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { aRunLeft, canMakeCard, inFlightKey, inFlightRuns, runForCandidate, runningSummary, runOnMadeCard } from '@/lib/social-hub/views/run-for';

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

test('only a finished run marks the hub read stale; a start or a stage change does not (2026-10-26)', () => {
  const running = { ...none, explainers: [item({ id: 'job-1', stage: 'session_a' })] };
  const before = inFlightRuns(running);
  const moved = inFlightRuns({ ...none, explainers: [item({ id: 'job-1', stage: 'session_b' })] });
  const started = inFlightRuns({ ...running, carousels: [item({ id: 'run-2:0', state: 'queued' })] });
  assert.equal(aRunLeft(before, moved), false, 'a stage change keeps the cached read');
  assert.equal(aRunLeft(before, started), false, 'a new run keeps the cached read');
  assert.equal(aRunLeft(before, inFlightRuns(none)), true, 'a run that left may have made something');
  assert.equal(aRunLeft(inFlightRuns(none), inFlightRuns(none)), false);
});

test('a run that was asked for particular carousel stories shows only on those stories’ cards', () => {
  const amazon = item({ id: 'run-2:0', label: 'Carousel run', topicId: 'https://www.bloomberg.com/news/articles/amazon', state: 'queued' });
  const runs = { ...none, carousels: [amazon] };
  const mine = candidate({ post: null, locked: false, idea: { id: 'carousels:story:https://www.bloomberg.com/news/articles/amazon' } as QuotaCandidate['idea'] });
  const other = candidate({ post: null, locked: false, idea: { id: 'carousels:story:https://www.bloomberg.com/news/videos/philly' } as QuotaCandidate['idea'] });
  assert.equal(runForCandidate(mine, runs)?.id, 'run-2:0');
  assert.equal(runForCandidate(other, runs), null, 'a different story’s card does not claim the run');
});

test('a made card shows a run only when it is being made or the run names its idea (2026-10-13)', () => {
  const picksItsOwn = item();
  assert.equal(runOnMadeCard({ status: 'generating', idea: null }, picksItsOwn)?.id, 'run-1', 'being made: the chip shows');
  assert.equal(runOnMadeCard({ status: 'ready', idea: { id: 'carousels:story:s1' } }, picksItsOwn), null, 'a run picking its own stories leaves a made card its buttons');
  const named = item({ topicId: 's1' });
  assert.equal(runOnMadeCard({ status: 'ready', idea: { id: 'carousels:story:s1' } }, named)?.id, 'run-1', 'the idea id ends with the run topic');
  assert.equal(runOnMadeCard({ status: 'ready', idea: { id: 's1' } }, named)?.id, 'run-1', 'a bare idea id matches too');
  assert.equal(runOnMadeCard({ status: 'ready', idea: { id: 'carousels:story:s2' } }, named), null, 'another idea’s run');
  assert.equal(runOnMadeCard({ status: 'generating', idea: null }, null), null);
});

test('Make it only on a card it can make alone (2026-10-13)', () => {
  const open = { idea: null, post: null, locked: false, rank: null };
  assert.equal(canMakeCard(candidate({ ...open, vertical: 'stories', seriesId: 'morning_download' })), true);
  assert.equal(canMakeCard(candidate({ ...open, vertical: 'stories' })), false);
  assert.equal(canMakeCard(candidate({ vertical: 'explainers', post: null })), true, 'an idea card');
  assert.equal(canMakeCard(candidate({ ...open, vertical: 'explainers' })), false, 'an open explainer slot waits for Run now');
  assert.equal(canMakeCard(candidate({ ...open, vertical: 'reels' })), false, 'an open reels slot waits for Run now');
  assert.equal(canMakeCard(candidate({ ...open, vertical: 'carousels' })), true, 'a carousel run picks its own story');
});
