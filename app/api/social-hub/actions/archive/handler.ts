import type { ContentActions } from '@/lib/publishing/actions/types';
import type { ActionSpec } from '@/lib/social-hub/action-route';
import type { Vertical } from '@/lib/social-hub/types';

import { parseTarget, type Parsed } from '../content-action';

/**
 * Archive (idea pool standard, 2026-10-21): the soft delete that replaces Reject and Delete. The post is rejected
 * through its type's own verb (it never posts, and a waiting slot opens: a scheduled post is unscheduled), then its
 * idea is archived so no refill brings it back. Nothing is removed from the database. A post that is posting or has
 * posted is refused by the type's verb. Body: `{ vertical, refs, ideaId }` (`ideaId` null when the idea is gone).
 */

const IDEA_ID = /^(reels|carousels|explainers|stories|last_few_days):[A-Za-z_]+:[^\s]{1,2000}$/;

export type ArchiveBody = Parsed & { ideaId: string | null };

export function archiveContent(
  actions: () => Promise<Record<Vertical, ContentActions>>,
  archiveIdea: (vertical: Vertical, ideaId: string, by: string) => Promise<void>,
): ActionSpec<ArchiveBody> {
  return {
    flag: 'reject',
    parse: (body) => {
      const parsed = parseTarget(body);
      const ideaId = (body as { ideaId?: unknown } | null)?.ideaId ?? null;
      if (!parsed) return null;
      if (ideaId !== null && (typeof ideaId !== 'string' || !IDEA_ID.test(ideaId) || !ideaId.startsWith(`${parsed.vertical}:`))) return null;
      return { ...parsed, ideaId };
    },
    run: async ({ vertical, target, input, ideaId }, ctx) => {
      const reject = (await actions())[vertical].reject;
      if (!reject) return { ok: false, note: `${vertical} has no archive here; use its own page.`, status: 409 };
      const out = await reject(target, ctx.email, input);
      if (!out.ok) return out;
      if (ideaId) await archiveIdea(vertical, ideaId, ctx.email);
      return { ok: true, note: 'Archived. It won’t post, and the idea won’t come back.' };
    },
  };
}
