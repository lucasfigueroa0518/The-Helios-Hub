/**
 * Shared queue, the page, pure and offline: the queue's tags on the ranking and
 * Today's candidates, and the pool, which puts pinned ideas first (an old
 * Promote counts as a pin), an old Demote last, and is otherwise in score order.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubIdea } from '@/lib/social-hub/types';
import { dayRanking, quotaCandidates } from '@/lib/social-hub/views/day-rank';
import type { IdeaAdjustment } from '@/lib/social-hub/views/moves';
import { poolList } from '@/lib/social-hub/views/pools';

const NOW = new Date('2026-10-14T15:00:00Z'); // 11 AM New York

const idea = (n: number, score: number): HubIdea => ({
  id: `reels:idea:${n}`, vertical: 'reels', title: `Idea ${n}`, score, scoreLabel: 'Net', state: 'idea_only',
  hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null,
});
const IDEAS = [idea(1, 4), idea(2, 3), idea(3, 2), idea(4, 1)];
const mv = (n: number, kind: 'promote' | 'demote', createdAt: string, over: Partial<IdeaAdjustment> = {}): IdeaAdjustment =>
  ({ id: `m${n}${kind}`, vertical: 'reels', ideaId: `reels:idea:${n}`, nyDate: createdAt.slice(0, 10), kind, createdAt, ...over });
const MOVES = [mv(3, 'promote', '2026-10-13T12:00:00.000Z'), mv(4, 'promote', '2026-10-13T13:00:00.000Z'), mv(1, 'demote', '2026-10-13T14:00:00.000Z')];
test('the ranking and Today’s candidates carry the tag', () => {
  const ranked = dayRanking(IDEAS, 'reels', MOVES, NOW);
  assert.deepEqual(ranked.map((r) => [r.idea.title, r.tag?.text ?? null]), [['Idea 3', 'Pinned'], ['Idea 4', 'Pinned'], ['Idea 2', null], ['Idea 1', 'Demoted']]);
  const cards = quotaCandidates({ posts: [], ideas: IDEAS, adjustments: MOVES, dayQuotas: { reels: 2, carousels: 2, explainers: 1 } }, 'reels', NOW);
  assert.deepEqual(cards.map((c) => [c.idea?.title, c.tag?.text ?? null]), [['Idea 3', 'Pinned'], ['Idea 4', 'Pinned']]);
});

test('the pool puts pinned ideas first, in the order pinned, an old Demote row last; otherwise score order', () => {
  assert.deepEqual(poolList(IDEAS, 'reels', 'open').map((i) => i.title), ['Idea 1', 'Idea 2', 'Idea 3', 'Idea 4']);
  assert.deepEqual(poolList(IDEAS, 'reels', 'open', MOVES).map((i) => i.title), ['Idea 3', 'Idea 4', 'Idea 2', 'Idea 1']);
});

test('a promote whose idea is gone does not hide the present one: it is Pinned', () => {
  const moves = [mv(9, 'promote', '2026-10-13T10:00:00.000Z'), mv(4, 'promote', '2026-10-13T13:00:00.000Z')];
  const ranked = dayRanking(IDEAS, 'reels', moves, NOW);
  assert.equal(ranked.find((r) => r.idea.id === 'reels:idea:4')?.tag?.text, 'Pinned');
});
