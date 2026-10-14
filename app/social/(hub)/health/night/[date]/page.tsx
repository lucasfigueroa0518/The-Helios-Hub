import { notFound, redirect } from 'next/navigation';

import { NightDetail } from '@/components/social-hub/health/NightDetail';
import { LoadError } from '@/components/social-hub/LoadError';
import { liveHubQuery } from '@/lib/social-hub/db';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { readReports } from '@/lib/social-hub/health/store';
import { nightsEnding } from '@/lib/social-hub/health/time';
import { NIGHT_LOOKBACK } from '@/lib/social-hub/health/view';
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
  let history;
  try {
    // The 14 nights ending here, so each failure can say how often it recurred.
    history = await readReports(liveHubQuery, nightsEnding(date, NIGHT_LOOKBACK)[0]!, date);
  } catch (error) {
    return <LoadError message={error instanceof Error ? error.message : String(error)} />;
  }
  const report = history.find((r) => r.night === date);
  if (!report) return <LoadError message="No report for that night." />;
  return <NightDetail report={report} history={history} base={HUB_BASE} />;
}
