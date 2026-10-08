import type { Query } from '@/lib/social/store/pg';

import { need, type ActionOutcome, type ContentActions } from './types';

type Queued = { queued: boolean; note?: string; status?: number };
type Placed = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string };

/** Carousels (lib/social/overnight): approve a slot or a post in review, reject, Hard publish. No one-post rerun. */
export function carouselActions(deps: {
  query: () => Promise<Query>;
  approveSchedule: (q: Query, scheduleId: string) => Promise<boolean>;
  approvePost: (q: Query, postId: string) => Promise<Placed>;
  rejectPost: (q: Query, postId: string, by: string | null) => Promise<boolean>;
  hardPublishPost: (q: Query, postId: string) => Promise<Queued>;
}): ContentActions {
  return {
    vertical: 'carousels',
    async approve(t): Promise<ActionOutcome> {
      const q = await deps.query();
      // A slot waiting for approval is approved there; a post in review is placed and approved (P2-M4).
      if (t.scheduleId && !t.attemptId) {
        return (await deps.approveSchedule(q, t.scheduleId)) ? { ok: true, note: 'Approved.' } : { ok: false, note: 'That slot is no longer scheduled.' };
      }
      const placed = await deps.approvePost(q, need(t, 'postId'));
      return placed.scheduled ? { ok: true, note: `Approved and scheduled for ${placed.publishAt}.` } : { ok: false, note: placed.note };
    },
    async reject(t, by) {
      return (await deps.rejectPost(await deps.query(), need(t, 'postId'), by)) ? { ok: true, note: 'Rejected. It will not post.' } : { ok: false, note: 'The post is gone.' };
    },
    async publishNow(t) {
      const out = await deps.hardPublishPost(await deps.query(), need(t, 'postId'));
      return out.queued ? { ok: true, note: 'Queued to publish now.' } : { ok: false, note: out.note ?? 'Not queued.', status: out.status };
    },
  };
}
