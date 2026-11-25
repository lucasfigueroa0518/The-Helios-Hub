/**
 * Where a Text on Screen seed (an idea marked `yours`, no video yet) lands on the pool page: after the made ideas and the
 * last run's picks, among the rest by score, and never cut by the 30-idea cap. Offline; real poolList.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubIdea } from '@/lib/social-hub/types';
import { poolList } from '@/lib/social-hub/views/pools';

const idea = (id: string, over: Partial<HubIdea> = {}): HubIdea => ({
  id: `reels:idea:${id}`, vertical: 'reels', title: id, score: 3, scoreLabel: 'Net', breakdown: null, state: 'idea_only',
  hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null, ...over,
} as HubIdea);

const plain = Array.from({ length: 36 }, (_, n) => idea(`plain-${String(n).padStart(2, '0')}`, { score: 4 - n * 0.02 }));
const made = idea('made', { score: 1, state: 'content_ready', hasContent: true, generatedAt: '2026-11-01T10:00:00Z' });
const pick = { ...idea('pick', { score: 2 }), runPick: 0 } as HubIdea;

test('a seed lands after made ideas and last-run picks, in score order among the rest, and is never cut by the cap', () => {
  const high = idea('seed-high', { score: 3.16, yours: true });
  const low = idea('seed-low', { score: 2.77, yours: true });
  const titles = poolList([...plain, made, pick, high, low], 'reels', 'open').map((i) => i.title);
  assert.deepEqual(titles.slice(0, 2), ['made', 'pick'], 'made first, then the last run’s pick');
  assert.ok(titles.indexOf('seed-high') > 1, 'a seed does not jump ahead of made ideas');
  assert.ok(titles.indexOf('seed-high') < titles.indexOf('seed-low'), 'seeds keep score order');
  assert.ok(titles.includes('seed-low'), 'a low-scoring seed below the 30 line is kept (yours is never cut)');
  assert.equal(titles.length, 31 + 1, 'the first 30, plus the one seed that is below the line');
});

test('a plain idea with the same score below the 30 line IS cut; only yours is kept', () => {
  const low = { ...idea('same-score', { score: 2.77 }) };
  const titles = poolList([...plain, made, pick, low], 'reels', 'open').map((i) => i.title);
  assert.ok(!titles.includes('same-score'));
});
