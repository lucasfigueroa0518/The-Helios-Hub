import type { Queryable } from '@/lib/explainers/db';

/**
 * The one interface the Social Hub calls for Reel AI Drama (planning/AI Mini Docs/HUB-WIRING-CONTRACT.md §4). Names
 * and signatures here are frozen; the bodies live in the files re-exported below.
 */

export type DramaDb = Queryable;
export type { DramaQuery } from './hub-read';

export const DRAMA_VERTICAL = 'reel_ai_drama' as const;
export { DRAMA_WINDOWS, DRAMA_NIGHT_HOUR_NY, DRAMA_INSIGHTS_HOUR_NY, DRAMA_INSIGHTS_MINUTE_NY } from './publish/config';

// §4.1 Identity and review
export { dramaItemId, syncDramaApproval } from './publish/items';
export { latestDramaJobId, dramaVerdictOf, setDramaVerdict, DRAMA_REVIEW_TAGS, type DramaReviewTag } from './review';

// §4.2 Scheduling and publishing
export {
  dramaPublishingLive,
  dramaRequireApproval,
  scheduleDramaJob,
  unscheduleDramaJob,
  dramaReleaseDue,
  scheduleApprovedDrama,
  type DramaScheduleOutcome,
} from './publish/schedule';
export {
  hardPublishDramaJob,
  dramaQueuePublish,
  dramaFailStaleAttempts,
  dramaCarryAttempt,
  dramaCaption,
  type DramaQueued,
  type DramaPublishDeps,
} from './publish/publish';
export { pollDramaInsights } from './publish/insights';

// §4.3 Making content
export {
  requestDramaJob,
  requestDramaJobs,
  dramaInFlightPitchIds,
  dramaRunCostUsd,
  DRAMA_REFUSAL_TEXT,
  type DramaRefusal,
} from './requests';

// §4.4 Posting settings
export { readDramaPosting, writeDramaPosting, DramaPostingError, type DramaPosting } from './hub-posting';

// §4.5 – §4.7 Hub reads (write-free; hub read code may import ./hub-read directly)
export {
  dramaSchemaReady,
  DRAMA_JOBS_SQL,
  DRAMA_PITCHES_SQL,
  DRAMA_REQUIRE_APPROVAL_SQL,
  DRAMA_POSTS_PER_DAY_SQL,
  readDramaNightHealth,
  readDramaCosts,
  readDramaCacheTokens,
  readDramaDailySpendCap,
  DRAMA_COST_COMPONENTS,
  readDramaProgress,
  readDramaMisses,
  type DramaNightHealth,
  type DramaCostEventRow,
  type DramaRenderedRow,
  type DramaProgressRow,
} from './hub-read';

// §4.6 Night (the worker only)
export { runDramaNight, type DramaNightResult } from './night';

export type { DramaJobRow, DramaPitchRow } from './hub-read';

