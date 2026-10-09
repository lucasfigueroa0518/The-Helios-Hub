import { notFound, redirect } from 'next/navigation';

import { CompareScreen } from '@/components/social-hub/analytics/CompareScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Compare · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.analytics) notFound();
  const session = await getSession();
  if (!session) redirect('/');
  const loaded = await loadForPage(session.email);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  const raw = (await searchParams).ids;
  const ids = (Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  return <CompareScreen dataset={loaded} base={HUB_BASE} ids={ids} />;
}
