import { notFound, redirect } from 'next/navigation';

import { OverviewScreen } from '@/components/social-hub/analytics/OverviewScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { RefreshNote } from '@/components/social-hub/RefreshNote';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { legacyAnalyticsRedirect } from '@/lib/social-hub/views/legacy-routes';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Analytics · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.analytics) notFound();
  const params = toParams(await searchParams);
  const legacy = legacyAnalyticsRedirect(HUB_BASE, params);
  if (legacy) redirect(legacy);
  const session = await getSession();
  if (!session) redirect('/');
  const loaded = await loadForPage(session.email);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  return (
    <>
      <RefreshNote refresh={loaded.refresh} />
      <OverviewScreen dataset={loaded} base={HUB_BASE} params={params} now={new Date()} />
    </>
  );
}
