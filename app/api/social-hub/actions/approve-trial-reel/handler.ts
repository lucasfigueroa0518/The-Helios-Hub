import { isUuid, type ActionSpec } from '@/lib/social-hub/action-route';

type Outcome = { scheduled: boolean; note: string; status?: number };
type Deps = { schedulePostIdea: (postIdeaId: string, source: 'user', videoJobId: string | null) => Promise<Outcome> };

/**
 * Approve a Trial Reels slot inline: `schedulePostIdea(idea, 'user', video)`
 * in lib/reels/publish/schedule.ts approves the slot the night chose (a
 * person scheduling a reel approves it), exactly as /reels does.
 */
export function approveTrialReel(deps: Deps): ActionSpec<{ postIdeaId: string; videoJobId: string | null }> {
  return {
    flag: 'approveTrialReel',
    parse: (b) => {
      const body = b as { postIdeaId?: unknown; videoJobId?: unknown } | null;
      if (!isUuid(body?.postIdeaId)) return null;
      if (body.videoJobId != null && !isUuid(body.videoJobId)) return null;
      return { postIdeaId: body.postIdeaId, videoJobId: (body.videoJobId as string | null | undefined) ?? null };
    },
    run: async ({ postIdeaId, videoJobId }) => {
      const out = await deps.schedulePostIdea(postIdeaId, 'user', videoJobId);
      return out.scheduled ? { ok: true, note: out.note } : { ok: false, note: out.note, status: out.status };
    },
  };
}
