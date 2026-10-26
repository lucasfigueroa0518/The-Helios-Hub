import type { Query } from '@/lib/social/store/pg';
import type { Placement, PlacementOutcome, PlacementTarget } from '@/lib/social-hub/placement';

import { deleteVerb } from './delete';
import { need, needPlacement, type ActionOutcome, type ContentActions } from './types';

type Queued = { queued: boolean; note?: string; status?: number };
type Placed = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string };
type Place = (q: Query, input: PlacementTarget & Placement & { by?: string }) => Promise<PlacementOutcome>;

/**
 * Carousels (lib/social/overnight): approve a slot or a post in review, reject,
 * Hard publish, place or move on the calendar (D50), and regenerate: a
 * one-story rerun the helios-social worker carries out (D51).
 */
export function carouselActions(deps: {
  query: () => Promise<Query>;
  approveSchedule: (q: Query, scheduleId: string) => Promise<boolean>;
  approvePost: (q: Query, postId: string) => Promise<Placed>;
  rejectPost: (q: Query, postId: string, by: string | null) => Promise<boolean>;
  hardPublishPost: (q: Query, postId: string) => Promise<Queued>;
  itemId: (q: Query, postId: string) => Promise<string | null>;
  placeItem: Place;
  rescheduleItem: Place;
  unschedulePost: (q: Query, postId: string) => Promise<{ ok: boolean; note: string }>;
  requestRerun: (q: Query, postId: string, by: string) => Promise<{ queued: true; id: string } | { queued: false; note: string }>;
}): ContentActions {
  async function placement(t: Parameters<typeof need>[0], input: Parameters<typeof needPlacement>[0], fn: Place, by?: string): Promise<ActionOutcome> {
    const at = needPlacement(input);
    const q = await deps.query();
    const itemId = await deps.itemId(q, need(t, 'postId'));
    if (!itemId) return { ok: false, note: 'The post is gone.' };
    return fn(q, { vertical: 'carousels', itemId, ...at, ...(by ? { by } : {}) });
  }
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
    async regenerate(t, by) {
      const q = await deps.query();
      const out = await deps.requestRerun(q, need(t, 'postId'), by);
      if (!out.queued) return { ok: false, note: out.note };
      // Idea pool standard (2026-10-21): the version being replaced comes off the calendar and out of approval once the rerun is
      // accepted, so nothing posts what was not reviewed after the regenerate. A refusal changes nothing.
      const off = await deps.unschedulePost(q, need(t, 'postId')).catch(() => null);
      return {
        ok: true,
        note: off?.ok
          ? 'A rerun of this story is queued, under the carousel run cap. The version it replaces is unscheduled and no longer approved; approve the new one when it shows up in Content ready.'
          : 'A rerun of this story is queued, under the carousel run cap. The new version shows up in Content ready when it finishes; this one stays as it is.',
      };
    },
    async unschedule(t) {
      const out = await deps.unschedulePost(await deps.query(), need(t, 'postId'));
      return out.ok ? { ok: true, note: out.note } : { ok: false, note: out.note, status: 409 };
    },
    delete: deleteVerb({ refKey: 'postId', query: deps.query as never, itemOf: (q, postId) => deps.itemId(q as Query, postId) }),
    place: (t, by, input) => placement(t, input, deps.placeItem, by),
    reschedule: (t, by, input) => placement(t, input, deps.rescheduleItem, by),
  };
}
