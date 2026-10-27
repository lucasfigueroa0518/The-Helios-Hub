import { unstable_cache } from 'next/cache';

import { readAllProgress, type AllProgress } from '@/lib/content-type/progress';
import { readRunMisses, type RunMisses } from '@/lib/content-type/run-misses';
import { liveHubQuery } from '@/lib/social-hub/db';
import { HUB_DATA_TAG, hubDataTag } from '@/lib/social-hub/views/cache-tags';
import { loadLibraries, type LibrariesModel } from '@/lib/social-hub/views/libraries';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

/**
 * Content's warm click spends its time here, not in the dataset (Server-Timing:
 * dataset ~5 ms, extras ~0.5–1.2 s once the dataset cache has hit). Same minute
 * and the same tags as the assembled dataset, so an action that drops a type
 * drops these too. Signed frame URLs stay outside this cache. Refresh state
 * stays fresh on every visit.
 */
const deployment = process.env.VERCEL_DEPLOYMENT_ID ?? 'local';
const tags = [HUB_DATA_TAG, ...VERTICAL_IDS.map(hubDataTag)];

export const loadCachedLibraries = unstable_cache(
  (): Promise<LibrariesModel> => loadLibraries(liveHubQuery),
  ['social-hub-libraries', deployment, 'v1'],
  { revalidate: 60, tags },
);

export const readCachedProgress = unstable_cache(
  (): Promise<AllProgress> => readAllProgress(),
  ['social-hub-progress', deployment, 'v1'],
  { revalidate: 60, tags },
);

export const readCachedMisses = unstable_cache(
  (): Promise<RunMisses> => readRunMisses(liveHubQuery),
  ['social-hub-misses', deployment, 'v1'],
  { revalidate: 60, tags },
);
