import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction, parseUndoRevision } from '../content-action';

/**
 * Undo a revision (Targeted Revisions): walk one part back one revision, or with `original: true` back to what the pipeline made. Body: `{ vertical, refs, part: { kind, key }, original? }`.
 * Unreachable (404) while the `revise` flag is off.
 */
export function undoRevisionContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: 'revise', verb: 'undoRevision', actions, parse: parseUndoRevision });
}
