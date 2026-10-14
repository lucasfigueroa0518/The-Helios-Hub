/**
 * The shared queue's rule (spec 2026-10-14-shared-queue-design.md §1), pure
 * and offline: one promote a night per type, oldest first; the latest move on
 * an idea wins; Demote sinks below every other idea; Stories queue per series.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubIdea } from '@/lib/social-hub/types';
import { dayRanking } from '@/lib/social-hub/views/day-rank';
import {
  applyMoves,
  demotedIds,
  ideaRef,
  orderTonight,
  tonightMoves,
  tonightPromote,
  tonightPromotes,
  type IdeaAdjustment,
} from '@/lib/social-hub/views/moves';

const mv = (vertical: IdeaAdjustment['vertical'], ideaId: string, kind: 'promote' | 'demote', createdAt: string): IdeaAdjustment =>
  ({ id: `${ideaId}-${kind}-${createdAt}`, vertical, ideaId, nyDate: createdAt.slice(0, 10), kind, createdAt });
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((x) => x.id);
const LIST = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

test('one promote a night per type: the oldest goes first; the others wait in their score place', () => {
  const moves = [mv('reels', 'c', 'promote', '2026-10-12T10:00:00Z'), mv('reels', 'e', 'promote', '2026-10-13T10:00:00Z')];
  assert.equal(tonightPromote(moves, 'reels')?.ideaId, 'c');
  assert.deepEqual(ids(applyMoves(LIST, moves)), ['c', 'a', 'b', 'd', 'e'], 'e waits at its own place');
  assert.equal(tonightPromote(moves, 'carousels'), null, 'per type');
});

test('Review Focus 2: the latest move on an idea wins', () => {
  const sunk = [mv('reels', 'c', 'promote', '2026-10-12T10:00:00Z'), mv('reels', 'c', 'demote', '2026-10-12T11:00:00Z')];
  assert.equal(tonightPromote(sunk, 'reels'), null);
  assert.deepEqual([...demotedIds(sunk, 'reels')], ['c']);
  assert.deepEqual(ids(applyMoves(LIST, sunk)), ['a', 'b', 'd', 'e', 'c'], 'promoted, then demoted: sinks');

  const raised = [mv('reels', 'c', 'demote', '2026-10-12T10:00:00Z'), mv('reels', 'c', 'promote', '2026-10-12T11:00:00Z')];
  assert.equal(tonightPromote(raised, 'reels')?.ideaId, 'c');
  assert.equal(demotedIds(raised, 'reels').size, 0);

  const handedOn = [
    mv('reels', 'a', 'promote', '2026-10-12T10:00:00Z'),
    mv('reels', 'b', 'promote', '2026-10-12T11:00:00Z'),
    mv('reels', 'a', 'demote', '2026-10-12T12:00:00Z'),
  ];
  assert.equal(tonightPromote(handedOn, 'reels')?.ideaId, 'b', 'the oldest promote was taken back: the next one goes');

  const repromoted = [
    mv('reels', 'a', 'promote', '2026-10-12T10:00:00Z'),
    mv('reels', 'b', 'promote', '2026-10-12T11:00:00Z'),
    mv('reels', 'a', 'promote', '2026-10-12T12:00:00Z'),
  ];
  assert.equal(tonightPromote(repromoted, 'reels')?.ideaId, 'b', 'a promote’s place in line is its idea’s latest move');
});

test('Demote sinks below every idea that is not demoted, keeping order among the demoted; a lone demoted idea is still made', () => {
  assert.deepEqual(ids(applyMoves(LIST, [mv('reels', 'a', 'demote', '2026-10-12T10:00:00Z')])), ['b', 'c', 'd', 'e', 'a']);
  assert.deepEqual(
    ids(applyMoves(LIST, [mv('reels', 'b', 'demote', '2026-10-12T10:00:00Z'), mv('reels', 'a', 'demote', '2026-10-12T11:00:00Z')])),
    ['c', 'd', 'e', 'a', 'b'],
  );
  assert.deepEqual(ids(applyMoves([{ id: 'a' }], [{ ideaId: 'a', kind: 'demote' }])), ['a']);
});

test('Stories queue per series: one promote a night in each series', () => {
  const moves = [
    mv('stories', 'stories:pool:free_vs_paid:k1', 'promote', '2026-10-12T10:00:00Z'),
    mv('stories', 'stories:pool:free_vs_paid:k2', 'promote', '2026-10-12T11:00:00Z'),
    mv('stories', 'stories:pool:morning_download:m1', 'promote', '2026-10-12T12:00:00Z'),
  ];
  assert.deepEqual(tonightPromotes(moves).map((m) => m.ideaId), ['stories:pool:free_vs_paid:k1', 'stories:pool:morning_download:m1']);
  const fvp = ['k0', 'k1', 'k2'].map((k) => ({ id: `stories:pool:free_vs_paid:${k}` }));
  assert.deepEqual(ids(applyMoves(fvp, moves)).map((id) => id.split(':').pop()), ['k1', 'k0', 'k2']);
  // The Stories build passes bare pool keys of one series (no vertical): one queue.
  const keys = ['k0', 'k1', 'k2'].map((id) => ({ id }));
  assert.deepEqual(ids(applyMoves(keys, [{ ideaId: 'k2', kind: 'promote' }, { ideaId: 'k1', kind: 'promote' }])), ['k2', 'k0', 'k1']);
});

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
  const ordered = orderTonight(rows, (r) => `explainers:topic:${r.topicId}`, new Set(['explainers:topic:t3']), new Set(['explainers:topic:t1']));
  assert.deepEqual(ordered.map((r) => r.topicId), ['t3', 't2', 't1']);
  const t = tonightMoves([mv('explainers', 'explainers:topic:t3', 'promote', '2026-10-12T10:00:00Z'), mv('explainers', 'explainers:topic:t1', 'demote', '2026-10-12T11:00:00Z')], 'explainers');
  assert.equal(t.promote?.ideaId, 'explainers:topic:t3');
  assert.deepEqual([...t.demoted], ['explainers:topic:t1']);
});

test('ideaRef strips the type and kind, keeping colons in the ref', () => {
  assert.equal(ideaRef('reels:idea:0000-aaaa'), '0000-aaaa');
  assert.equal(ideaRef('carousels:story:https://www.theverge.com/a:b'), 'https://www.theverge.com/a:b');
  assert.equal(ideaRef('explainers:topic:t1'), 't1');
});

const skipped = (m: IdeaAdjustment): IdeaAdjustment => ({ ...m, skipReason: 'no fresh source', skippedAt: '2026-10-13T06:00:00Z' });

test('step aside: a promote with a recorded skip is passed over; the next eligible promote is tonight’s', () => {
  const moves = [skipped(mv('reels', 'c', 'promote', '2026-10-12T10:00:00Z')), mv('reels', 'e', 'promote', '2026-10-13T10:00:00Z')];
  assert.equal(tonightPromote(moves, 'reels')?.ideaId, 'e');
  assert.deepEqual(ids(applyMoves(LIST, moves)), ['e', 'a', 'b', 'c', 'd'], 'the skipped promote waits in its score place, not demoted');
  assert.equal(demotedIds(moves, 'reels').size, 0);
  assert.equal(tonightPromote([moves[0]!], 'reels'), null, 'nothing else eligible');
});

test('step aside: re-promoting a skipped idea (a new latest move, no skip) makes it eligible again', () => {
  const moves = [
    skipped(mv('reels', 'c', 'promote', '2026-10-12T10:00:00Z')),
    mv('reels', 'e', 'promote', '2026-10-13T10:00:00Z'),
    mv('reels', 'c', 'promote', '2026-10-14T10:00:00Z'),
  ];
  assert.equal(tonightPromote(moves, 'reels')?.ideaId, 'e', 'e is older than the fresh c promote');
  const only = [skipped(mv('reels', 'c', 'promote', '2026-10-12T10:00:00Z')), mv('reels', 'c', 'promote', '2026-10-14T10:00:00Z')];
  assert.equal(tonightPromote(only, 'reels')?.ideaId, 'c');
});

test('step aside: Stories apply it per series', () => {
  const moves = [
    skipped(mv('stories', 'stories:pool:free_vs_paid:k1', 'promote', '2026-10-12T10:00:00Z')),
    mv('stories', 'stories:pool:free_vs_paid:k2', 'promote', '2026-10-12T11:00:00Z'),
    skipped(mv('stories', 'stories:pool:morning_download:m1', 'promote', '2026-10-12T12:00:00Z')),
  ];
  assert.deepEqual(tonightPromotes(moves).map((m) => m.ideaId), ['stories:pool:free_vs_paid:k2']);
});
