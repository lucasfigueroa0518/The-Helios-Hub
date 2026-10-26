import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction } from '../content-action';

/**
 * Approve an Explainer reel, a Story set, a Last Few Days post or an AI Events
 * post from its type page (D47 user-action layer: `explainerActions.approve`
 * sets the review verdict, `storyActions.approve` approves the set,
 * `lastFewDaysActions.approve` and `aiEventsActions.approve` approve the post
 * and book its window). Body:
 * `{ vertical, refs: { jobId } | { setId } | { lfdPostId } | { aiEventsPostId } }`.
 */
export function approveContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: 'approveContent', verb: 'approve', actions, allowed: ['explainers', 'stories', 'last_few_days', 'ai_events'] });
}
