import { redirect } from 'next/navigation';

import { AnalyticsShell } from '@/app/reels/analytics/analytics-shell';
import { AnalyticsView } from '@/app/reels/analytics/analytics-view';
import { loadCostPage } from '@/lib/reels/analytics/costs';
import { getSession } from '@/lib/session';

import '../reels.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Cost analytics · Trial Reels',
  robots: { index: false, follow: false },
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; ledger?: string; from?: string; to?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/');
  const params = await searchParams;
  const loaded = await loadCostPage(params).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));

  return (
    <AnalyticsShell current="cost">
      {'error' in loaded ? (
        <p className="rh-empty">Could not load costs: {loaded.error}</p>
      ) : (
        <AnalyticsView data={loaded} />
      )}
    </AnalyticsShell>
  );
}
