import { notFound, redirect } from 'next/navigation';

import { OverviewScreen } from '@/components/social-hub/analytics/OverviewScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { RefreshNote } from '@/components/social-hub/RefreshNote';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { timeHub, withHubTiming } from '@/lib/social-hub/server-timing';
import { ANALYTICS_TOP_POSTS, analyticsTablePosts, overviewKpis, parseQuery } from '@/lib/social-hub/views/analytics';
import { legacyAnalyticsRedirect } from '@/lib/social-hub/views/legacy-routes';
import { signVisibleStoryFrames, storyFramePostIds } from '@/lib/social-hub/views/story-frames';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Analytics · Social Hub', robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return withHubTiming(async () => {
    if (!SOCIAL_HUB_FLAGS.views.analytics) notFound();
    const params = toParams(await searchParams);
    const legacy = legacyAnalyticsRedirect(HUB_BASE, params);
    if (legacy) redirect(legacy);
    const session = await getSession();
    if (!session) redirect('/');
    const loaded = await timeHub('dataset', () => loadForPage(session.email));
    if ('error' in loaded) return <LoadError message={loaded.error} />;
    const now = new Date();
    const q = parseQuery(params, null, now);
    const table = analyticsTablePosts(overviewKpis(loaded.posts, q, null).posts, q, params.posts === 'all' || q.page > 1 ? undefined : ANALYTICS_TOP_POSTS);
    const dataset = await timeHub('sign', () => signVisibleStoryFrames(loaded, storyFramePostIds(table.items)));
    return (
      <>
        <RefreshNote refresh={loaded.refresh} />
        <OverviewScreen dataset={dataset} base={HUB_BASE} params={params} now={now} />
      </>
    );
  });
}
