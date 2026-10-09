import { PostDrawerScreen } from '@/components/social-hub/post/PostScreen';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** A post opened from any hub list: drawn over that list (intercepted route, REVISIONS G10). */
export default async function DrawerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.post) return null;
  const session = await getSession();
  if (!session) return null;
  const loaded = await loadForPage(session.email);
  if ('error' in loaded) return null;
  const from = (await searchParams).from;
  return <PostDrawerScreen dataset={loaded} base={HUB_BASE} id={(await params).id} from={typeof from === 'string' ? from : undefined} now={new Date()} />;
}
