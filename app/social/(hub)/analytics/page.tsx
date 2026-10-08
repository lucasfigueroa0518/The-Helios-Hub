import { notFound, redirect } from 'next/navigation';

import { LoadError } from '@/components/social-hub/LoadError';
import { RefreshNote } from '@/components/social-hub/RefreshNote';
import { AnalyticsScreen } from '@/components/social-hub/screens/AnalyticsScreen';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { compareIds, HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Analytics · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.analytics) notFound();
  const session = await getSession();
  if (!session) redirect('/');
  const raw = await searchParams;
  const loaded = await loadForPage(session.email);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  return (
    <>
      <RefreshNote refresh={loaded.refresh} />
      <AnalyticsScreen dataset={loaded} base={HUB_BASE} params={toParams(raw)} compare={compareIds(raw)} now={new Date()} />
    </>
  );
}
