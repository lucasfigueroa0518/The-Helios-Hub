import type { ContentActions } from '@/lib/publishing/actions/types';
import { isUuid } from '@/lib/social-hub/action-route';
import type { Vertical } from '@/lib/social-hub/types';

import { contentAction, type Parsed } from '../content-action';

/**
 * Approve a carousel (D47 user-action layer, `carouselActions.approve`): a slot
 * waiting for approval is approved there; a carousel in review is approved and
 * placed in the earliest open window (P2-M4). Older bodies: `{ scheduleId }` or `{ postId }`.
 */
export function approveCarousel(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({
    flag: 'approveCarousel',
    verb: 'approve',
    actions,
    allowed: ['carousels'],
    legacy: (b): Parsed | null => {
      const body = b as { scheduleId?: unknown; postId?: unknown } | null;
      if (isUuid(body?.scheduleId)) return { vertical: 'carousels', target: { scheduleId: body!.scheduleId as string } };
      if (isUuid(body?.postId)) return { vertical: 'carousels', target: { postId: body!.postId as string } };
      return null;
    },
  });
}
