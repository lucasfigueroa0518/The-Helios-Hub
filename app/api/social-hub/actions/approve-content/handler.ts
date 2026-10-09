import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction } from '../content-action';

/**
 * Approve an Explainer reel or a Story set from its type page (D47 user-action
 * layer: `explainerActions.approve` sets the review verdict, `storyActions.approve`
 * approves the set). Body: `{ vertical, refs: { jobId } | { setId } }`.
 */
export function approveContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: 'approveContent', verb: 'approve', actions, allowed: ['explainers', 'stories'] });
}
