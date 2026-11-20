import type { ExplainersDb } from '@/lib/explainers/db';
import { findContentItem, type SpineQuery } from '@/lib/social-hub/spine';
import { formatPlacement, type Placement, type PlacementOutcome, type PlacementTarget } from '@/lib/social-hub/placement';
import { nyDateOf } from '@/lib/social-hub/time';
import { reviseVerbs } from '@/lib/revisions/actions';
import type { Query } from '@/lib/social/store/pg';

import { deleteVerb } from './delete';
import { need, needPlacement, type ActionFn, type ContentActions } from './types';

type Queued = { queued: boolean; note?: string; status?: number };
type Place = (q: SpineQuery, input: PlacementTarget & Placement & { by?: string }) => Promise<PlacementOutcome>;

const NOT_LIVE_NOTE = 'Explainers aren’t Live, so nothing posts to Instagram. Set them to Live in the Settings tab first.';
const APPROVED_PAUSED_NOTE = 'Approved. Explainers are Paused, so it stays in the Made tab. Place it in a slot once they’re in Approval or Live (the Settings tab).';

const REFUSAL: Record<string, string> = {
  daily_render_cap: 'Today’s explainer render cap is used up.',
  daily_spend_cap: 'Today’s explainer spend cap is used up.',
  already_in_flight: 'A render for this topic is already queued or running.',
  topic_not_found: 'That topic no longer exists.',
  topic_not_renderable: 'That topic is archived, so it can’t be rendered.',
  topic_published: 'That topic has already been posted.',
};

/**
 * Explainers (lib/explainers): approve sets the review verdict and, in Approval or Live (contract §4.3), books today's
 * next open window (B1); Paused: approved, it stays in the Made tab (D17). Reject sets the verdict too
 * (mirrored onto the spine; a hub Reject may carry the review page's tags and
 * a note, D53), Hard publish counts as approval (SH-17) and is refused unless Live (D16), regenerate queues a
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
  /** The topic's newest finished render: what Regenerate takes off the calendar and out of approval (pool standard, 2026-10-21). */
  latestJobId?: (db: ExplainersDb, topicId: string) => Promise<string | null>;
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
  /** Whether Explainers are Live (D16): only then does a slot post, and Publish now is refused otherwise. */
  publishingLive: (db: ExplainersDb) => Promise<boolean>;
  /** Whether Explainers book slots: Approval or Live (holdsSlots; schedule.ts explainersHoldsSlots). */
  holdsSlots: (db: ExplainersDb) => Promise<boolean>;
  /**
   * Targeted Revisions: the database the social worker claims revision rows from (socialQuery,
   * DATABASE_URL), or null when Explainers keep a database of their own (EXPLAINERS_DATABASE_URL, or
   * local PGlite): the log references the spine item, which then is not in the worker's database,
   * so revisions are refused there. Absent: the explainers handle (tests that use one database).
   */
  revisionsQuery?: () => Promise<Query | null>;
  /** The clock (tests pin it). */
  now?: () => Date;
}): ContentActions {
  /** The explainers handle may be its own database; its spine rows (and the revisions log) are reached through it. */
  const spineQuery = async (): Promise<SpineQuery> => {
    const db = await deps.db();
    return ((text, params) => db.query(text, params)) as SpineQuery;
  };
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
      // A paused type holds no slots (D17): approved, it stays in the Made tab.
      if (!(await deps.holdsSlots(db))) return { ok: true, note: APPROVED_PAUSED_NOTE };
      // B1: a system slot (source 'auto'). A render the night made ahead keeps (or books) the window of the date it was
      // made for, never today's leftover one (Bald-Eagle D4: scheduleJob reads its target date); a person's render:
      // today's next open window. A render that already has a slot keeps it. Booking only: the slot posts at its time,
      // and only while Live (D16); in Approval a passed slot goes back to Made (D17).
      const now = deps.now?.() ?? new Date();
      const booked = await deps.scheduleJob(db, jobId, 'auto', now, nyDateOf(now)!);
      const live = await deps.publishingLive(db).catch(() => false);
      if (!booked.scheduled) {
        return { ok: true, note: 'Approved. No window is left on its day, so it takes the next open window after that; Post now can still post it today.' };
      }
      const when = formatPlacement(new Date(booked.publishAt));
      return live
        ? { ok: true, note: `Approved. It posts ${when}.` }
        : { ok: true, note: `Approved. It holds its slot ${when}, but nothing posts until Explainers are Live (the Settings tab).` };
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
      const db = await deps.db();
      // Posts go to Instagram only in the Live state (D16).
      if (!(await deps.publishingLive(db).catch(() => false))) return { ok: false, note: NOT_LIVE_NOTE, status: 409 };
      const out = await deps.hardPublishJob(db, need(t, 'jobId'), by);
      return out.queued ? { ok: true, note: 'Queued to publish now.' } : { ok: false, note: out.note ?? 'Not queued.', status: out.status };
    },
    async regenerate(t) {
      const db = await deps.db();
      const settings = await deps.loadSettings(db);
      const out = await deps.requestRerender(db, { topicId: need(t, 'topicId'), settings: settings as never });
      if (!out.ok) return { ok: false, note: REFUSAL[out.reason ?? ''] ?? `Refused: ${out.reason}` };
      // Idea pool standard: a regenerate takes the version being replaced off the calendar and withdraws its approval, so
      // nothing posts what was not reviewed after the new render. Only once the new render is accepted (a cap refusal changes nothing).
      const prior = deps.latestJobId ? await deps.latestJobId(db, need(t, 'topicId')) : null;
      const off = prior ? await deps.unscheduleJob(db, prior) : null;
      return {
        ok: true,
        note: off?.ok
          ? 'A new render is queued. The version it replaces is unscheduled and no longer approved; approve the new one when it is ready.'
          : 'A new render is queued. It replaces the current version when it finishes.',
      };
    },
    async unschedule(t) {
      const out = await deps.unscheduleJob(await deps.db(), need(t, 'jobId'));
      return out.ok ? { ok: true, note: out.note } : { ok: false, note: out.note, status: 409 };
    },
    delete: deleteVerb({ refKey: 'jobId', query: spineQuery, itemOf: async (_q, jobId) => deps.itemId(await deps.db(), jobId) }),
    place: placement(deps.placeItem),
    reschedule: placement(deps.rescheduleItem),
    ...revisions(),
  };

  /**
   * Revision rows go where the social worker claims them (the revisions query); the post itself is
   * read by the description through the explainers handle. Refused when the two are not one database.
   */
  function revisions(): Pick<ContentActions, 'revise' | 'undoRevision' | 'continueRevision' | 'revisions'> {
    const NOT_SHARED = 'Explainer changes are not available here: explainers keep their own database on this setup, not the shared database the revisions worker reads. Nothing was changed.';
    const query = async (): Promise<Query | null> => (deps.revisionsQuery ? deps.revisionsQuery() : ((await spineQuery()) as unknown as Query));
    const verbs = reviseVerbs({
      vertical: 'explainers',
      query: async () => (await query())!,
      itemOf: async (_q, t) => deps.itemId(await deps.db(), need(t, 'jobId')),
      // The read's lookup: the spine lives in the explainers database, and the poll must not write there either.
      findItem: async (_q, t) => findContentItem(await spineQuery(), 'explainers', need(t, 'jobId').toLowerCase()),
    });
    const guarded =
      (fn: ActionFn | undefined): ActionFn =>
      async (t, by, input) =>
        (await query()) ? fn!(t, by, input) : { ok: false, note: NOT_SHARED, status: 409 };
    return {
      revise: guarded(verbs.revise),
      undoRevision: guarded(verbs.undoRevision),
      continueRevision: guarded(verbs.continueRevision),
      // Not shared: there are no revision rows to show (a submit answers with NOT_SHARED).
      revisions: async (t) => ((await query()) ? verbs.revisions!(t) : []),
    };
  }
}
