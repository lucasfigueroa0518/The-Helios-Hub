import { isUuid, type ActionSpec } from '@/lib/social-hub/action-route';

type Deps = {
  approveSchedule: (query: never, scheduleId: string) => Promise<boolean>;
  socialQuery: () => Promise<unknown>;
};

/** Approve a carousel slot: `approveSchedule()` in lib/social/overnight/schedule.ts ("the Social Hub review screen"). */
export function approveCarousel(deps: Deps): ActionSpec<{ scheduleId: string }> {
  return {
    flag: 'approveCarousel',
    parse: (b) => (isUuid((b as { scheduleId?: unknown })?.scheduleId) ? { scheduleId: (b as { scheduleId: string }).scheduleId } : null),
    run: async ({ scheduleId }) => {
      const ok = await deps.approveSchedule((await deps.socialQuery()) as never, scheduleId);
      return ok ? { ok: true, note: 'Approved.' } : { ok: false, note: 'That slot is no longer scheduled.' };
    },
  };
}
