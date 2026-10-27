import { notFound, redirect } from 'next/navigation';

import { ContentScreen } from '@/components/social-hub/content/ContentScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { liveHubQuery } from '@/lib/social-hub/db';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { allQuotaCandidates } from '@/lib/social-hub/views/day-rank';
import { legacyRootRedirect } from '@/lib/social-hub/views/legacy-routes';
import { loadLibraries } from '@/lib/social-hub/views/libraries';
import { signVisibleStoryFrames } from '@/lib/social-hub/views/story-frames';
import { readAllProgress } from '@/lib/content-type/progress';
import { NO_MISSES, readRunMisses } from '@/lib/content-type/run-misses';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Today · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.house) notFound();
  const params = toParams(await searchParams);
  const legacy = legacyRootRedirect(HUB_BASE, params);
  if (legacy) redirect(legacy);
  const session = await getSession();
  if (!session) redirect('/');
  const [loaded, libraries, progress, misses] = await Promise.all([
    loadForPage(session.email),
    loadLibraries(liveHubQuery),
    readAllProgress(),
    readRunMisses(liveHubQuery).catch(() => NO_MISSES),
  ]);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  const now = new Date();
  // Today's cards are the frames on screen. Their URLs are signed once, outside the shared cache.
  const shown = new Set(allQuotaCandidates(loaded, now).flatMap((c) => (c.post ? [c.post.id] : [])));
  const dataset = await signVisibleStoryFrames(loaded, shown);
  return <ContentScreen dataset={dataset} base={HUB_BASE} now={now} libraries={libraries} progress={progress} misses={misses} />;
}
