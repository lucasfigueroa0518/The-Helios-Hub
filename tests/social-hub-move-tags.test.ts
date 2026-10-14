/**
 * Shared queue, the page (spec 2026-10-14 §7), pure and offline: one tag per
 * moved idea ("Tonight", "Promoted · waiting", "Can’t be made: …" for a skip
 * from today's night, "Demoted"), on the ranking, Today's candidates and the
 * pool, which puts the promote first and demoted last and is otherwise in
 * score order.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubIdea } from '@/lib/social-hub/types';
import { dayRanking, quotaCandidates } from '@/lib/social-hub/views/day-rank';
import { moveTags, type IdeaAdjustment } from '@/lib/social-hub/views/moves';
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
const text = (tags: Map<string, { text: string }>, n: number) => tags.get(`reels:idea:${n}`)?.text ?? null;

test('one tag per moved idea: Tonight, Promoted · waiting, Demoted', () => {
  const tags = moveTags(MOVES, 'reels', NOW);
  assert.deepEqual([1, 2, 3, 4].map((n) => text(tags, n)), ['Demoted', null, 'Tonight', 'Promoted · waiting']);
  assert.equal(moveTags(MOVES, 'carousels', NOW).size, 0, 'per type');
});

test('a recorded skip reads “Can’t be made” and steps aside; the next promote is Tonight', () => {
  const reason = 'It isn’t in the reels pool any more.';
  const skipped = mv(3, 'promote', '2026-10-13T12:00:00.000Z', { skipReason: reason, skippedAt: '2026-10-14T05:20:00.000Z' });
  const tags = moveTags([skipped, mv(4, 'promote', '2026-10-13T13:00:00.000Z')], 'reels', NOW);
  assert.deepEqual(tags.get('reels:idea:3'), { kind: 'cant', text: `Can’t be made: ${reason}` });
  assert.deepEqual(tags.get('reels:idea:4'), { kind: 'tonight', text: 'Tonight' });
  const later = moveTags([skipped], 'reels', new Date('2026-10-16T15:00:00Z'));
  assert.equal(later.get('reels:idea:3')?.kind, 'cant', 'stays until a person re-promotes or demotes it');
  const repromoted = moveTags([skipped, mv(3, 'promote', '2026-10-14T14:00:00.000Z')], 'reels', NOW);
  assert.equal(repromoted.get('reels:idea:3')?.kind, 'tonight');
});

test('Stories: one Tonight per series', () => {
  const s = (series: string, n: number, at: string): IdeaAdjustment =>
    ({ id: `s${series}${n}`, vertical: 'stories', ideaId: `stories:pool:${series}:${n}`, nyDate: '2026-10-13', kind: 'promote', createdAt: at });
  const tags = moveTags([s('a', 1, '2026-10-13T10:00:00Z'), s('a', 2, '2026-10-13T11:00:00Z'), s('b', 1, '2026-10-13T12:00:00Z')], 'stories', NOW);
  assert.deepEqual(['a:1', 'a:2', 'b:1'].map((k) => tags.get(`stories:pool:${k}`)?.text), ['Tonight', 'Promoted · waiting', 'Tonight']);
});

test('the ranking and Today’s candidates carry the tag', () => {
  const ranked = dayRanking(IDEAS, 'reels', MOVES, NOW);
  assert.deepEqual(ranked.map((r) => [r.idea.title, r.tag?.text ?? null]), [['Idea 3', 'Tonight'], ['Idea 2', null], ['Idea 4', 'Promoted · waiting'], ['Idea 1', 'Demoted']]);
  const cards = quotaCandidates({ posts: [], ideas: IDEAS, adjustments: MOVES, dayQuotas: { reels: 2, carousels: 2, explainers: 1 } }, 'reels', NOW);
  assert.deepEqual(cards.map((c) => [c.idea?.title, c.tag?.text ?? null]), [['Idea 3', 'Tonight'], ['Idea 2', null]]);
});

test('the pool puts the promote first and demoted last; otherwise score order (L2)', () => {
  assert.deepEqual(poolList(IDEAS, 'reels', 'open').map((i) => i.title), ['Idea 1', 'Idea 2', 'Idea 3', 'Idea 4']);
  assert.deepEqual(poolList(IDEAS, 'reels', 'open', MOVES).map((i) => i.title), ['Idea 3', 'Idea 2', 'Idea 4', 'Idea 1']);
});
