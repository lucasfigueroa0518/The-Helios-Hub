import { need, type ContentActions } from './types';

/** IG Stories (lib/stories/api): Lucas's own approve, reject, publish now (a schedule at now) and regenerate. */
export function storyActions(deps: {
  approve: (setId: string) => Promise<unknown>;
  reject: (setId: string, by: string) => Promise<unknown>;
  publishNow: (setId: string) => Promise<unknown>;
  regenerate: (setId: string, by: string) => Promise<unknown>;
}): ContentActions {
  return {
    vertical: 'stories',
    async approve(t) {
      await deps.approve(need(t, 'setId'));
      return { ok: true, note: 'Approved. It posts in its window.' };
    },
    async reject(t, by) {
      await deps.reject(need(t, 'setId'), by);
      return { ok: true, note: 'Rejected. It will not post.' };
    },
    async publishNow(t) {
      await deps.publishNow(need(t, 'setId'));
      return { ok: true, note: 'Approved and queued to publish now.' };
    },
    async regenerate(t, by) {
      await deps.regenerate(need(t, 'setId'), by);
      return { ok: true, note: 'A new set is queued for the same day.' };
    },
  };
}
