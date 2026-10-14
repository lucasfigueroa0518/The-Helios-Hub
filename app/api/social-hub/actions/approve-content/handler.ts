import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction } from '../content-action';

/**
 * Approve an Explainer reel, a Story set or a Last Few Days post from its type
 * page (D47 user-action layer: `explainerActions.approve` sets the review
 * verdict, `storyActions.approve` approves the set, `lastFewDaysActions.approve`
 * approves the post and books its window). Body:
 * `{ vertical, refs: { jobId } | { setId } | { lfdPostId } }`.
 */
export function approveContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: 'approveContent', verb: 'approve', actions, allowed: ['explainers', 'stories', 'last_few_days'] });
}
