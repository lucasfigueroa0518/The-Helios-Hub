import { redirect } from 'next/navigation';

import { AnalyticsShell } from '@/app/reels/analytics/analytics-shell';
import { PerformanceView } from '@/app/reels/analytics/performance-view';
import { loadPerformancePage } from '@/lib/reels/analytics/performance-store';
import { getSession } from '@/lib/session';

import '../../reels.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Performance analytics · Trial Reels',
  robots: { index: false, follow: false },
};

export default async function PerformanceAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/');
  const params = await searchParams;
  const loaded = await loadPerformancePage(params).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));

  return (
    <AnalyticsShell current="performance">
      {'error' in loaded ? (
        <p className="rh-empty">Could not load performance: {loaded.error}</p>
      ) : (
        <PerformanceView data={loaded} />
      )}
    </AnalyticsShell>
  );
}
