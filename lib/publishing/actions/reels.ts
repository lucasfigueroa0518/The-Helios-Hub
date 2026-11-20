import type { Placement, PlacementOutcome, PlacementTarget } from '@/lib/social-hub/placement';
import type { SpineQuery } from '@/lib/social-hub/spine';
import { reviseVerbs } from '@/lib/revisions/actions';

import { deleteVerb } from './delete';
import { need, needPlacement, type ActionFn, type ContentActions } from './types';

type Outcome = { scheduled: boolean; note: string; status?: number };
type Queued = { queued: boolean; note?: string; status?: number };
type Place = (q: SpineQuery, input: PlacementTarget & Placement & { by?: string }) => Promise<PlacementOutcome>;

const NOT_LIVE_NOTE = 'Text on Screen isn’t Live, so nothing posts to Instagram. Set it to Live in its Settings tab first.';
const APPROVED_PAUSED_NOTE = 'Approved. Text on Screen is Paused, so it stays in the Made tab. Place it in a slot once it’s in Approval or Live (its Settings tab).';
const PAUSED_NO_VIDEO_NOTE = 'Text on Screen is Paused and this idea has no reel yet, so there is nothing to approve. Its slot is booked once it’s in Approval or Live.';

/**
 * Text on Screen (lib/reels/publish): approve the idea's slot (it keeps, or books,
 * the reel's own posting day: Bald-Eagle D4; in Approval or Live, contract §4.3;
 * Paused: the reel is approved and stays in the Made tab, D17), reject, Force post, place or move
 * the idea's slot (D50: slots belong to the idea; a move keeps the slot's
 * approval), and regenerate: the idea's video is built again on its own slate
 * (copy → frame → video, `requestFinish`, D52) while that slate's posting day
 * is today or later, so a reel made 2 days ahead can be rebuilt during review.
 * A day that has passed is not rebuilt: a re-winning idea on a later day is
 * produced fresh, never carried (SH-59).
 */
export function reelActions(deps: {
  schedulePostIdea: (postIdeaId: string, source: 'user', videoJobId: string | null) => Promise<Outcome>;
  rejectReel: (postIdeaId: string, videoJobId: string | null, by: string | null) => Promise<{ rejected: boolean; note: string }>;
  forcePost: (videoJobId: string) => Promise<Queued>;
  unscheduleIdea: (postIdeaId: string) => Promise<{ ok: boolean; note: string }>;
  query: SpineQuery;
  itemId: (videoJobId: string) => Promise<string | null>;
  placeItem: Place;
  rescheduleItem: Place;
  /** The idea's own slate while its posting day is today or later (lib/reels/visual/finish.ts todaySlateFor), else null. */
  todaySlate: (postIdeaId: string) => Promise<string | null>;
  findReelLock: (slateId: string, postIdeaId: string) => Promise<{ nyDate: string } | null>;
  requestFinish: (postIdeaId: string, slateId: string) => Promise<{ status: 'active' | 'done' | 'failed'; note: string }>;
  /** Whether Text on Screen is Live (D16; lib/reels/publish/schedule.ts publishingLive). Absent: not checked here. */
  publishingLive?: () => Promise<boolean>;
  /** Whether Text on Screen books slots: Approval or Live (holdsSlots; schedule.ts reelsHoldsSlots). Absent: not checked here. */
  holdsSlots?: () => Promise<boolean>;
  /** Approve the reel's video without a slot (Paused, D17): lib/reels/publish/items.ts approveReel. */
  approveVideo?: (videoJobId: string) => Promise<void>;
}): ContentActions {
  const placement =
    (fn: Place): ActionFn =>
    async (t, by, input) => {
      const at = needPlacement(input);
      const postIdeaId = need(t, 'postIdeaId');
      const itemId = t.videoJobId ? await deps.itemId(t.videoJobId) : null;
      return fn(deps.query, { vertical: 'reels', itemId, ideaRef: postIdeaId, ...at, ...(by ? { by } : {}) });
    };
  return {
    vertical: 'reels',
    async approve(t) {
      const postIdeaId = need(t, 'postIdeaId');
      // A paused type holds no slots (D17): the reel is approved and stays in the Made tab.
      if (deps.holdsSlots && !(await deps.holdsSlots().catch(() => false))) {
        if (!t.videoJobId || !deps.approveVideo) return { ok: false, note: PAUSED_NO_VIDEO_NOTE, status: 409 };
        await deps.approveVideo(t.videoJobId);
        return { ok: true, note: APPROVED_PAUSED_NOTE };
      }
      const out = await deps.schedulePostIdea(postIdeaId, 'user', t.videoJobId ?? null);
      return out.scheduled ? { ok: true, note: out.note } : { ok: false, note: out.note, status: out.status };
    },
    async reject(t, by) {
      const out = await deps.rejectReel(need(t, 'postIdeaId'), t.videoJobId ?? null, by);
      return { ok: out.rejected, note: out.note };
    },
    async publishNow(t) {
      // Posts go to Instagram only in the Live state (D16): a forced reel would otherwise wait unposted.
      if (deps.publishingLive && !(await deps.publishingLive().catch(() => false))) return { ok: false, note: NOT_LIVE_NOTE, status: 409 };
      const out = await deps.forcePost(need(t, 'videoJobId'));
      return out.queued ? { ok: true, note: 'Queued to publish now.' } : { ok: false, note: out.note ?? 'Not queued.', status: out.status };
    },
    async regenerate(t) {
      const postIdeaId = need(t, 'postIdeaId');
      const slateId = await deps.todaySlate(postIdeaId);
      if (!slateId) {
        return { ok: false, note: 'This idea isn’t on today’s slate or a later day’s. Text on Screen makes each day’s reels fresh, so only a reel whose day hasn’t passed can be rebuilt.' };
      }
      const lock = await deps.findReelLock(slateId, postIdeaId);
      if (lock) return { ok: false, note: `This reel is locked for ${lock.nyDate} and stays as it is.` };
      const out = await deps.requestFinish(postIdeaId, slateId);
      if (out.status === 'failed') return { ok: false, note: out.note };
      // Idea pool standard (2026-10-21): the video being rebuilt comes off the calendar and out of approval once the rebuild is accepted.
      const off = await deps.unscheduleIdea(postIdeaId).catch(() => null);
      return { ok: true, note: `Rebuilding this idea’s video for its day. ${off?.ok ? 'The old one is unscheduled and no longer approved; approve the new one when it is ready. ' : ''}${out.note}` };
    },
    async unschedule(t) {
      const out = await deps.unscheduleIdea(need(t, 'postIdeaId'));
      return out.ok ? { ok: true, note: out.note } : { ok: false, note: out.note, status: 409 };
    },
    // Only made video can be deleted; a slot booked for an idea with no video yet is unscheduled instead.
    delete: deleteVerb({ refKey: 'videoJobId', query: async () => deps.query, itemOf: (_q, videoJobId) => deps.itemId(videoJobId) }),
    place: placement(deps.placeItem),
    reschedule: placement(deps.rescheduleItem),
    // A revision changes made video, so it is named by the video job (as delete is).
    ...reviseVerbs({ vertical: 'reels', query: async () => deps.query, itemOf: (_q, t) => deps.itemId(need(t, 'videoJobId')) }),
  };
}
