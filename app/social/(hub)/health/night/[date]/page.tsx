import { notFound, redirect } from 'next/navigation';

import { NightDetail } from '@/components/social-hub/health/NightDetail';
import { LoadError } from '@/components/social-hub/LoadError';
import { liveHubQuery } from '@/lib/social-hub/db';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { readReports } from '@/lib/social-hub/health/store';
import { HUB_BASE } from '@/lib/social-hub/links';
import { isDayKey } from '@/lib/social-hub/time';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Night · Health · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ date: string }> }) {
  if (!SOCIAL_HUB_FLAGS.views.health) notFound();
  const session = await getSession();
  if (!session) redirect('/');
  const { date } = await params;
  if (!isDayKey(date)) notFound();
  let report;
  try {
    [report] = await readReports(liveHubQuery, date, date);
  } catch (error) {
    return <LoadError message={error instanceof Error ? error.message : String(error)} />;
  }
  if (!report) return <LoadError message="No report for that night." />;
  return <NightDetail report={report} base={HUB_BASE} />;
}
