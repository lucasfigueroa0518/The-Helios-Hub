import { redirect } from 'next/navigation';

import { ReelsHub } from '@/app/reels/reels-hub';
import { loadReelsOverview } from '@/lib/reels/overview';
import { getSession } from '@/lib/session';

import './reels.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Trial Reels',
  robots: { index: false, follow: false },
};

export default async function ReelsPage() {
  const session = await getSession();
  if (!session) redirect('/');

  const initial = await loadReelsOverview().catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));

  if ('error' in initial) {
    return (
      <div className="rh">
        <div className="rh__inner">
          <h1 className="rh__title">Trial Reels <span className="rh-beta">Beta</span></h1>
          <p className="rh-empty">
            Could not load the reels: {initial.error}
          </p>
          <p className="rh-muted">
            If the tables are missing, apply the schema with <code>npm run db:reels</code>.
          </p>
        </div>
      </div>
    );
  }

  return <ReelsHub initial={initial} />;
}
