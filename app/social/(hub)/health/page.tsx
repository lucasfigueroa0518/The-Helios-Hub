import { notFound, redirect } from 'next/navigation';

import { HealthScreen } from '@/components/social-hub/health/HealthScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { loadHealthPage } from '@/lib/social-hub/health/load';
import { healthModel } from '@/lib/social-hub/health/view';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Health · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.health) notFound();
  const session = await getSession();
  if (!session) redirect('/');
  const windowNights = toParams(await searchParams).nights === '30' ? 30 : 14;
  const now = new Date();
  const loaded = await loadHealthPage(now, windowNights);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  return <HealthScreen model={healthModel({ ...loaded, now, windowNights })} base={HUB_BASE} />;
}
