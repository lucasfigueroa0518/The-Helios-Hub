import type { ContentActions } from '@/lib/publishing/actions/types';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction } from '../content-action';

/**
 * Delete: a post that hasn't gone live leaves the hub. Soft: the record, its
 * approval and its costs stay; its waiting slot opens and it can never post.
 * Every type. Body: `{ vertical, refs }`.
 */
export function deleteContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: 'delete', verb: 'delete', actions });
}
