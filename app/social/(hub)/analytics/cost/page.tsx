import { notFound, redirect } from 'next/navigation';

import { CostScreen } from '@/components/social-hub/cost/CostScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { loadCostPage, parseCostParams } from '@/lib/social-hub/cost-page/load';
import { costModel } from '@/lib/social-hub/cost-page/model';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { timeHub, withHubTiming } from '@/lib/social-hub/server-timing';
import { signVisibleStoryFrames, storyFramePostIds } from '@/lib/social-hub/views/story-frames';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cost · Analytics · Social Hub', robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return withHubTiming(async () => {
    if (!SOCIAL_HUB_FLAGS.views.cost) notFound();
    const session = await getSession();
    if (!session) redirect('/');
    const search = new URLSearchParams(toParams(await searchParams) as Record<string, string>);
    const now = new Date();
    const input = await timeHub('dataset', () => loadCostPage(session.email, search, now));
    if ('error' in input) return <LoadError message={input.error} />;
    const model = costModel(input);
    const best = model.worth.best;
    const ids = storyFramePostIds(best ? [best.post] : []);
    const shown = best && ids.size
      ? {
          ...model,
          worth: {
            ...model.worth,
            best: { ...best, post: (await timeHub('sign', () => signVisibleStoryFrames({ posts: [best.post] }, ids))).posts[0] ?? best.post },
          },
        }
      : model;
    return <CostScreen model={shown} params={parseCostParams(search, now)} posts={input.posts} base={HUB_BASE} />;
  });
}
