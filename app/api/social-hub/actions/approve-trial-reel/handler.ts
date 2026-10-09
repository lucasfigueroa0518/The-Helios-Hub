import type { ContentActions } from '@/lib/publishing/actions/types';
import { isUuid } from '@/lib/social-hub/action-route';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction, type Parsed } from '../content-action';

/**
 * Approve a Trial Reels slot inline (D47, `reelActions.approve`): the idea's
 * slot is approved by a person scheduling it, exactly as /reels does.
 * Older body: `{ postIdeaId, videoJobId }`.
 */
export function approveTrialReel(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({
    flag: 'approveTrialReel',
    verb: 'approve',
    actions,
    allowed: ['reels'],
    legacy: (b): Parsed | null => {
      const body = b as { postIdeaId?: unknown; videoJobId?: unknown } | null;
      if (!isUuid(body?.postIdeaId)) return null;
      if (body!.videoJobId != null && !isUuid(body!.videoJobId)) return null;
      return { vertical: 'reels', target: { postIdeaId: body!.postIdeaId as string, ...(body!.videoJobId ? { videoJobId: body!.videoJobId as string } : {}) } };
    },
  });
}
