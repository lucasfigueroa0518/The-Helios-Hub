import type { HubPost } from '@/lib/social-hub/types';
import { clock } from '@/lib/social-hub/views/format';
import { PLAN, windowRange } from '@/lib/social-hub/views/plan';

/**
 * The time line on a Today's Content card: when it posts (or posted); "Being
 * made"; for a Stories set waiting for Approve, when its window is (B4:
 * Stories book a minute only once approved); otherwise "No slot yet".
 */
export function cardTimeLine(post: HubPost): string {
  const when = post.postedAt ?? post.publishAt;
  if (when) return clock(when);
  if (post.status === 'generating') return 'Being made';
  if (post.vertical === 'stories' && post.status === 'ready' && !post.approval.approvedAt) {
    const w = PLAN.stories.find((x) => x.label === post.idea?.label);
    if (w) return `No slot yet · posts ${windowRange(w)} once approved`;
  }
  return 'No slot yet';
}
