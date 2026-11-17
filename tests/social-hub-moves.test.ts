/**
 * The moves helpers a night worker reads, pure and offline: Stories rank per
 * series on the day's ranking; orderTonight and tonightMoves; ideaRef.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubIdea } from '@/lib/social-hub/types';
import { dayRanking } from '@/lib/social-hub/views/day-rank';
import { ideaRef, orderTonight, tonightMoves, type IdeaAdjustment } from '@/lib/social-hub/views/moves';

const mv = (vertical: IdeaAdjustment['vertical'], ideaId: string, kind: 'promote' | 'demote', createdAt: string): IdeaAdjustment =>
  ({ id: `${ideaId}-${kind}-${createdAt}`, vertical, ideaId, nyDate: createdAt.slice(0, 10), kind, createdAt });

const story = (series: string, group: string, key: string, score: number): HubIdea => ({
  id: `stories:pool:${series}:${key}`, vertical: 'stories', title: key, score, scoreLabel: 'Score', state: 'idea_only',
  hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null, group,
});

test('dayRanking ranks Stories per series: each series’ promote leads its own series', () => {
  const ideas = [story('free_vs_paid', 'Free vs Paid', 'k0', 9), story('free_vs_paid', 'Free vs Paid', 'k1', 5), story('morning_download', 'Morning Download', 'm0', 9), story('morning_download', 'Morning Download', 'm1', 5)];
  const moves = [mv('stories', 'stories:pool:free_vs_paid:k1', 'promote', '2026-10-12T10:00:00Z'), mv('stories', 'stories:pool:morning_download:m1', 'promote', '2026-10-12T11:00:00Z')];
  const ranked = dayRanking(ideas, 'stories', moves).map((r) => [r.idea.title, r.rank]);
  assert.deepEqual(ranked, [['k1', 1], ['k0', 2], ['m1', 1], ['m0', 2]]);
});

test('orderTonight works on any list by id; tonightMoves gives both halves', () => {
  const rows = [{ topicId: 't1' }, { topicId: 't2' }, { topicId: 't3' }];
  const ordered = orderTonight(rows, (r) => `last_few_days:story:${r.topicId}`, new Set(['last_few_days:story:t3']), new Set(['last_few_days:story:t1']));
  assert.deepEqual(ordered.map((r) => r.topicId), ['t3', 't2', 't1']);
  // An ordered list of pins keeps its own order (the order pinned), not the list's.
  assert.deepEqual(orderTonight(rows, (r) => `last_few_days:story:${r.topicId}`, ['last_few_days:story:t3', 'last_few_days:story:t2'], new Set()).map((r) => r.topicId), ['t3', 't2', 't1']);
  const t = tonightMoves([mv('last_few_days', 'last_few_days:story:t3', 'promote', '2026-10-12T10:00:00Z'), mv('last_few_days', 'last_few_days:story:t1', 'demote', '2026-10-12T11:00:00Z')], 'last_few_days');
  assert.equal(t.promote?.ideaId, 'last_few_days:story:t3');
  assert.deepEqual([...t.demoted], ['last_few_days:story:t1']);
});

test('ideaRef strips the type and kind, keeping colons in the ref', () => {
  assert.equal(ideaRef('reels:idea:0000-aaaa'), '0000-aaaa');
  assert.equal(ideaRef('carousels:story:https://www.theverge.com/a:b'), 'https://www.theverge.com/a:b');
  assert.equal(ideaRef('explainers:topic:t1'), 't1');
});
