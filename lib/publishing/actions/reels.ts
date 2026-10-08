import { need, type ContentActions } from './types';

type Outcome = { scheduled: boolean; note: string; status?: number };
type Queued = { queued: boolean; note?: string; status?: number };

/** Trial Reels (lib/reels/publish): approve the idea's slot, reject, Force post. A re-winning idea is produced fresh (SH-59): no rerun here. */
export function reelActions(deps: {
  schedulePostIdea: (postIdeaId: string, source: 'user', videoJobId: string | null) => Promise<Outcome>;
  rejectReel: (postIdeaId: string, videoJobId: string | null, by: string | null) => Promise<{ rejected: boolean; note: string }>;
  forcePost: (videoJobId: string) => Promise<Queued>;
}): ContentActions {
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
  };
}
