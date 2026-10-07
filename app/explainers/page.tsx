import { redirect } from 'next/navigation';

import { TopicsView } from '@/app/explainers/topics-view';
import { explainersDb } from '@/lib/explainers/connection';
import { loadTopicsView } from '@/lib/explainers/overview';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Topics · Explainers',
  robots: { index: false, follow: false },
};

export default async function ExplainersTopicsPage() {
  const session = await getSession();
  if (!session) redirect('/');

  const loaded = await explainersDb()
    .then(loadTopicsView)
    .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));

  return (
    <div className="rh">
      <div className="rh__inner">
        <header className="rh__head">
          <div>
            <p className="rh__kicker">Explainers</p>
            <h1 className="rh__title">Topics <span className="rh-beta">Beta</span></h1>
          </div>
        </header>
        {'error' in loaded ? (
          <p className="rh-empty">Could not load topics: {loaded.error}</p>
        ) : (
          <TopicsView view={loaded} />
        )}
      </div>
    </div>
  );
}
