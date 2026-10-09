import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction, refBody } from '../content-action';

/**
 * Hard regenerate (SH-15, SH-16, SH-54; D47 `regenerate`): a one-post rerun
 * queued in the type's own way. Explainers (caps enforced) and Stories as
 * before; Carousels queue a one-story rerun the social worker runs (D51);
 * Trial Reels rebuild today's video for the idea (D52). Older body:
 * `{ vertical, ref }` (the post id, topic id, set id or post idea id).
 */
export function hardRegenerate(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({
    flag: 'hardRegenerate',
    verb: 'regenerate',
    actions,
    legacy: refBody({ explainers: 'topicId', stories: 'setId', carousels: 'postId', reels: 'postIdeaId' }),
  });
}
