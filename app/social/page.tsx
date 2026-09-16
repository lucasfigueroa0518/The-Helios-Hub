import { loadBatch } from './actions/loadBatch';
import { PageClient } from './PageClient';

export const dynamic = 'force-dynamic';

export default async function SocialPage() {
  const articles = await loadBatch();
  return <PageClient articles={articles} />;
}
