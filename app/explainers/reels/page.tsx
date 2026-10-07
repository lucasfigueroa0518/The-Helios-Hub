import { redirect } from 'next/navigation';

import { explainersDb } from '@/lib/explainers/connection';
import { ReelsView } from '@/app/explainers/reels/reels-view';
import { loadReelsView } from '@/lib/explainers/overview';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Reels · Explainers',
  robots: { index: false, follow: false },
};

export default async function ExplainersReelsPage() {
  const session = await getSession();
  if (!session) redirect('/');

  const loaded = await explainersDb()
    .then((db) => loadReelsView(db))
    .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));

  return (
    <div className="rh">
      <div className="rh__inner">
        <header className="rh__head">
          <div>
            <p className="rh__kicker">Explainers</p>
            <h1 className="rh__title">Reels</h1>
          </div>
        </header>
        {'error' in loaded ? (
          <p className="rh-empty">Could not load reels: {loaded.error}</p>
        ) : (
          <ReelsView jobs={loaded} />
        )}
      </div>
    </div>
  );
}
