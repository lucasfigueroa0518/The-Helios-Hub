import { notFound, redirect } from 'next/navigation';

import { LoadError } from '@/components/social-hub/LoadError';
import { RefreshNote } from '@/components/social-hub/RefreshNote';
import { PostScreen } from '@/components/social-hub/screens/PostScreen';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Post · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!SOCIAL_HUB_FLAGS.views.post) notFound();
  const session = await getSession();
  if (!session) redirect('/');
  const loaded = await loadForPage(session.email);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  return (
    <>
      <RefreshNote refresh={loaded.refresh} />
      <PostScreen dataset={loaded} base={HUB_BASE} id={(await params).id} />
    </>
  );
}
