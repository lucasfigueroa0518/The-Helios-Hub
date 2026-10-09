import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction, refBody } from '../content-action';

/**
 * Hard publish (SH-15, SH-17; D47 `publishNow`): post now, skipping the slot;
 * it counts as approval for every type. Older body: `{ vertical, ref }`.
 */
export function hardPublish(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({
    flag: 'hardPublish',
    verb: 'publishNow',
    actions,
    legacy: refBody({ reels: 'videoJobId', carousels: 'postId', explainers: 'jobId', stories: 'setId' }),
  });
}
