import { actionRoute } from '@/lib/social-hub/action-route';
import { explainersDb } from '@/lib/explainers/connection';
import { requestRerender } from '@/lib/explainers/repository';
import { loadSettings } from '@/lib/explainers/settings';
import { regenerate } from '@/lib/stories/api';
import { liveStoriesDb } from '@/lib/stories/db';

import { hardRegenerate } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = actionRoute(hardRegenerate({
  explainersDb,
  loadExplainerSettings: loadSettings as never,
  explainerRerender: requestRerender as never,
  storiesRegenerate: regenerate as never,
  storiesDb: liveStoriesDb,
}));
