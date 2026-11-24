import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';

import { NewsRankerLab } from './lab';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'News Ranker lab', robots: { index: false, follow: false } };

/** News Ranker lab (planning/MD-LFD Revisions/CONTRACT.md §Lab): local, read-only on intake, $1 cap. */
export default async function Page() {
  if (process.env.NODE_ENV !== 'development' && !(await getSession())) redirect('/');
  return <NewsRankerLab />;
}
