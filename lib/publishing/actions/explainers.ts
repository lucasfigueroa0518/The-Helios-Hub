import type { ExplainersDb } from '@/lib/explainers/db';
import type { SpineQuery } from '@/lib/social-hub/spine';
import type { Placement, PlacementOutcome, PlacementTarget } from '@/lib/social-hub/placement';

import { need, needPlacement, type ActionFn, type ContentActions } from './types';

type Queued = { queued: boolean; note?: string; status?: number };
type Place = (q: SpineQuery, input: PlacementTarget & Placement) => Promise<PlacementOutcome>;

const REFUSAL: Record<string, string> = {
  daily_render_cap: 'Today’s explainer render cap is used up.',
  daily_spend_cap: 'Today’s explainer spend cap is used up.',
  already_in_flight: 'A render for this topic is already queued or running.',
  topic_not_found: 'That topic no longer exists.',
  topic_not_renderable: 'That topic can’t be rendered (rejected or displaced).',
};

/**
 * Explainers (lib/explainers): approve and reject set the review verdict
 * (mirrored onto the spine; a hub Reject may carry the review page's tags and
 * a note, D53), Hard publish counts as approval (SH-17), regenerate queues a
 * rerender under the caps, place and reschedule put the render on the
 * calendar (D50). The explainers handle may be its own database, so its
 * spine rows are reached through it.
 */
export function explainerActions(deps: {
  db: () => Promise<ExplainersDb>;
  setVerdict: (
    db: ExplainersDb,
    jobId: string,
    verdict: 'approved' | 'rejected',
    by: string | null,
    review?: { tags?: readonly string[]; note?: string | null },
  ) => Promise<unknown>;
  hardPublishJob: (db: ExplainersDb, jobId: string, by: string) => Promise<Queued>;
  loadSettings: (db: ExplainersDb) => Promise<unknown>;
  requestRerender: (db: ExplainersDb, input: { topicId: string; settings: never }) => Promise<{ ok: boolean; reason?: string }>;
  itemId: (db: ExplainersDb, jobId: string) => Promise<string | null>;
  verdictOf: (db: ExplainersDb, jobId: string) => Promise<string | null>;
  placeItem: Place;
  rescheduleItem: Place;
}): ContentActions {
  const placement =
    (fn: Place): ActionFn =>
    async (t, _by, input) => {
      const at = needPlacement(input);
      const db = await deps.db();
      const jobId = need(t, 'jobId');
      // A rejection in either place wins (D41): the review page's verdict counts as well as the spine's.
      if ((await deps.verdictOf(db, jobId)) === 'rejected') return { ok: false, note: 'It was rejected, so it can’t be scheduled.' };
      const itemId = await deps.itemId(db, jobId);
      if (!itemId) return { ok: false, note: 'The render is gone.' };
      const spine: SpineQuery = (text, params) => db.query(text, params) as ReturnType<SpineQuery>;
      return fn(spine, { vertical: 'explainers', itemId, ...at });
    };
  return {
    vertical: 'explainers',
    async approve(t, by) {
      await deps.setVerdict(await deps.db(), need(t, 'jobId'), 'approved', by);
      return { ok: true, note: 'Approved. It gets the next free window.' };
    },
    async reject(t, by, input) {
      const review = {
        ...(input?.tags ? { tags: input.tags } : {}),
        ...(input?.note !== undefined ? { note: input.note } : {}),
      };
      const db = await deps.db();
      const jobId = need(t, 'jobId');
      // Without a review the reviewer's earlier tags and note stay as they were.
      if (Object.keys(review).length) await deps.setVerdict(db, jobId, 'rejected', by, review);
      else await deps.setVerdict(db, jobId, 'rejected', by);
      return { ok: true, note: 'Rejected. It will not post.' };
    },
    async publishNow(t, by) {
      const out = await deps.hardPublishJob(await deps.db(), need(t, 'jobId'), by);
      return out.queued ? { ok: true, note: 'Queued to publish now.' } : { ok: false, note: out.note ?? 'Not queued.', status: out.status };
    },
    async regenerate(t) {
      const db = await deps.db();
      const settings = await deps.loadSettings(db);
      const out = await deps.requestRerender(db, { topicId: need(t, 'topicId'), settings: settings as never });
      return out.ok
        ? { ok: true, note: 'A new render is queued. It replaces the current version when it finishes.' }
        : { ok: false, note: REFUSAL[out.reason ?? ''] ?? `Refused: ${out.reason}` };
    },
    place: placement(deps.placeItem),
    reschedule: placement(deps.rescheduleItem),
  };
}
