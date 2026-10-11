import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction } from '../content-action';

/**
 * Unschedule (`unschedule` in the user-action layer): a waiting slot comes off
 * the calendar and the content's approval is withdrawn, so it is made and
 * waiting again and nothing books or posts it until a person decides. Content
 * that is posting or has posted can't be unscheduled. Body: `{ vertical, refs }`.
 */
export function unscheduleContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: 'unschedule', verb: 'unschedule', actions });
}
