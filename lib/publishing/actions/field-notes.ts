// lib/publishing/actions/field-notes.ts
import type { Placement, PlacementOutcome, PlacementTarget } from '@/lib/social-hub/placement';
import type { Query } from '@/lib/social/store/pg';
import { reviseVerbs } from '@/lib/revisions/actions';

import { deleteVerb } from './delete';
import { need, needPlacement, type ActionInput, type ActionOutcome, type ActionTarget, type ContentActions } from './types';

type Placed = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string; approved?: true };
type Queued = { queued: boolean; note?: string };
type Place = (q: Query, input: PlacementTarget & Placement & { by?: string }) => Promise<PlacementOutcome>;

const REJECTED_NOTE = 'This post was rejected, so it can’t be approved, published or rebuilt. Generate makes a new one.';
const PUBLISHING_OFF_NOTE = 'Field Notes publishing is off. Turn it on before publishing.';
const PUBLISHED_NOTE = 'This post is already published, so it isn’t rebuilt.';

/**
 * Field Notes (lib/field-notes/schedule.ts): approve (approved, and booked in the afternoon window
 * while field_notes publishing_live is on; otherwise approved without a slot), reject, Publish now
 * (refused while publishing is off), unschedule, delete, place or move on the calendar (D50), and
 * regenerate, which is Rebuild post: a queued re-render of the post from its saved copy and photos
 * (no model call). The social worker carries it out. A rejected post is refused by approve,
 * Publish now and Rebuild.
 */
export function fieldNotesActions(deps: {
  query: () => Promise<Query>;
  approvePost: (q: Query, postId: string) => Promise<Placed>;
  rejectPost: (q: Query, postId: string, by: string | null) => Promise<boolean>;
  hardPublishPost: (q: Query, postId: string) => Promise<Queued>;
  /** field_notes.settings publishing_live: Publish now is refused while it is off. */
  publishingLive: (q: Query) => Promise<boolean>;
  unschedulePost: (q: Query, postId: string) => Promise<{ ok: boolean; note: string }>;
  /** Queue a rebuild (lib/field-notes/manual.ts queueFieldNotesRun with kind 'rebuild'). */
  queueRebuild: (q: Query, o: { requestedBy: string }) => Promise<{ ok: boolean; note: string }>;
  itemId: (q: Query, postId: string) => Promise<string | null>;
  placeItem: Place;
  rescheduleItem: Place;
}): ContentActions {
  async function placement(t: ActionTarget, input: ActionInput | undefined, fn: Place, by?: string): Promise<ActionOutcome> {
    const at = needPlacement(input);
    const q = await deps.query();
    const itemId = await deps.itemId(q, need(t, 'fieldNotesPostId'));
    if (!itemId) return { ok: false, note: 'The post is gone.' };
    return fn(q, { vertical: 'field_notes', itemId, ...at, ...(by ? { by } : {}) });
  }
  const postOf = async (q: Query, postId: string) =>
    (await q(`SELECT status FROM field_notes.posts WHERE id = $1`, [postId])).rows[0] as { status: string } | undefined;
  return {
    vertical: 'field_notes',
    async approve(t) {
      const q = await deps.query();
      const postId = need(t, 'fieldNotesPostId');
      if ((await postOf(q, postId))?.status === 'rejected') return { ok: false, note: REJECTED_NOTE, status: 409 };
      const placed = await deps.approvePost(q, postId);
      if (placed.scheduled) return { ok: true, note: `Approved and scheduled for ${placed.publishAt}.` };
      return placed.approved ? { ok: true, note: placed.note } : { ok: false, note: placed.note };
    },
    async reject(t, by) {
      return (await deps.rejectPost(await deps.query(), need(t, 'fieldNotesPostId'), by)) ? { ok: true, note: 'Rejected. It will not post.' } : { ok: false, note: 'The post is gone.' };
    },
    async publishNow(t) {
      const q = await deps.query();
      const postId = need(t, 'fieldNotesPostId');
      if ((await postOf(q, postId))?.status === 'rejected') return { ok: false, note: REJECTED_NOTE, status: 409 };
      if (!(await deps.publishingLive(q).catch(() => false))) return { ok: false, note: PUBLISHING_OFF_NOTE, status: 409 };
      const out = await deps.hardPublishPost(q, postId);
      return out.queued ? { ok: true, note: 'Queued to publish now.' } : { ok: false, note: out.note ?? 'Not queued.' };
    },
    async regenerate(t, by) {
      const q = await deps.query();
      const post = await postOf(q, need(t, 'fieldNotesPostId'));
      if (!post) return { ok: false, note: 'The post is gone.' };
      if (post.status === 'rejected') return { ok: false, note: REJECTED_NOTE, status: 409 };
      if (post.status === 'published') return { ok: false, note: PUBLISHED_NOTE, status: 409 };
      const out = await deps.queueRebuild(q, { requestedBy: by });
      return out.ok ? out : { ok: false, note: out.note, status: 409 };
    },
    async unschedule(t) {
      const out = await deps.unschedulePost(await deps.query(), need(t, 'fieldNotesPostId'));
      return out.ok ? { ok: true, note: out.note } : { ok: false, note: out.note, status: 409 };
    },
    delete: deleteVerb({ refKey: 'fieldNotesPostId', query: deps.query as never, itemOf: (q, postId) => deps.itemId(q as Query, postId) }),
    place: (t, by, input) => placement(t, input, deps.placeItem, by),
    reschedule: (t, by, input) => placement(t, input, deps.rescheduleItem, by),
    ...reviseVerbs({ vertical: 'field_notes', query: deps.query, itemOf: (q, t) => deps.itemId(q, need(t, 'fieldNotesPostId')) }),
  };
}
