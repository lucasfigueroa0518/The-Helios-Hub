import { loadQueue } from './actions/loadQueue';
import { PageClient } from './PageClient';

export const dynamic = 'force-dynamic';

export default async function SocialPage() {
  const initial = await loadQueue();
  return <PageClient initial={initial} />;
}
