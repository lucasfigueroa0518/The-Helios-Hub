// lib/publishing/actions/last-few-days.ts
import type { Placement, PlacementOutcome, PlacementTarget } from '@/lib/social-hub/placement';
import type { Query } from '@/lib/social/store/pg';

import { deleteVerb } from './delete';
import { need, needPlacement, type ActionInput, type ActionOutcome, type ActionTarget, type ContentActions } from './types';

type Placed = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string };
type Queued = { queued: boolean; note?: string };
type Place = (q: Query, input: PlacementTarget & Placement) => Promise<PlacementOutcome>;

const REJECTED_NOTE = 'This post was rejected, so it can’t be approved or published. Its stories are back in the pool.';

/**
 * Last Few Days (lib/lfd/schedule.ts): approve (approved and booked in its
 * day's window or the next one), reject, Publish now, unschedule, delete, and
 * place or move on the calendar (D50). No regenerate: a post is a whole run's
 * work; the type page's "Make Last Few Days now" makes a new one. A rejected
 * post (lfd.posts.status 'rejected') is refused by approve and Publish now.
 */
export function lastFewDaysActions(deps: {
  query: () => Promise<Query>;
  approvePost: (q: Query, postId: string) => Promise<Placed>;
  rejectPost: (q: Query, postId: string, by: string | null) => Promise<boolean>;
  hardPublishPost: (q: Query, postId: string) => Promise<Queued>;
  unschedulePost: (q: Query, postId: string) => Promise<{ ok: boolean; note: string }>;
  itemId: (q: Query, postId: string) => Promise<string | null>;
  placeItem: Place;
  rescheduleItem: Place;
}): ContentActions {
  async function placement(t: ActionTarget, input: ActionInput | undefined, fn: Place): Promise<ActionOutcome> {
    const at = needPlacement(input);
    const q = await deps.query();
    const itemId = await deps.itemId(q, need(t, 'lfdPostId'));
    if (!itemId) return { ok: false, note: 'The post is gone.' };
    return fn(q, { vertical: 'last_few_days', itemId, ...at });
  }
  const isRejected = async (q: Query, postId: string) =>
    (await q(`SELECT status FROM lfd.posts WHERE id = $1`, [postId])).rows[0]?.status === 'rejected';
  return {
    vertical: 'last_few_days',
    async approve(t) {
      const q = await deps.query();
      const postId = need(t, 'lfdPostId');
      if (await isRejected(q, postId)) return { ok: false, note: REJECTED_NOTE, status: 409 };
      const placed = await deps.approvePost(q, postId);
      return placed.scheduled ? { ok: true, note: `Approved and scheduled for ${placed.publishAt}.` } : { ok: false, note: placed.note };
    },
    async reject(t, by) {
      return (await deps.rejectPost(await deps.query(), need(t, 'lfdPostId'), by)) ? { ok: true, note: 'Rejected. It will not post.' } : { ok: false, note: 'The post is gone.' };
    },
    async publishNow(t) {
      const q = await deps.query();
      const postId = need(t, 'lfdPostId');
      if (await isRejected(q, postId)) return { ok: false, note: REJECTED_NOTE, status: 409 };
      const out = await deps.hardPublishPost(q, postId);
      return out.queued ? { ok: true, note: 'Queued to publish now.' } : { ok: false, note: out.note ?? 'Not queued.' };
    },
    async unschedule(t) {
      const out = await deps.unschedulePost(await deps.query(), need(t, 'lfdPostId'));
      return out.ok ? { ok: true, note: out.note } : { ok: false, note: out.note, status: 409 };
    },
    delete: deleteVerb({ refKey: 'lfdPostId', query: deps.query as never, itemOf: (q, postId) => deps.itemId(q as Query, postId) }),
    place: (t, _by, input) => placement(t, input, deps.placeItem),
    reschedule: (t, _by, input) => placement(t, input, deps.rescheduleItem),
  };
}
