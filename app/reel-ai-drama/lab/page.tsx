import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';

import { ReelAiDramaLab } from './reel-ai-drama-lab';
import './lab.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reel AI Drama lab', robots: { index: false, follow: false } };

/** The Reel AI Drama lab (planning/AI Mini Docs MD-30): the ranked pool, development, jobs. Local; nothing publishes. */
export default async function Page() {
  if (process.env.NODE_ENV !== 'development' && !(await getSession())) redirect('/');
  return <ReelAiDramaLab />;
}
