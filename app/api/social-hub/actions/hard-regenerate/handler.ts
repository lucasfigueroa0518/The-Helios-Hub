import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction, refBody } from '../content-action';

/**
 * Hard regenerate (SH-15, SH-16, SH-54; D47 `regenerate`): a one-post rerun
 * queued in the type's own run table. Explainers (caps enforced) and Stories;
 * Carousels and Trial Reels have none (link out). Older body: `{ vertical, ref }`.
 */
export function hardRegenerate(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({
    flag: 'hardRegenerate',
    verb: 'regenerate',
    actions,
    allowed: ['explainers', 'stories'],
    legacy: refBody({ explainers: 'topicId', stories: 'setId' }),
  });
}
