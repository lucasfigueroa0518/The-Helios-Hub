import type {
  dramaItemId,
  dramaPublishingLive,
  dramaVerdictOf,
  DramaDb,
  hardPublishDramaJob,
  latestDramaJobId,
  requestDramaJob,
  scheduleDramaJob,
  setDramaVerdict,
  unscheduleDramaJob,
} from '@/lib/reel-ai-drama/hub';
import { DRAMA_REFUSAL_TEXT } from '@/lib/reel-ai-drama/hub';
import { findContentItem, type SpineQuery } from '@/lib/social-hub/spine';
import { formatPlacement, type Placement, type PlacementOutcome, type PlacementTarget } from '@/lib/social-hub/placement';
import { nyDateOf } from '@/lib/social-hub/time';
import { reviseVerbs } from '@/lib/revisions/actions';
import type { Query } from '@/lib/social/store/pg';

import { deleteVerb } from './delete';
import { need, needPlacement, type ActionFn, type ActionOutcome, type ContentActions } from './types';

type Place = (q: SpineQuery, input: PlacementTarget & Placement & { by?: string }) => Promise<PlacementOutcome>;

/** Revisions refused: drama rows are not in the database the revisions worker reads. */
export const DRAMA_REVISIONS_NOT_SHARED = 'AI Drama changes are not available here: AI Drama Reels keep their own database on this setup, not the shared database the revisions worker reads. Nothing was changed.';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Every drama verb answers with a plain note. A 4xx the drama code throws on
 * purpose (a missing ref, an unknown review tag) keeps its status and words; anything
 * else (the drama database unreachable, its schema not applied) becomes a 503 note
 * that says what failed, never a raw 500.
 */
function safe(what: string, fn: ActionFn): ActionFn {
  return async (t, by, input) => {
    try {
      return await fn(t, by, input);
    } catch (error) {
      const status = (error as { status?: unknown })?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) return { ok: false, note: message(error), status };
      return { ok: false, note: `AI Drama Reels couldn’t ${what}: ${message(error)}`, status: 503 } satisfies ActionOutcome;
    }
  };
}

/**
 * AI Drama Reels (lib/reel-ai-drama/hub.ts), the Explainers verbs one for one
 * (lib/publishing/actions/explainers.ts): approve sets the review verdict and books
 * today's next open slot (B1); reject sets it too (mirrored onto the spine, with the
 * review's tags and note); Hard publish counts as approval (SH-17); regenerate queues
 * a new job for the pitch under the daily caps and takes the replaced version off the
 * calendar; place and reschedule put the job on the calendar (D50). The drama handle
 * is the explainers connection, so its spine rows are reached through it.
 */
export function reelAiDramaActions(deps: {
  db: () => Promise<DramaDb>;
  setVerdict: typeof setDramaVerdict;
  hardPublishJob: typeof hardPublishDramaJob;
  requestJob: typeof requestDramaJob;
  itemId: typeof dramaItemId;
  unscheduleJob: typeof unscheduleDramaJob;
  latestJobId: typeof latestDramaJobId;
  verdictOf: typeof dramaVerdictOf;
  scheduleJob: typeof scheduleDramaJob;
  publishingLive: typeof dramaPublishingLive;
  placeItem: Place;
  rescheduleItem: Place;
  /** The database the social worker claims revision rows from, or null when drama is not on it (the Explainers rule). Absent: the drama handle. */
  revisionsQuery?: () => Promise<Query | null>;
  now?: () => Date;
}): ContentActions {
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
      // A rejection in either place wins (D41): the review's verdict counts as well as the spine's.
      if ((await deps.verdictOf(db, jobId)) === 'rejected') return { ok: false, note: 'It was rejected, so it can’t be scheduled.' };
      const itemId = await deps.itemId(db, jobId);
      if (!itemId) return { ok: false, note: 'The reel is gone.' };
      const spine: SpineQuery = (text, params) => db.query(text, params) as ReturnType<SpineQuery>;
      return fn(spine, { vertical: 'reel_ai_drama', itemId, ...at, ...(by ? { by } : {}) });
    };

  const verbs: Omit<ContentActions, 'vertical' | 'revisions'> = {
    async approve(t, by) {
      const db = await deps.db();
      const jobId = need(t, 'jobId');
      await deps.setVerdict(db, jobId, 'approved', by);
      // Never while publishing is off: a slot booked then would post late once it is switched back on.
      if (!(await deps.publishingLive(db))) {
        return { ok: true, note: 'Approved. Publishing is switched off, so it gets a time once publishing is back on.' };
      }
      // B1: today's next open slot, as a system slot (source 'auto', so tonight's quota is untouched).
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
    async regenerate(t, by) {
      const db = await deps.db();
      const pitchId = need(t, 'pitchId');
      const out = await deps.requestJob(db, { pitchId, by, ...(deps.now ? { now: deps.now() } : {}) });
      if (!out.ok) return { ok: false, note: DRAMA_REFUSAL_TEXT[out.reason] ?? `Refused: ${out.reason}`, status: 409 };
      // Idea pool standard: the version being replaced comes off the calendar and loses its approval, only once the new job is accepted.
      const prior = await deps.latestJobId(db, pitchId);
      const off = prior && prior !== out.jobId ? await deps.unscheduleJob(db, prior) : null;
      return {
        ok: true,
        note: off?.ok
          ? 'A new reel is queued. The version it replaces is unscheduled and no longer approved; approve the new one when it is ready.'
          : 'A new reel is queued. It replaces the current version when it finishes.',
      };
    },
    async unschedule(t) {
      const out = await deps.unscheduleJob(await deps.db(), need(t, 'jobId'));
      return out.ok ? { ok: true, note: out.note } : { ok: false, note: out.note, status: 409 };
    },
    delete: deleteVerb({ refKey: 'jobId', query: spineQuery, itemOf: async (_q, jobId) => deps.itemId(await deps.db(), jobId) }),
    place: placement(deps.placeItem),
    reschedule: placement(deps.rescheduleItem),
    ...revisionVerbs(),
  };

  const WHAT: Record<string, string> = {
    approve: 'approve it', reject: 'reject it', publishNow: 'queue it to publish', regenerate: 'queue a new reel', unschedule: 'unschedule it',
    delete: 'delete it', place: 'schedule it', reschedule: 'move it', revise: 'start the change', undoRevision: 'undo the change', continueRevision: 'continue the change',
  };
  const wrapped = Object.fromEntries(
    Object.entries(verbs).map(([verb, fn]) => [verb, safe(WHAT[verb] ?? verb, fn as ActionFn)]),
  ) as Omit<ContentActions, 'vertical' | 'revisions'>;

  return { vertical: 'reel_ai_drama', ...wrapped, revisions: revisionsReader() };

  /** Revision rows go where the social worker claims them; refused when that is not the drama database (the Explainers guard). */
  function revisionsQuery(): Promise<Query | null> {
    return deps.revisionsQuery ? deps.revisionsQuery() : spineQuery().then((q) => q as unknown as Query);
  }

  function reviseSet() {
    return reviseVerbs({
      vertical: 'reel_ai_drama',
      query: async () => (await revisionsQuery())!,
      itemOf: async (_q, t) => deps.itemId(await deps.db(), need(t, 'jobId')),
      // The spine lives on the drama (explainers) handle, and the poll must not write there either.
      findItem: async (_q, t) => findContentItem(await spineQuery(), 'reel_ai_drama', need(t, 'jobId').toLowerCase()),
    });
  }

  function revisionVerbs(): Pick<ContentActions, 'revise' | 'undoRevision' | 'continueRevision'> {
    const v = reviseSet();
    const guarded =
      (fn: ActionFn | undefined): ActionFn =>
      async (t, by, input) =>
        (await revisionsQuery()) ? fn!(t, by, input) : { ok: false, note: DRAMA_REVISIONS_NOT_SHARED, status: 409 };
    return { revise: guarded(v.revise), undoRevision: guarded(v.undoRevision), continueRevision: guarded(v.continueRevision) };
  }

  function revisionsReader(): NonNullable<ContentActions['revisions']> {
    const v = reviseSet();
    // Not shared, or the drama database is unreachable: no rows to show (a submit answers with a note).
    return async (t) => {
      try {
        return (await revisionsQuery()) ? v.revisions!(t) : [];
      } catch {
        return [];
      }
    };
  }
}
