import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction, parseContinueRevision } from '../content-action';

/**
 * Continue a revision paused at its cap or ceiling (Targeted Revisions): allow up to `overrideUsd` and queue it again. Body: `{ vertical, refs, revisionId, overrideUsd }`.
 * Unreachable (404) while the `revise` flag is off.
 */
export function continueRevisionContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: 'revise', verb: 'continueRevision', actions, parse: parseContinueRevision });
}
