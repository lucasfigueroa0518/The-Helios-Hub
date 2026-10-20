import type { ExplainersDb } from '@/lib/explainers/db';
import type { SpineQuery } from '@/lib/social-hub/spine';
import { formatPlacement, type Placement, type PlacementOutcome, type PlacementTarget } from '@/lib/social-hub/placement';
import { nyDateOf } from '@/lib/social-hub/time';

import { deleteVerb } from './delete';
import { need, needPlacement, type ActionFn, type ContentActions } from './types';

type Queued = { queued: boolean; note?: string; status?: number };
type Place = (q: SpineQuery, input: PlacementTarget & Placement & { by?: string }) => Promise<PlacementOutcome>;

const REFUSAL: Record<string, string> = {
  daily_render_cap: 'Today’s explainer render cap is used up.',
  daily_spend_cap: 'Today’s explainer spend cap is used up.',
  already_in_flight: 'A render for this topic is already queued or running.',
  topic_not_found: 'That topic no longer exists.',
  topic_not_renderable: 'That topic can’t be rendered (rejected or displaced).',
};

/**
 * Explainers (lib/explainers): approve sets the review verdict and books today's next open window (B1); reject sets it too
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
  unscheduleJob: (db: ExplainersDb, jobId: string) => Promise<{ ok: boolean; note: string }>;
  verdictOf: (db: ExplainersDb, jobId: string) => Promise<string | null>;
  placeItem: Place;
  rescheduleItem: Place;
  /** Today's next open window (B1): lib/explainers/publish/schedule.ts scheduleJob, through `throughDate`. */
  scheduleJob: (
    db: ExplainersDb,
    jobId: string,
    source: 'auto',
    now: Date,
    throughDate: string,
  ) => Promise<{ scheduled: true; publishAt: string } | { scheduled: false; note: string }>;
  publishingLive: (db: ExplainersDb) => Promise<boolean>;
  /** The clock (tests pin it). */
  now?: () => Date;
}): ContentActions {
  const placement =
    (fn: Place): ActionFn =>
    async (t, by, input) => {
      const at = needPlacement(input);
      const db = await deps.db();
      const jobId = need(t, 'jobId');
      // A rejection in either place wins (D41): the review page's verdict counts as well as the spine's.
      if ((await deps.verdictOf(db, jobId)) === 'rejected') return { ok: false, note: 'It was rejected, so it can’t be scheduled.' };
      const itemId = await deps.itemId(db, jobId);
      if (!itemId) return { ok: false, note: 'The render is gone.' };
      const spine: SpineQuery = (text, params) => db.query(text, params) as ReturnType<SpineQuery>;
      return fn(spine, { vertical: 'explainers', itemId, ...at, ...(by ? { by } : {}) });
    };
  return {
    vertical: 'explainers',
    async approve(t, by) {
      const db = await deps.db();
      const jobId = need(t, 'jobId');
      await deps.setVerdict(db, jobId, 'approved', by);
      // Never while publishing is off: a slot booked then would post late once it is switched back on.
      if (!(await deps.publishingLive(db))) {
        return { ok: true, note: 'Approved. Publishing is switched off, so it gets a time once publishing is back on.' };
      }
      // B1: today's next open window, as a system slot (source 'auto', so tonight's quota is untouched).
      // A render that already has a slot keeps it. Booking only: the slot posts at its time, never now.
      const now = deps.now?.() ?? new Date();
      const booked = await deps.scheduleJob(db, jobId, 'auto', now, nyDateOf(now)!);
      return booked.scheduled
        ? { ok: true, note: `Approved. It posts ${formatPlacement(new Date(booked.publishAt))}.` }
        : { ok: true, note: 'Approved. No window is left today, so it takes the next open window after today; Post now can still post it today.' };
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
    async unschedule(t) {
      const out = await deps.unscheduleJob(await deps.db(), need(t, 'jobId'));
      return out.ok ? { ok: true, note: out.note } : { ok: false, note: out.note, status: 409 };
    },
    delete: deleteVerb({
      refKey: 'jobId',
      query: async () => {
        const db = await deps.db();
        return ((text, params) => db.query(text, params)) as SpineQuery;
      },
      itemOf: async (_q, jobId) => deps.itemId(await deps.db(), jobId),
    }),
    place: placement(deps.placeItem),
    reschedule: placement(deps.rescheduleItem),
  };
}
