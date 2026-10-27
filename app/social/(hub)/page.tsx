import { notFound, redirect } from 'next/navigation';

import { ContentScreen } from '@/components/social-hub/content/ContentScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { liveHubQuery } from '@/lib/social-hub/db';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { readRefresh } from '@/lib/social-hub/live';
import { timeHub, withHubTiming } from '@/lib/social-hub/server-timing';
import { allQuotaCandidates } from '@/lib/social-hub/views/day-rank';
import { legacyRootRedirect } from '@/lib/social-hub/views/legacy-routes';
import { loadLibraries } from '@/lib/social-hub/views/libraries';
import { signVisibleStoryFrames } from '@/lib/social-hub/views/story-frames';
import { loadHubDataset } from '@/lib/social-hub/views/cached-dataset';
import { readAllProgress } from '@/lib/content-type/progress';
import { NO_MISSES, readRunMisses } from '@/lib/content-type/run-misses';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Today · Social Hub', robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return withHubTiming(async () => {
    if (!SOCIAL_HUB_FLAGS.views.house) notFound();
    const params = toParams(await searchParams);
    const legacy = legacyRootRedirect(HUB_BASE, params);
    if (legacy) redirect(legacy);
    const session = await getSession();
    if (!session) redirect('/');
    const [datasetResult, extras] = await Promise.all([
      timeHub('dataset', async () => {
        try {
          return { dataset: await loadHubDataset() };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      }),
      timeHub('extras', () => Promise.all([
        readRefresh(session.email),
        loadLibraries(liveHubQuery),
        readAllProgress(),
        readRunMisses(liveHubQuery).catch(() => NO_MISSES),
      ])),
    ]);
    if ('error' in datasetResult && typeof datasetResult.error === 'string') return <LoadError message={datasetResult.error} />;
    const [refresh, libraries, progress, misses] = extras;
    const loaded = { ...datasetResult.dataset, refresh };
    const now = new Date();
    // Today's cards are the frames on screen, including the next frame a card preloads. Signed once, outside the shared cache.
    const shown = new Set(allQuotaCandidates(loaded, now).flatMap((c) => (c.post ? [c.post.id] : [])));
    const dataset = await timeHub('sign', () => signVisibleStoryFrames(loaded, shown));
    return <ContentScreen dataset={dataset} base={HUB_BASE} now={now} libraries={libraries} progress={progress} misses={misses} />;
  });
}
