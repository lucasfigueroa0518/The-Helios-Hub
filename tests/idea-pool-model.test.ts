/**
 * The content type page's model reads the queue (idea pool standard, 2026-10-21): pins lead and carry their flag,
 * a dragged idea sits where it was dropped, an archived idea is gone from the bench and the day's slots, and
 * today's slots are the top of the queue (an empty slot for an idea with nothing made).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { typeHubModel } from '@/lib/content-type/model';
import type { IdeaAdjustment } from '@/lib/social-hub/views/moves';

import { FIXTURE_NOW, previewDataset } from './fixtures/social-hub/preview-dataset';

const base = previewDataset();
const open = typeHubModel(base, 'explainers', FIXTURE_NOW).bench.map((b) => b.idea);
const withMoves = (adjustments: IdeaAdjustment[]) => typeHubModel({ ...base, adjustments }, 'explainers', FIXTURE_NOW);
let n = 0;
const move = (ideaId: string, kind: IdeaAdjustment['kind'], extra: Partial<IdeaAdjustment> = {}): IdeaAdjustment => ({
  id: `m${++n}`, vertical: 'explainers', ideaId, nyDate: '2026-10-08', kind, createdAt: new Date(Date.UTC(2026, 9, 8, 12, 0, n)).toISOString(), ...extra,
});
const titles = (m: ReturnType<typeof withMoves>) => m.bench.map((b) => b.idea.title);

test('there are enough ideas to move around', () => assert.ok(open.length >= 4));

test('a pin leads the bench, carries its flag and chip, and takes the first slot', () => {
  const last = open.at(-1)!;
  const m = withMoves([move(last.id, 'pin')]);
  assert.equal(m.bench[0]!.idea.id, last.id);
  assert.equal(m.bench[0]!.pinned, true);
  assert.equal(m.bench[0]!.tag?.text, 'Pinned');
  assert.equal(m.slots[0]!.idea?.id, last.id);
  assert.equal(m.slots[0]!.rank, 1);
});

test('a dragged idea sits at its key among the others, flagged Placed', () => {
  const [a, b, , d] = open;
  const key = ((b!.score ?? 0) + (d!.score ?? 0)) / 2;
  const m = withMoves([move(a!.id, 'place', { sortKey: key })]);
  const order = m.bench.map((x) => x.idea.id);
  assert.ok(order.indexOf(a!.id) > order.indexOf(b!.id));
  assert.equal(m.bench.find((x) => x.idea.id === a!.id)!.placed, true);
  assert.equal(m.bench.find((x) => x.idea.id === a!.id)!.tag?.text, 'Placed');
});

test('an archived idea is gone from the bench, the count and the slots', () => {
  const gone = open[0]!;
  const m = withMoves([move(gone.id, 'archive')]);
  assert.ok(!titles(m).includes(gone.title));
  assert.equal(m.benchTotal, open.length - 1);
  assert.ok(m.slots.every((s) => s.idea?.id !== gone.id));
});

test('a type with no idea queue of its own (Stories) has no slots', () => {
  assert.deepEqual(typeHubModel(base, 'stories', FIXTURE_NOW).slots, []);
});

test('a regenerated idea lists its made versions newest first, and the older one is not a second bench row', () => {
  const ready = base.posts.find((p) => p.vertical === 'explainers' && p.status === 'ready' && p.idea?.id);
  assert.ok(ready, 'the fixture has a ready explainer');
  const made = (id: string, at: string, src: string) => ({ ...ready!, id, generatedAt: at, media: { kind: 'video' as const, src }, nyDate: null, slot: null });
  const posts = [...base.posts.filter((p) => p.id !== ready!.id), made('explainers:job-new', '2026-10-08T11:00:00Z', 'new.mp4'), made('explainers:job-old', '2026-10-01T11:00:00Z', 'old.mp4')];
  const m = typeHubModel({ ...base, posts }, 'explainers', FIXTURE_NOW);
  assert.deepEqual(m.versions[ready!.idea!.id]!.map((c) => c.post.id), ['explainers:job-new', 'explainers:job-old']);
  assert.ok(!m.bench.some((b) => b.card?.post.id === 'explainers:job-old'), 'the older version is history');
  const one = typeHubModel({ ...base, posts: [...base.posts.filter((p) => p.id !== ready!.id), made('explainers:job-new', '2026-10-08T11:00:00Z', 'new.mp4')] }, 'explainers', FIXTURE_NOW);
  assert.equal(one.versions[ready!.idea!.id], undefined, 'one version has no toggle');
});

test('a type whose night does not follow the queue yet keeps Promote and Demote: one promote a night, demotes last', async () => {
  const { dayRanking } = await import('@/lib/social-hub/views/day-rank');
  const { poolList } = await import('@/lib/social-hub/views/pools');
  const idea = (n: number, score: number) => ({ id: `last_few_days:story:${n}`, vertical: 'last_few_days' as const, title: `Story ${n}`, score, scoreLabel: 'Score', state: 'idea_only' as const, hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null });
  const ideas = [idea(1, 4), idea(2, 3), idea(3, 2), idea(4, 1)];
  const mv = (n: number, kind: 'promote' | 'demote', at: string): IdeaAdjustment => ({ id: `c${n}${kind}`, vertical: 'last_few_days', ideaId: `last_few_days:story:${n}`, nyDate: '2026-10-08', kind, createdAt: at });
  const moves = [mv(3, 'promote', '2026-10-08T01:00:00Z'), mv(4, 'promote', '2026-10-08T02:00:00Z'), mv(1, 'demote', '2026-10-08T03:00:00Z')];
  const order = dayRanking(ideas, 'last_few_days', moves, FIXTURE_NOW).map((r) => r.idea.title);
  assert.deepEqual(order, ['Story 3', 'Story 2', 'Story 4', 'Story 1']);
  assert.deepEqual(poolList(ideas, 'last_few_days', 'open', moves).map((i) => i.title), order);
  assert.equal(dayRanking(ideas, 'last_few_days', moves, FIXTURE_NOW)[0]!.tag?.text, 'Tonight');
});

test('the page shows at most 30 open ideas; pinned, dragged, yours and made ideas are never cut', async () => {
  const { poolList } = await import('@/lib/social-hub/views/pools');
  const { dayRanking } = await import('@/lib/social-hub/views/day-rank');
  const idea = (n: number, over: Record<string, unknown> = {}) => ({ id: `reels:idea:${String(n).padStart(3, '0')}`, vertical: 'reels' as const, title: `Idea ${n}`, score: 100 - n, scoreLabel: 'Net', state: 'idea_only' as const, hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null, ...over });
  const ideas = Array.from({ length: 36 }, (_, i) => idea(i + 1));
  assert.equal(poolList(ideas, 'reels', 'open').length, 30);
  assert.equal(dayRanking(ideas, 'reels', [], FIXTURE_NOW).length, 30);
  const pin: IdeaAdjustment = { id: 'p', vertical: 'reels', ideaId: 'reels:idea:036', nyDate: '2026-10-08', kind: 'pin', createdAt: '2026-10-08T01:00:00.000Z' };
  const place: IdeaAdjustment = { id: 'q', vertical: 'reels', ideaId: 'reels:idea:035', nyDate: '2026-10-08', kind: 'place', createdAt: '2026-10-08T02:00:00.000Z', sortKey: 10 };
  const shown = poolList(ideas, 'reels', 'open', [pin, place]).map((i) => i.title);
  assert.equal(shown.length, 30, 'a pin and a placement take two places in the 30 they already count toward');
  assert.ok(shown.includes('Idea 36') && shown.includes('Idea 35'));
  const protectedAll = ideas.map((i, n) => (n >= 30 ? { ...i, yours: true } : n === 29 ? { ...i, hasContent: true, state: 'content_ready' as const } : i));
  assert.equal(poolList(protectedAll, 'reels', 'open').length, 30 + 0, '30 unprotected-or-protected slots: protected ideas displace the lowest unprotected ones, never each other');
  assert.equal(poolList(ideas, 'reels', 'all').length, 36, 'Everything shows every idea');
});
