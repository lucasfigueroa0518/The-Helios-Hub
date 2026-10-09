import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction } from '../content-action';

/**
 * Reject (D47): the content never posts, whatever require_approval says.
 * Every type: Carousels and Trial Reels reject the item and cancel its waiting
 * slot; Explainers set the review verdict (tags kept); Stories use their own reject.
 * Body: `{ vertical, refs }`.
 */
export function rejectContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: 'reject', verb: 'reject', actions });
}
