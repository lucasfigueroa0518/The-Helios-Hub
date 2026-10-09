import { formatPlacement, type Planned, type PlacementRules } from '@/lib/social-hub/placement';
import type { SpineQuery } from '@/lib/social-hub/spine';
import { SERIES_LABEL } from '@/lib/stories/render/copy';

import { need, needPlacement, type ActionFn, type ActionOutcome, type ContentActions } from './types';

type StorySetView = { status: string; series: string; ny_date: string; publish_at: string | null };
type Plan = (
  query: SpineQuery,
  input: { vertical: 'stories'; nyDate: string; slot: string; rules?: PlacementRules; moving?: { scheduleId: string; publishAt: Date } | null },
) => Promise<Planned>;

const SERIES_NAME: Record<string, string> = SERIES_LABEL;
const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === '23505';

/**
 * IG Stories (lib/stories/api): Lucas's own approve, reject, publish now (a
 * schedule at now) and regenerate; and place / reschedule (D50): the set's
 * day and minute change in stories.sets, its source of truth
 * (repository `rescheduleSet`, which re-projects the set onto the spine). The
 * spine rules come from lib/social-hub/placement.ts; a set posts only in its
 * own series' slot, only once approved, and never once it is posting.
 */
export function storyActions(deps: {
  approve: (setId: string) => Promise<unknown>;
  reject: (setId: string, by: string) => Promise<unknown>;
  publishNow: (setId: string) => Promise<unknown>;
  regenerate: (setId: string, by: string) => Promise<unknown>;
  query: SpineQuery;
  getSet: (setId: string) => Promise<{ set: StorySetView } | null>;
  slotOf: (setId: string) => Promise<{ id: string; publishAt: Date } | null>;
  plan: Plan;
  rescheduleSet: (setId: string, nyDate: string, publishAt: Date) => Promise<unknown>;
}): ContentActions {
  const placement =
    (mode: 'place' | 'reschedule'): ActionFn =>
    async (t, _by, input): Promise<ActionOutcome> => {
      const at = needPlacement(input);
      const setId = need(t, 'setId');
      const got = await deps.getSet(setId);
      if (!got) return { ok: false, note: 'The set is gone.' };
      const set = got.set;
      if (set.status === 'rejected') return { ok: false, note: 'It was rejected, so it can’t be scheduled.' };
      if (set.status === 'publishing' || set.status === 'published') return { ok: false, note: 'It is posting or has posted, so it can’t move.' };
      if (mode === 'place') {
        if (set.status === 'scheduled') return { ok: false, note: 'It already has a slot. Move it instead.' };
        if (set.status !== 'approved') return { ok: false, note: 'Approve this set first: a Story set goes on the calendar only once approved.' };
      } else if (set.status !== 'scheduled') {
        return { ok: false, note: 'It isn’t scheduled, so there is nothing to move.' };
      }
      if (at.slot !== set.series) return { ok: false, note: `A ${SERIES_NAME[set.series] ?? set.series} set posts only in its own slot (${set.series}).` };
      const own = mode === 'reschedule' ? await deps.slotOf(setId) : null;
      const plan = await deps.plan(deps.query, { vertical: 'stories', ...at, moving: own ? { scheduleId: own.id, publishAt: own.publishAt } : null });
      if (!plan.ok) return plan;
      try {
        await deps.rescheduleSet(setId, plan.nyDate, plan.publishAt);
      } catch (error) {
        if (isUniqueViolation(error)) return { ok: false, note: `That day already has a ${SERIES_NAME[set.series] ?? set.series} set.` };
        if ((error as { name?: string } | null)?.name === 'StaleStatusError') return { ok: false, note: 'This set has moved on; refresh to see where it is.' };
        throw error;
      }
      return { ok: true, note: `${mode === 'place' ? 'Scheduled for' : 'Moved to'} ${formatPlacement(plan.publishAt)}.` };
    };
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
    place: placement('place'),
    reschedule: placement('reschedule'),
  };
}
