import { actionRoute } from '@/lib/social-hub/action-route';
import { explainersDb } from '@/lib/explainers/connection';
import { hardPublishJob } from '@/lib/explainers/publish/publish';
import { forcePost } from '@/lib/reels/publish/schedule';
import { hardPublishPost } from '@/lib/social/overnight/schedule';
import { socialQuery } from '@/lib/social/store';
import { publishNow } from '@/lib/stories/api';
import { liveStoriesDb } from '@/lib/stories/db';

import { hardPublish } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = actionRoute(hardPublish({
  reelsForcePost: forcePost,
  carouselHardPublish: hardPublishPost as never,
  socialQuery,
  explainerHardPublish: hardPublishJob as never,
  explainersDb,
  storiesPublishNow: publishNow as never,
  storiesDb: liveStoriesDb,
}));
