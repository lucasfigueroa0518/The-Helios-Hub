// lib/publishing/actions/ai-events.ts
import type { Placement, PlacementOutcome, PlacementTarget } from '@/lib/social-hub/placement';
import type { Query } from '@/lib/social/store/pg';

import { deleteVerb } from './delete';
import { need, needPlacement, type ActionInput, type ActionOutcome, type ActionTarget, type ContentActions } from './types';

type Placed = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string; approved?: true };
type Queued = { queued: boolean; note?: string };
type Place = (q: Query, input: PlacementTarget & Placement & { by?: string }) => Promise<PlacementOutcome>;

const REJECTED_NOTE = 'This post was rejected, so it can’t be approved, published or rebuilt. Generate makes a new one for its week.';
const PUBLISHING_OFF_NOTE = 'AI Events publishing is off. Turn it on before publishing.';
const PUBLISHED_NOTE = 'This post is already published, so it isn’t rebuilt.';

/**
 * AI Events This Week (lib/ai-events/schedule.ts): approve (approved, and
 * booked in its own Sunday's 6–7 PM window while ai_events publishing_live
 * is on; otherwise approved without a slot), reject, Publish now (refused
 * while publishing is off), unschedule, delete, place or move on the
 * calendar (D50), and regenerate, which is Rebuild post (AE-04): a queued
 * rebuild of the post's week from the pool and the cached scores, with the
 * person's pins and excludes. The social worker carries it out; no model is
 * called. A rejected post is refused by approve, Publish now and Rebuild.
 */
export function aiEventsActions(deps: {
  query: () => Promise<Query>;
  approvePost: (q: Query, postId: string) => Promise<Placed>;
  rejectPost: (q: Query, postId: string, by: string | null) => Promise<boolean>;
  hardPublishPost: (q: Query, postId: string) => Promise<Queued>;
  /** ai_events.settings publishing_live: Publish now is refused while it is off. */
  publishingLive: (q: Query) => Promise<boolean>;
  unschedulePost: (q: Query, postId: string) => Promise<{ ok: boolean; note: string }>;
  /** Queue a rebuild of the week (lib/ai-events/manual.ts queueAiEventsRun with kind 'rebuild'). */
  queueRebuild: (q: Query, o: { requestedBy: string; weekKey: string }) => Promise<{ ok: boolean; note: string }>;
  itemId: (q: Query, postId: string) => Promise<string | null>;
  placeItem: Place;
  rescheduleItem: Place;
}): ContentActions {
  async function placement(t: ActionTarget, input: ActionInput | undefined, fn: Place, by?: string): Promise<ActionOutcome> {
    const at = needPlacement(input);
    const q = await deps.query();
    const itemId = await deps.itemId(q, need(t, 'aiEventsPostId'));
    if (!itemId) return { ok: false, note: 'The post is gone.' };
    return fn(q, { vertical: 'ai_events', itemId, ...at, ...(by ? { by } : {}) });
  }
  const postOf = async (q: Query, postId: string) =>
    (await q(`SELECT status, week_key FROM ai_events.posts WHERE id = $1`, [postId])).rows[0] as { status: string; week_key: string } | undefined;
  return {
    vertical: 'ai_events',
    async approve(t) {
      const q = await deps.query();
      const postId = need(t, 'aiEventsPostId');
      if ((await postOf(q, postId))?.status === 'rejected') return { ok: false, note: REJECTED_NOTE, status: 409 };
      const placed = await deps.approvePost(q, postId);
      if (placed.scheduled) return { ok: true, note: `Approved and scheduled for ${placed.publishAt}.` };
      return placed.approved ? { ok: true, note: placed.note } : { ok: false, note: placed.note };
    },
    async reject(t, by) {
      return (await deps.rejectPost(await deps.query(), need(t, 'aiEventsPostId'), by)) ? { ok: true, note: 'Rejected. It will not post.' } : { ok: false, note: 'The post is gone.' };
    },
    async publishNow(t) {
      const q = await deps.query();
      const postId = need(t, 'aiEventsPostId');
      if ((await postOf(q, postId))?.status === 'rejected') return { ok: false, note: REJECTED_NOTE, status: 409 };
      if (!(await deps.publishingLive(q).catch(() => false))) return { ok: false, note: PUBLISHING_OFF_NOTE, status: 409 };
      const out = await deps.hardPublishPost(q, postId);
      return out.queued ? { ok: true, note: 'Queued to publish now.' } : { ok: false, note: out.note ?? 'Not queued.' };
    },
    async regenerate(t, by) {
      const q = await deps.query();
      const post = await postOf(q, need(t, 'aiEventsPostId'));
      if (!post) return { ok: false, note: 'The post is gone.' };
      if (post.status === 'rejected') return { ok: false, note: REJECTED_NOTE, status: 409 };
      if (post.status === 'published') return { ok: false, note: PUBLISHED_NOTE, status: 409 };
      const out = await deps.queueRebuild(q, { requestedBy: by, weekKey: post.week_key });
      return out.ok ? out : { ok: false, note: out.note, status: 409 };
    },
    async unschedule(t) {
      const out = await deps.unschedulePost(await deps.query(), need(t, 'aiEventsPostId'));
      return out.ok ? { ok: true, note: out.note } : { ok: false, note: out.note, status: 409 };
    },
    delete: deleteVerb({ refKey: 'aiEventsPostId', query: deps.query as never, itemOf: (q, postId) => deps.itemId(q as Query, postId) }),
    place: (t, by, input) => placement(t, input, deps.placeItem, by),
    reschedule: (t, by, input) => placement(t, input, deps.rescheduleItem, by),
  };
}
