import { redirect } from 'next/navigation';

import { ReelsHub } from '@/app/reels/reels-hub';
import { poolPageData } from '@/components/content-type/pool/pool-data';
import { costPerPost } from '@/lib/content-type/posting';
import { typeHubModel } from '@/lib/content-type/model';
import { beginInsightsRefresh } from '@/lib/reels/media-insights/schedule-refresh';
import { loadReelsOverview } from '@/lib/reels/overview';
import { ensureReviewToken } from '@/lib/reels/review';
import { getSession } from '@/lib/session';
import { loadForPage } from '@/lib/social-hub/live';

import './reels.css';
import '@/components/content-type/type-hub.css';
import '@/app/social-hub.css';
import '@/app/social/(hub)/hub-content.css';
import '@/components/content-type/pool/pool.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Text on Screen',
  robots: { index: false, follow: false },
};

/**
 * Text on Screen: the standard pool screen over the hub's reels read (the same loadForPage → typeHubModel every other
 * type page uses, so the queue order, pins and archives come from the one dataset), plus the reels overview for the
 * reel-only controls in its panels (Generate Reel, the song pick, Schedule, Force post).
 */
export default async function ReelsPage() {
  const session = await getSession();
  if (!session) redirect('/');
  // Independent reads: run them together rather than one after another.
  const [, initial, reviewToken, loaded] = await Promise.all([
    beginInsightsRefresh().catch(() => undefined),
    loadReelsOverview().catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    })),
    ensureReviewToken().catch(() => null),
    loadForPage(session.email),
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

  // One `now` for the model and the pool screen, so the board and Up next agree.
  const now = new Date();
  const hub = 'error' in loaded ? null : loaded;
  const model = hub ? typeHubModel(hub, 'reels', now) : null;
  const pool = hub ? poolPageData(hub, 'reels', now, costPerPost(hub.posts, 'reels', now)) : null;

  return (
    <ReelsHub
      initial={initial}
      model={model}
      pool={pool}
      hubError={'error' in loaded ? loaded.error : null}
      reviewPath={`/watch/${reviewToken ?? await ensureReviewToken()}`}
    />
  );
}
