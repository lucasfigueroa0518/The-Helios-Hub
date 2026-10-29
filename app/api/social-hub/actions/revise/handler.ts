import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction, parseRevise } from '../content-action';

/**
 * Revise (Targeted Revisions): queue one fix to one part of a post in the person's own words; the social worker interprets and runs it. Body: `{ vertical, refs, instruction, parentId? }` (parentId answers the question an earlier request asked).
 * Unreachable (404) while the `revise` flag is off.
 */
export function reviseContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: 'revise', verb: 'revise', actions, parse: parseRevise });
}
