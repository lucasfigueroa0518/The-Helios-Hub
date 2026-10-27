import { notFound, redirect } from 'next/navigation';

import { TypeScreen } from '@/components/social-hub/analytics/TypeScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { RefreshNote } from '@/components/social-hub/RefreshNote';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { timeHub, withHubTiming } from '@/lib/social-hub/server-timing';
import { analyticsTablePosts, overviewKpis, parseQuery } from '@/lib/social-hub/views/analytics';
import { signVisibleStoryFrames, storyFramePostIds } from '@/lib/social-hub/views/story-frames';
import { isVertical, verticalInfo } from '@/lib/social-hub/verticals';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  return { title: `${isVertical(type) ? verticalInfo(type).label : 'Analytics'} · Social Hub`, robots: { index: false, follow: false } };
}

export default function Page({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<RawSearchParams> }) {
  return withHubTiming(async () => {
    const { type } = await params;
    if (!SOCIAL_HUB_FLAGS.views.analytics || !isVertical(type)) notFound();
    const session = await getSession();
    if (!session) redirect('/');
    const loaded = await timeHub('dataset', () => loadForPage(session.email));
    if ('error' in loaded) return <LoadError message={loaded.error} />;
    const now = new Date();
    const query = toParams(await searchParams);
    const q = parseQuery(query, type, now);
    const table = analyticsTablePosts(overviewKpis(loaded.posts, q, type).posts, q);
    const dataset = await timeHub('sign', () => signVisibleStoryFrames(loaded, storyFramePostIds(table.items)));
    return (
      <>
        <RefreshNote refresh={loaded.refresh} />
        <TypeScreen dataset={dataset} base={HUB_BASE} vertical={type} params={query} now={now} />
      </>
    );
  });
}
