import assert from 'node:assert/strict';
import test from 'node:test';

import { poolLead } from '@/lib/social-hub/queue';
import type { HubIdea, Vertical } from '@/lib/social-hub/types';
import { poolList } from '@/lib/social-hub/views/pools';

function idea(id: string, vertical: Vertical, over: Partial<HubIdea> = {}): HubIdea {
  return {
    id, vertical, title: id, score: 1, scoreLabel: 'Score', breakdown: null, state: 'idea_only',
    hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null, ...over,
  } as HubIdea;
}

for (const vertical of ['last_few_days', 'reels', 'explainers', 'carousels'] as const) {
  test(`${vertical}: a made idea with a low score leads the pool`, () => {
    const ideas = [
      idea('a', vertical, { score: 9 }),
      idea('b', vertical, { score: 5 }),
      idea('made', vertical, { score: null, state: 'content_ready', hasContent: true, generatedAt: '2026-11-01T10:00:00Z' }),
    ];
    assert.equal(poolList(ideas, vertical, 'open')[0].id, 'made');
  });
}

test('poolLead: newest made first, then the last run picks', () => {
  const lead = poolLead([
    idea('old', 'reels', { state: 'content_ready', hasContent: true, generatedAt: '2026-11-01T08:00:00Z' }),
    idea('new', 'reels', { state: 'content_ready', hasContent: true, generatedAt: '2026-11-01T09:00:00Z' }),
    { ...idea('pick', 'reels'), runPick: 0 } as HubIdea,
  ]);
  assert.deepEqual(lead, ['new', 'old', 'pick']);
});

test('a posted idea is not pulled up', () => {
  const ideas = [idea('a', 'reels', { score: 9 }), idea('posted', 'reels', { score: 1, state: 'published', hasContent: true })];
  assert.equal(poolList(ideas, 'reels', 'all')[0].id, 'a');
});
