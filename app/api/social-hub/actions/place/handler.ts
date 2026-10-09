import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction, parsePlacement, RESCHEDULE_FLAG } from '../content-action';

/**
 * Schedule here (D50, `place` in the user-action layer): content with no
 * waiting slot goes into the chosen day and window, as a person's slot. Each
 * type's rules hold (its windows, the future only, one item per window, feed
 * spacing for Carousels and Explainers; Stories through their own set).
 * Placing is not approving. Body: `{ vertical, refs, nyDate, slot }`.
 */
export function placeContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: RESCHEDULE_FLAG, verb: 'place', actions, parse: parsePlacement });
}
