import { redirect } from 'next/navigation';

import { HealthView } from '@/app/reels/health/health-view';
import { loadHealthPage } from '@/lib/reels/health';
import { getSession } from '@/lib/session';

import '../reels.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Health · Text on Screen',
  robots: { index: false, follow: false },
};

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/');
  const params = await searchParams;
  const loaded = await loadHealthPage(params.days === '30' ? 30 : 7).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));

  return (
    <div className="rh">
      <div className="rh__inner">
        <header className="rh__head">
          <div>
            <p className="rh__kicker">Text on Screen</p>
            <h1 className="rh__title">Health</h1>
          </div>
        </header>
        {'error' in loaded ? <p className="rh-empty">Could not load health: {loaded.error}</p> : <HealthView data={loaded} />}
      </div>
    </div>
  );
}
