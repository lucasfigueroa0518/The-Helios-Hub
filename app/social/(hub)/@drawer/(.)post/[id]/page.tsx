import { PostDrawerScreen } from '@/components/social-hub/post/PostScreen';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { timeHub, withHubTiming } from '@/lib/social-hub/server-timing';
import { signOpenedPost } from '@/lib/social-hub/views/story-frames';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** A post opened from any hub list: drawn over that list (intercepted route, REVISIONS G10). */
export default function DrawerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  return withHubTiming(async () => {
    if (!SOCIAL_HUB_FLAGS.views.post) return null;
    const session = await getSession();
    if (!session) return null;
    const loaded = await timeHub('dataset', () => loadForPage(session.email));
    if ('error' in loaded) return null;
    const { id } = await params;
    const from = (await searchParams).from;
    const dataset = await timeHub('sign', () => signOpenedPost(loaded, id));
    return <PostDrawerScreen dataset={dataset} base={HUB_BASE} id={id} from={typeof from === 'string' ? from : undefined} now={new Date()} />;
  });
}
