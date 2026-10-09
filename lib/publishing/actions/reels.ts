import type { Placement, PlacementOutcome, PlacementTarget } from '@/lib/social-hub/placement';
import type { SpineQuery } from '@/lib/social-hub/spine';

import { need, needPlacement, type ActionFn, type ContentActions } from './types';

type Outcome = { scheduled: boolean; note: string; status?: number };
type Queued = { queued: boolean; note?: string; status?: number };
type Place = (q: SpineQuery, input: PlacementTarget & Placement) => Promise<PlacementOutcome>;

/**
 * Trial Reels (lib/reels/publish): approve the idea's slot, reject, Force post,
 * place or move the idea's slot (D50: slots belong to the idea; a move keeps
 * the slot's approval), and regenerate: today's video for the idea is built
 * again (copy → frame → video, `requestFinish`, D52). Only today's: a
 * re-winning idea on a later day is produced fresh, never carried (SH-59).
 */
export function reelActions(deps: {
  schedulePostIdea: (postIdeaId: string, source: 'user', videoJobId: string | null) => Promise<Outcome>;
  rejectReel: (postIdeaId: string, videoJobId: string | null, by: string | null) => Promise<{ rejected: boolean; note: string }>;
  forcePost: (videoJobId: string) => Promise<Queued>;
  query: SpineQuery;
  itemId: (videoJobId: string) => Promise<string | null>;
  placeItem: Place;
  rescheduleItem: Place;
  todaySlate: (postIdeaId: string) => Promise<string | null>;
  findReelLock: (slateId: string, postIdeaId: string) => Promise<{ nyDate: string } | null>;
  requestFinish: (postIdeaId: string, slateId: string) => Promise<{ status: 'active' | 'done' | 'failed'; note: string }>;
}): ContentActions {
  const placement =
    (fn: Place): ActionFn =>
    async (t, _by, input) => {
      const at = needPlacement(input);
      const postIdeaId = need(t, 'postIdeaId');
      const itemId = t.videoJobId ? await deps.itemId(t.videoJobId) : null;
      return fn(deps.query, { vertical: 'reels', itemId, ideaRef: postIdeaId, ...at });
    };
  return {
    vertical: 'reels',
    async approve(t) {
      const out = await deps.schedulePostIdea(need(t, 'postIdeaId'), 'user', t.videoJobId ?? null);
      return out.scheduled ? { ok: true, note: out.note } : { ok: false, note: out.note, status: out.status };
    },
    async reject(t, by) {
      const out = await deps.rejectReel(need(t, 'postIdeaId'), t.videoJobId ?? null, by);
      return { ok: out.rejected, note: out.note };
    },
    async publishNow(t) {
      const out = await deps.forcePost(need(t, 'videoJobId'));
      return out.queued ? { ok: true, note: 'Queued to publish now.' } : { ok: false, note: out.note ?? 'Not queued.', status: out.status };
    },
    async regenerate(t) {
      const postIdeaId = need(t, 'postIdeaId');
      const slateId = await deps.todaySlate(postIdeaId);
      if (!slateId) {
        return { ok: false, note: 'This idea isn’t on today’s slate. Trial Reels make each day’s reels fresh, so only today’s video can be rebuilt.' };
      }
      const lock = await deps.findReelLock(slateId, postIdeaId);
      if (lock) return { ok: false, note: `This reel is locked for ${lock.nyDate} and stays as it is.` };
      const out = await deps.requestFinish(postIdeaId, slateId);
      if (out.status === 'failed') return { ok: false, note: out.note };
      return { ok: true, note: `Rebuilding today’s video for this idea. ${out.note}` };
    },
    place: placement(deps.placeItem),
    reschedule: placement(deps.rescheduleItem),
  };
}
