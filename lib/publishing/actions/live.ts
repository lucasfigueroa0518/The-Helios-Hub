import type { Vertical } from '@/lib/social-hub/types';

import { carouselActions } from './carousels';
import { explainerActions } from './explainers';
import { reelActions } from './reels';
import { storyActions } from './stories';
import type { ContentActions } from './types';

/** Every type's actions with their live functions (the hub's action routes use this). */
export async function liveContentActions(): Promise<Record<Vertical, ContentActions>> {
  const [
    { socialQuery },
    carousel,
    carouselItems,
    carouselRuns,
    explainersConn,
    explainersRepo,
    explainersPublish,
    explainersSettings,
    explainersItems,
    reels,
    reelItems,
    reelFinish,
    reelLocks,
    stories,
    storiesDb,
    storiesRepo,
    placement,
  ] = await Promise.all([
    import('@/lib/social/store'),
    import('@/lib/social/overnight/schedule'),
    import('@/lib/social/overnight/items'),
    import('@/lib/social/overnight/runs'),
    import('@/lib/explainers/connection'),
    import('@/lib/explainers/repository'),
    import('@/lib/explainers/publish/publish'),
    import('@/lib/explainers/settings'),
    import('@/lib/explainers/publish/items'),
    import('@/lib/reels/publish/schedule'),
    import('@/lib/reels/publish/items'),
    import('@/lib/reels/visual/finish'),
    import('@/lib/reels/locks'),
    import('@/lib/stories/api'),
    import('@/lib/stories/db'),
    import('@/lib/stories/repository'),
    import('@/lib/social-hub/placement'),
  ]);
  const db = storiesDb.liveStoriesDb;
  const storiesSpine = (text: string, params?: unknown[]) => db.query(text, params) as Promise<{ rows: any[] }>;
  return {
    carousels: carouselActions({
      query: socialQuery,
      approveSchedule: carousel.approveSchedule,
      approvePost: (q, postId) => carousel.approvePost(q, postId),
      rejectPost: carousel.rejectPost,
      hardPublishPost: carousel.hardPublishPost,
      itemId: carouselItems.carouselItemId,
      placeItem: placement.placeItem,
      rescheduleItem: placement.rescheduleItem,
      requestRerun: carouselRuns.requestRerun,
    }),
    explainers: explainerActions({
      db: explainersConn.explainersDb,
      setVerdict: explainersRepo.setVerdict,
      hardPublishJob: explainersPublish.hardPublishJob,
      loadSettings: explainersSettings.loadSettings,
      requestRerender: explainersRepo.requestRerender as never,
      itemId: explainersItems.explainerItemId,
      verdictOf: async (d, jobId) => (await explainersRepo.getFeedback(d, jobId))?.verdict ?? null,
      placeItem: placement.placeItem,
      rescheduleItem: placement.rescheduleItem,
    }),
    reels: reelActions({
      schedulePostIdea: reels.schedulePostIdea as never,
      rejectReel: reels.rejectReel,
      forcePost: reels.forcePost,
      query: reelItems.reelsSpine,
      itemId: reelItems.reelItemId,
      placeItem: placement.placeItem,
      rescheduleItem: placement.rescheduleItem,
      todaySlate: (postIdeaId) => reelFinish.todaySlateFor(postIdeaId),
      findReelLock: reelLocks.findReelLock,
      requestFinish: (postIdeaId, slateId) => reelFinish.requestFinish(postIdeaId, slateId),
    }),
    stories: storyActions({
      approve: (id) => stories.approve(db, id),
      reject: (id, by) => stories.reject(db, id, {}, by),
      publishNow: (id) => stories.publishNow(db, id),
      regenerate: (id, by) => stories.regenerate(db, id, by),
      query: storiesSpine,
      getSet: (id) => storiesRepo.getSet(db, id),
      slotOf: (id) => placement.activeSlotByRef(storiesSpine, 'stories', id),
      plan: placement.planPlacement,
      // The set's move and its re-projection onto the spine commit together.
      rescheduleSet: (id, nyDate, publishAt) => db.transaction((tx) => storiesRepo.rescheduleSet(tx, id, nyDate, publishAt)),
    }),
  };
}
