/**
 * Regenerate takes the version it replaces off the calendar and out of approval (idea pool standard, 2026-10-21), for
 * Carousels and Trial Reels, once the new one is accepted; a refusal changes nothing. (Explainers: explainers-regenerate-unschedules.)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { carouselActions } from '@/lib/publishing/actions/carousels';
import { reelActions } from '@/lib/publishing/actions/reels';

test('Carousels: an accepted rerun unschedules the old post; a refused one leaves it', async () => {
  const calls: string[] = [];
  const make = (queued: boolean) => carouselActions({
    query: async () => ({}) as never,
    requestRerun: async () => (queued ? { queued: true as const, id: 'r' } : { queued: false as const, note: 'A rerun is already queued.' }),
    unschedulePost: async (_q: unknown, id: string) => (calls.push(`unschedule ${id}`), { ok: true, note: 'Unscheduled.' }),
  } as never);
  const ok = await make(true).regenerate!({ postId: 'p1' }, 'tommy');
  assert.equal(ok.ok, true);
  assert.match(ok.note, /unscheduled and no longer approved/);
  const refused = await make(false).regenerate!({ postId: 'p2' }, 'tommy');
  assert.equal(refused.ok, false);
  assert.deepEqual(calls, ['unschedule p1']);
});

test('Trial Reels: an accepted rebuild unschedules the old video; a locked or refused one leaves it', async () => {
  const calls: string[] = [];
  const make = (over: Record<string, unknown> = {}) => reelActions({
    todaySlate: async () => 'slate',
    findReelLock: async () => null,
    requestFinish: async () => ({ status: 'queued', note: 'Queued.' }),
    unscheduleIdea: async (id: string) => (calls.push(`unschedule ${id}`), { ok: true, note: 'Unscheduled.' }),
    ...over,
  } as never);
  const ok = await make().regenerate!({ postIdeaId: 'i1' }, 'tommy');
  assert.equal(ok.ok, true);
  assert.match(ok.note, /unscheduled and no longer approved/);
  assert.equal((await make({ findReelLock: async () => ({ nyDate: '2026-10-08' }) }).regenerate!({ postIdeaId: 'i2' }, 't')).ok, false);
  assert.equal((await make({ requestFinish: async () => ({ status: 'failed', note: 'No.' }) }).regenerate!({ postIdeaId: 'i3' }, 't')).ok, false);
  assert.deepEqual(calls, ['unschedule i1']);
});
