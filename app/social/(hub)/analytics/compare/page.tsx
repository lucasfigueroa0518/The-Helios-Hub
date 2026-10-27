import { notFound, redirect } from 'next/navigation';

import { CompareScreen } from '@/components/social-hub/analytics/CompareScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { comparePosts } from '@/lib/social-hub/analytics';
import { HUB_BASE, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { timeHub, withHubTiming } from '@/lib/social-hub/server-timing';
import { signVisibleStoryFrames, storyFramePostIds } from '@/lib/social-hub/views/story-frames';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Compare · Social Hub', robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return withHubTiming(async () => {
    if (!SOCIAL_HUB_FLAGS.views.analytics) notFound();
    const session = await getSession();
    if (!session) redirect('/');
    const loaded = await timeHub('dataset', () => loadForPage(session.email));
    if ('error' in loaded) return <LoadError message={loaded.error} />;
    const raw = (await searchParams).ids;
    const ids = (Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
    const dataset = await timeHub('sign', () => signVisibleStoryFrames(loaded, storyFramePostIds(comparePosts(loaded.posts, ids))));
    return <CompareScreen dataset={dataset} base={HUB_BASE} ids={ids} />;
  });
}
