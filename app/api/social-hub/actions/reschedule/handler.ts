import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction, parsePlacement, RESCHEDULE_FLAG } from '../content-action';

/**
 * Move (D50, `reschedule` in the user-action layer): a waiting slot moves to
 * the chosen day and window under the same rules as Schedule here. The slot
 * keeps its approval (Trial Reels: the idea's slot approval). Body:
 * `{ vertical, refs, nyDate, slot }`.
 */
export function rescheduleContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: RESCHEDULE_FLAG, verb: 'reschedule', actions, parse: parsePlacement });
}
