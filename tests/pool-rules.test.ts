import assert from 'node:assert/strict';
import test from 'node:test';

import { TYPE_CONFIG, type PoolConfig } from '@/lib/content-type/config';
import { madeRowState, poolFreshness, poolRowState, POOL_STATE_WORDS, storySeriesOf, type PoolRowState } from '@/lib/content-type/pool-rules';
import { leadDaysFor } from '@/lib/social-hub/lead';
import type { HubIdea, HubPost, Vertical } from '@/lib/social-hub/types';

/** Pool UI contract 2026-11-15 §2 table, row for row. */
const EXPECTED: Record<Vertical, { noun: PoolConfig['noun']['one']; order: PoolConfig['order']; make: boolean }> = {
  reels: { noun: 'idea', order: 'score', make: false },
  explainers: { noun: 'topic', order: 'score', make: true },
  carousels: { noun: 'story', order: 'score', make: false },
  stories: { noun: 'idea', order: 'score', make: false },
  last_few_days: { noun: 'story', order: 'rank', make: false },
  field_notes: { noun: 'tip', order: 'score', make: true },
  ai_events: { noun: 'event', order: 'rank', make: false },
  reel_ai_drama: { noun: 'pitch', order: 'rank', make: true },
};

const TYPES = Object.keys(TYPE_CONFIG) as Vertical[];

test('every type has a pool block matching the contract table', () => {
  assert.equal(TYPES.length, 8);
  for (const type of TYPES) {
    const pool = TYPE_CONFIG[type].pool;
    const want = EXPECTED[type];
    assert.equal(pool.noun.one, want.noun, `${type} noun`);
    assert.ok(pool.noun.many.startsWith(want.noun.slice(0, -1)), `${type} plural ${pool.noun.many}`);
    assert.equal(pool.order, want.order, `${type} order`);
    assert.deepEqual(pool.moves, { pin: true, drag: true, archive: true, make: want.make }, `${type} moves`);
  }
  assert.deepEqual(TYPE_CONFIG.explainers.pool.noun, { one: 'topic', many: 'topics' });
  assert.deepEqual(TYPE_CONFIG.reel_ai_drama.pool.noun, { one: 'pitch', many: 'pitches' });
  assert.deepEqual(TYPE_CONFIG.carousels.pool.noun, { one: 'story', many: 'stories' });
});

const idea = (over: Partial<HubIdea> = {}): HubIdea => ({
  id: 'i1', vertical: 'explainers', title: 'What is a webhook?', score: 0.8, scoreLabel: '', state: 'idea_only', hasContent: false,
  versionCount: 0, generatedAt: null, createdAt: '2026-11-10T12:00:00Z', detail: null, ...over,
});

const run = (state: 'queued' | 'running' | 'failed', error: string | null = null) => ({ state, stage: null, error, requestedAt: '2026-11-15T10:00:00Z', startedAt: null });

test('poolRowState: queued/running → making, failed → failed, idea_only → idea', () => {
  assert.equal(poolRowState(idea()), 'idea');
  assert.equal(poolRowState(idea({ run: run('queued') })), 'making');
  assert.equal(poolRowState(idea({ run: run('running') })), 'making');
  assert.equal(poolRowState(idea({ run: run('failed', 'Worker restarted') })), 'failed');
  // A failed run outranks the idea's own state; a stale run row on a made idea still shows its run.
  assert.equal(poolRowState(idea({ state: 'content_ready', run: run('failed') })), 'failed');
  assert.equal(poolRowState(idea({ state: 'content_ready' })), 'ready');
  assert.equal(poolRowState(idea({ state: 'on_deck' })), 'scheduled');
  assert.equal(poolRowState(idea({ state: 'published' })), 'posted');
  assert.equal(poolRowState(idea({ run: null })), 'idea');
});

const post = (over: Partial<HubPost> = {}): HubPost => ({
  id: 'p1', vertical: 'explainers', format: 'reel', name: 'What is a webhook?', description: null, status: 'ready', statusNote: null,
  postedAt: null, publishAt: null, nyDate: null, slot: null, permalink: null, pipelineHref: '/explainers', media: { kind: 'video', src: '/v.mp4' },
  costMicros: null, costNote: null, metrics: {}, history: [], native: [], factorValues: {}, approval: { required: false, approvedAt: '2026-11-15T00:00:00Z', note: null },
  idea: { id: 'i1', label: 'x' }, generatedAt: '2026-11-14T08:00:00Z', versions: [], sources: [], costItemKey: null, refs: {}, ...over,
});

test('madeRowState: approval waiting → needs_you, booked → scheduled, posted → posted, publish failed → failed, else ready', () => {
  const now = new Date('2026-11-15T17:00:00Z');
  const waiting = { required: true, approvedAt: null, note: null };
  assert.equal(madeRowState(post({ status: 'ready', approval: waiting }), now), 'needs_you');
  assert.equal(madeRowState(post({ status: 'scheduled', approval: waiting, publishAt: '2026-11-16T00:00:00Z' }), now), 'needs_you');
  assert.equal(madeRowState(post({ status: 'scheduled', publishAt: '2026-11-16T00:00:00Z' }), now), 'scheduled');
  assert.equal(madeRowState(post({ status: 'publishing' }), now), 'scheduled');
  assert.equal(madeRowState(post({ status: 'published', postedAt: '2026-11-15T12:00:00Z' }), now), 'posted');
  assert.equal(madeRowState(post({ status: 'failed', statusNote: 'Instagram said no: (#9007) media not ready' }), now), 'failed');
  assert.equal(madeRowState(post({ status: 'ready' }), now), 'ready');
  assert.equal(madeRowState(post({ status: 'cancelled' }), now), 'ready');
  assert.equal(madeRowState(post({ status: 'generating', generatedAt: null }), now), 'making');
  // Without a clock: a required approval not given still reads as Needs you.
  assert.equal(madeRowState(post({ status: 'ready', approval: waiting })), 'needs_you');
  assert.equal(madeRowState(post({ status: 'scheduled' })), 'scheduled');
});

test('one word per state, and no word is an error', () => {
  const want: Record<PoolRowState, string> = {
    idea: 'Idea', making: 'Making', failed: 'Failed, try again', ready: 'Ready', scheduled: 'Scheduled', needs_you: 'Needs you', posted: 'Published',
  };
  assert.deepEqual({ ...POOL_STATE_WORDS }, want);
});

test('freshness comes from lead days: made ahead → evergreen, same day → time_sensitive; Stories by series', () => {
  const evergreen: Vertical[] = ['reels', 'explainers', 'reel_ai_drama', 'field_notes'];
  const timely: Vertical[] = ['carousels', 'last_few_days', 'ai_events', 'stories'];
  for (const t of evergreen) assert.equal(poolFreshness(t), 'evergreen', t);
  for (const t of timely) assert.equal(poolFreshness(t), 'time_sensitive', t);
  for (const t of TYPES) assert.equal(poolFreshness(t) === 'evergreen', leadDaysFor(t) > 0, t);
  assert.equal(poolFreshness('stories', 'guess_the_number'), 'evergreen');
  assert.equal(poolFreshness('stories', 'Free vs. Paid'), 'evergreen');
  assert.equal(poolFreshness('stories', 'Morning Download'), 'time_sensitive');
  assert.equal(poolFreshness('stories', 'morning_download'), 'time_sensitive');
  assert.equal(storySeriesOf('Guess the Number'), 'guess_the_number');
  assert.equal(storySeriesOf('Nope'), null);
});
