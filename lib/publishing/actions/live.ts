import type { Vertical } from '@/lib/social-hub/types';

import { carouselActions } from './carousels';
import { explainerActions } from './explainers';
import { reelActions } from './reels';
import { storyActions } from './stories';
import type { ContentActions } from './types';

/** Every type's actions with their live functions (the hub's action routes use this). */
export async function liveContentActions(): Promise<Record<Vertical, ContentActions>> {
  const [{ socialQuery }, carousel, explainersConn, explainersRepo, explainersPublish, explainersSettings, reels, stories, storiesDb] = await Promise.all([
    import('@/lib/social/store'),
    import('@/lib/social/overnight/schedule'),
    import('@/lib/explainers/connection'),
    import('@/lib/explainers/repository'),
    import('@/lib/explainers/publish/publish'),
    import('@/lib/explainers/settings'),
    import('@/lib/reels/publish/schedule'),
    import('@/lib/stories/api'),
    import('@/lib/stories/db'),
  ]);
  const db = storiesDb.liveStoriesDb;
  return {
    carousels: carouselActions({
      query: socialQuery,
      approveSchedule: carousel.approveSchedule,
      approvePost: (q, postId) => carousel.approvePost(q, postId),
      rejectPost: carousel.rejectPost,
      hardPublishPost: carousel.hardPublishPost,
    }),
    explainers: explainerActions({
      db: explainersConn.explainersDb,
      setVerdict: explainersRepo.setVerdict,
      hardPublishJob: explainersPublish.hardPublishJob,
      loadSettings: explainersSettings.loadSettings,
      requestRerender: explainersRepo.requestRerender as never,
    }),
    reels: reelActions({ schedulePostIdea: reels.schedulePostIdea as never, rejectReel: reels.rejectReel, forcePost: reels.forcePost }),
    stories: storyActions({
      approve: (id) => stories.approve(db, id),
      reject: (id, by) => stories.reject(db, id, {}, by),
      publishNow: (id) => stories.publishNow(db, id),
      regenerate: (id, by) => stories.regenerate(db, id, by),
    }),
  };
}
