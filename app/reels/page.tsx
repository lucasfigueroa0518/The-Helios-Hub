import { redirect } from 'next/navigation';

import { ReelsHub } from '@/app/reels/reels-hub';
import { beginInsightsRefresh } from '@/lib/reels/media-insights/schedule-refresh';
import { loadReelsOverview } from '@/lib/reels/overview';
import { ensureReviewToken } from '@/lib/reels/review';
import { getSession } from '@/lib/session';
import { reelsMovesQuery } from '@/lib/reels/pipeline/promote';
import { readMoves } from '@/lib/social-hub/moves-store';

import './reels.css';
import '@/components/content-type/type-hub.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Text on Screen',
  robots: { index: false, follow: false },
};

export default async function ReelsPage() {
  const session = await getSession();
  if (!session) redirect('/');
  // Independent reads: run them together rather than one after another.
  const [, initial, reviewToken, moves] = await Promise.all([
    beginInsightsRefresh().catch(() => undefined),
    loadReelsOverview().catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    })),
    ensureReviewToken().catch(() => null),
    // What a person did to the queue (idea pool standard): pins, drags, archives. A failed read shows the bench as the night ranked it.
    readMoves(reelsMovesQuery, 'reels').catch(() => []),
  ]);

  if ('error' in initial) {
    return (
      <div className="rh">
        <div className="rh__inner">
          <h1 className="rh__title">Text on Screen <span className="rh-beta">Beta</span></h1>
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

  return <ReelsHub initial={initial} moves={moves} reviewPath={`/watch/${reviewToken ?? await ensureReviewToken()}`} />;
}
