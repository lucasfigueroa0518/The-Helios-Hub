import { isUuid, type ActionSpec } from '@/lib/social-hub/action-route';

type ScheduleOutcome = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string };

type Deps = {
  approveSchedule: (query: never, scheduleId: string) => Promise<boolean>;
  approvePost: (query: never, postId: string) => Promise<ScheduleOutcome>;
  socialQuery: () => Promise<unknown>;
};

type Target = { scheduleId: string } | { postId: string };

/**
 * Approve a carousel (lib/social/overnight/schedule.ts): one waiting in a slot
 * is approved there (`approveSchedule`); one in review with no slot (Content
 * ready, P2-M4) is approved and placed in the earliest open window (`approvePost`).
 */
export function approveCarousel(deps: Deps): ActionSpec<Target> {
  return {
    flag: 'approveCarousel',
    parse: (b) => {
      const body = b as { scheduleId?: unknown; postId?: unknown } | null;
      if (isUuid(body?.scheduleId)) return { scheduleId: body!.scheduleId as string };
      if (isUuid(body?.postId)) return { postId: body!.postId as string };
      return null;
    },
    run: async (target) => {
      const query = (await deps.socialQuery()) as never;
      if ('scheduleId' in target) {
        const ok = await deps.approveSchedule(query, target.scheduleId);
        return ok ? { ok: true, note: 'Approved.' } : { ok: false, note: 'That slot is no longer scheduled.' };
      }
      const placed = await deps.approvePost(query, target.postId);
      return placed.scheduled
        ? { ok: true, note: `Approved and scheduled for ${placed.publishAt}.` }
        : { ok: false, note: placed.note };
    },
  };
}
