import { notFound, redirect } from 'next/navigation';

import { TypeScreen } from '@/components/social-hub/analytics/TypeScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { RefreshNote } from '@/components/social-hub/RefreshNote';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { isVertical, verticalInfo } from '@/lib/social-hub/verticals';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  return { title: `${isVertical(type) ? verticalInfo(type).label : 'Analytics'} · Social Hub`, robots: { index: false, follow: false } };
}

export default async function Page({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<RawSearchParams> }) {
  const { type } = await params;
  if (!SOCIAL_HUB_FLAGS.views.analytics || !isVertical(type)) notFound();
  const session = await getSession();
  if (!session) redirect('/');
  const loaded = await loadForPage(session.email);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  return (
    <>
      <RefreshNote refresh={loaded.refresh} />
      <TypeScreen dataset={loaded} base={HUB_BASE} vertical={type} params={toParams(await searchParams)} now={new Date()} />
    </>
  );
}
