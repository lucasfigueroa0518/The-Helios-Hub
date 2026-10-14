import { notFound, redirect } from 'next/navigation';

import { CostScreen } from '@/components/social-hub/cost/CostScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { loadCostPage, parseCostParams } from '@/lib/social-hub/cost-page/load';
import { costModel } from '@/lib/social-hub/cost-page/model';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cost · Analytics · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.cost) notFound();
  const session = await getSession();
  if (!session) redirect('/');
  const search = new URLSearchParams(toParams(await searchParams) as Record<string, string>);
  const now = new Date();
  const input = await loadCostPage(session.email, search, now);
  if ('error' in input) return <LoadError message={input.error} />;
  return <CostScreen model={costModel(input)} params={parseCostParams(search, now)} posts={input.posts} base={HUB_BASE} />;
}
