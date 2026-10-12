import { deleteItem, type SpineQuery } from '@/lib/social-hub/spine';

import { need, type ActionFn } from './types';

/**
 * The `delete` verb, the same for every type (lib/social-hub/spine.ts
 * deleteItem): the post leaves the hub, its waiting slot opens, and nothing
 * is removed from the database. Each type passes the ref its posts are
 * named by and how to find the post's spine item.
 */
export function deleteVerb(deps: { refKey: string; query: () => Promise<SpineQuery>; itemOf: (q: SpineQuery, ref: string) => Promise<string | null> }): ActionFn {
  return async (t, by) => {
    const q = await deps.query();
    const itemId = await deps.itemOf(q, need(t, deps.refKey));
    if (!itemId) return { ok: false, note: 'The post is gone.' };
    return (await deleteItem(q, itemId, by))
      ? { ok: true, note: 'Deleted. It is out of the hub and its slot is open.' }
      : { ok: false, note: 'It is posting or has posted, so it can’t be deleted.', status: 409 };
  };
}
