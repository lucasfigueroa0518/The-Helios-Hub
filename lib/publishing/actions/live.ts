import { postsToInstagram, stateOf } from '@/lib/content-type/state';
import { STORY_VERTICALS, type StoryVertical } from '@/lib/social-hub/story-types';
import type { Vertical } from '@/lib/social-hub/types';

import { carouselActions } from './carousels';
import { explainerActions } from './explainers';
import { reelActions } from './reels';
import { storyActions } from './stories';
import { lastFewDaysActions } from './last-few-days';
import { aiEventsActions } from './ai-events';
import { fieldNotesActions } from './field-notes';
import { reelAiDramaActions } from './reel-ai-drama';
import type { ContentActions } from './types';

/** Whether a type's stored pair is the Live state (settings standard D16): posts go to Instagram only then. */
const isLive = (s: { autoRun: boolean; publishingLive: boolean }): boolean => postsToInstagram(stateOf(s.autoRun, s.publishingLive).state);

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
    explainersSchedule,
    lfdSchedule,
    lfdItems,
    lfdSettings,
    aiSchedule,
    aiItems,
    aiSettings,
    aiManual,
    fnSchedule,
    fnItems,
    fnSettings,
    fnManual,
    drama,
    carouselRefill,
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
    import('@/lib/explainers/publish/schedule'),
    import('@/lib/lfd/schedule'),
    import('@/lib/lfd/items'),
    import('@/lib/lfd/settings'),
    import('@/lib/ai-events/schedule'),
    import('@/lib/ai-events/items'),
    import('@/lib/ai-events/settings'),
    import('@/lib/ai-events/manual'),
    import('@/lib/field-notes/schedule'),
    import('@/lib/field-notes/items'),
    import('@/lib/field-notes/settings'),
    import('@/lib/field-notes/manual'),
    import('@/lib/reel-ai-drama/hub'),
    import('@/lib/social/refill'),
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
      unschedulePost: carousel.unschedulePost,
      requestRerun: carouselRuns.requestRerun,
      // Live only (D16): stateOf(auto_run, publishing_live); a failed read reads as paused.
      publishingLive: async (q) => (await carouselRefill.readTypeGate(q, 'carousels')).posts,
    }),
    explainers: explainerActions({
      db: explainersConn.explainersDb,
      setVerdict: explainersRepo.setVerdict,
      hardPublishJob: explainersPublish.hardPublishJob,
      loadSettings: explainersSettings.loadSettings,
      requestRerender: explainersRepo.requestRerender as never,
      itemId: explainersItems.explainerItemId,
      unscheduleJob: explainersSchedule.unscheduleJob,
      latestJobId: async (d, topicId) => (await d.query<{ id: string }>(`SELECT id::text AS id FROM explainers.jobs WHERE topic_id = $1 AND status = 'ok' ORDER BY finished_at DESC NULLS LAST, seq DESC LIMIT 1`, [topicId])).rows[0]?.id ?? null,
      verdictOf: async (d, jobId) => (await explainersRepo.getFeedback(d, jobId))?.verdict ?? null,
      placeItem: placement.placeItem,
      rescheduleItem: placement.rescheduleItem,
      scheduleJob: (d, jobId, source, now, through) => explainersSchedule.scheduleJob(d, jobId, source, now, through),
      publishingLive: explainersSchedule.publishingLive,
      // Approval or Live books (contract §4.3); Paused approves without a slot (D17).
      holdsSlots: explainersSchedule.explainersHoldsSlots,
      // D18: approved while Paused, it is never placed automatically later.
      holdApproved: (d, jobId) => explainersSchedule.holdApprovedRender(d, jobId),
      // Revision rows live where the social worker claims them (DATABASE_URL); only when explainers share that database.
      revisionsQuery: async () => (process.env.EXPLAINERS_DB === 'supabase' && !process.env.EXPLAINERS_DATABASE_URL?.trim() ? socialQuery() : null),
    }),
    reels: reelActions({
      schedulePostIdea: reels.schedulePostIdea as never,
      rejectReel: reels.rejectReel,
      forcePost: reels.forcePost,
      publishingLive: () => reels.publishingLive(),
      // Approval or Live books (contract §4.3); Paused approves without a slot (D17).
      holdsSlots: () => reels.reelsHoldsSlots(),
      approveVideo: (videoJobId) => reelItems.approveReel(videoJobId, 'user'),
      // D18: approved while Paused, it is never placed automatically later.
      holdApproved: (postIdeaId, videoJobId) => reels.holdApprovedReel(postIdeaId, videoJobId),
      unscheduleIdea: reels.unscheduleIdea,
      query: reelItems.reelsSpine,
      itemId: reelItems.reelItemId,
      placeItem: placement.placeItem,
      rescheduleItem: placement.rescheduleItem,
      todaySlate: (postIdeaId) => reelFinish.todaySlateFor(postIdeaId),
      findReelLock: reelLocks.findReelLock,
      requestFinish: (postIdeaId, slateId) => reelFinish.requestFinish(postIdeaId, slateId),
    }),
    // One engine, one set of verbs per Stories-format type (SS-1).
    ...Object.fromEntries(STORY_VERTICALS.map((vertical) => [vertical, storyActions({
      vertical,
      approve: (id) => stories.approve(db, id),
      reject: (id, by) => stories.reject(db, id, {}, by),
      publishNow: (id) => stories.publishNow(db, id),
      regenerate: (id, by) => stories.regenerate(db, id, by),
      unscheduleSet: (id) => db.transaction((tx) => storiesRepo.unscheduleSet(tx, id)),
      query: storiesSpine,
      getSet: (id) => storiesRepo.getSet(db, id),
      slotOf: (id) => placement.activeSlotByRef(storiesSpine, vertical, id),
      plan: placement.planPlacement,
      // The set's move and its re-projection onto the spine commit together.
      rescheduleSet: (id, nyDate, publishAt, slotMinute, slotBy) => db.transaction((tx) => storiesRepo.rescheduleSet(tx, id, nyDate, publishAt, slotMinute, slotBy)),
    })])) as Record<StoryVertical, ContentActions>,
    last_few_days: lastFewDaysActions({
      query: socialQuery,
      approvePost: (q, postId) => lfdSchedule.approveLfdPost(q, postId),
      rejectPost: lfdSchedule.rejectLfdPost,
      hardPublishPost: lfdSchedule.hardPublishLfdPost,
      // Live only (D16): Generate (auto_run) and publishing_live both on; Generate off with Live on reads as paused.
      publishingLive: async (q) => isLive(await lfdSettings.readLfdSettings(q)),
      unschedulePost: lfdSchedule.unscheduleLfdPost,
      itemId: lfdItems.lfdItemId,
      placeItem: placement.placeItem,
      rescheduleItem: placement.rescheduleItem,
    }),
    ai_events: aiEventsActions({
      query: socialQuery,
      approvePost: (q, postId) => aiSchedule.approveAiEventsPost(q, postId),
      rejectPost: aiSchedule.rejectAiEventsPost,
      hardPublishPost: aiSchedule.hardPublishAiEventsPost,
      // Live only (D16): Generate (auto_run) and publishing_live both on; Generate off with Live on reads as paused.
      publishingLive: async (q) => isLive(await aiSettings.readAiEventsSettings(q)),
      unschedulePost: aiSchedule.unscheduleAiEventsPost,
      queueRebuild: (q, o) => aiManual.queueAiEventsRun(q, { kind: 'rebuild', requestedBy: o.requestedBy, weekKey: o.weekKey }),
      itemId: aiItems.aiEventsItemId,
      placeItem: placement.placeItem,
      rescheduleItem: placement.rescheduleItem,
    }),
    field_notes: fieldNotesActions({
      query: socialQuery,
      approvePost: (q, postId) => fnSchedule.approveFieldNotesPost(q, postId),
      rejectPost: fnSchedule.rejectFieldNotesPost,
      hardPublishPost: fnSchedule.hardPublishFieldNotesPost,
      // Live only (D16): Generate (auto_run) and publishing_live both on; Generate off with Live on reads as paused.
      publishingLive: async (q) => isLive(await fnSettings.readFieldNotesSettings(q)),
      unschedulePost: fnSchedule.unscheduleFieldNotesPost,
      queueRebuild: (q, o) => fnManual.queueFieldNotesRun(q, { kind: 'rebuild', requestedBy: o.requestedBy }),
      itemId: fnItems.fieldNotesItemId,
      placeItem: placement.placeItem,
      rescheduleItem: placement.rescheduleItem,
    }),
    // AI Drama Reels live on the explainers connection (schema reel_ai_drama), so the Explainers revisions rule applies.
    reel_ai_drama: reelAiDramaActions({
      db: explainersConn.explainersDb,
      setVerdict: drama.setDramaVerdict,
      hardPublishJob: drama.hardPublishDramaJob,
      requestJob: drama.requestDramaJob,
      itemId: drama.dramaItemId,
      unscheduleJob: drama.unscheduleDramaJob,
      latestJobId: drama.latestDramaJobId,
      verdictOf: drama.dramaVerdictOf,
      scheduleJob: drama.scheduleDramaJob,
      publishingLive: drama.dramaPublishingLive,
      // Approval or Live books (contract §4.3); Paused approves without a slot (D17).
      holdsSlots: drama.dramaHoldsSlots,
      // D18: approved while Paused, it is never placed automatically later.
      holdApproved: (d, jobId) => drama.holdApprovedDrama(d, jobId),
      placeItem: placement.placeItem,
      rescheduleItem: placement.rescheduleItem,
      revisionsQuery: async () => (process.env.EXPLAINERS_DB === 'supabase' && !process.env.EXPLAINERS_DATABASE_URL?.trim() ? socialQuery() : null),
    }),
  };
}
