import { notFound, redirect } from 'next/navigation';

import { ContentScreen } from '@/components/social-hub/content/ContentScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { RefreshNote } from '@/components/social-hub/RefreshNote';
import { liveHubQuery } from '@/lib/social-hub/db';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { legacyRootRedirect } from '@/lib/social-hub/views/legacy-routes';
import { loadLibraries } from '@/lib/social-hub/views/libraries';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Today · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.house) notFound();
  const legacy = legacyRootRedirect(HUB_BASE, toParams(await searchParams));
  if (legacy) redirect(legacy);
  const session = await getSession();
  if (!session) redirect('/');
  const [loaded, libraries] = await Promise.all([loadForPage(session.email), loadLibraries(liveHubQuery)]);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  return (
    <>
      <RefreshNote refresh={loaded.refresh} />
      <ContentScreen dataset={loaded} base={HUB_BASE} now={new Date()} libraries={libraries} />
    </>
  );
}
