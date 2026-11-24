import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';

import { RealCaseLab } from './real-case-lab';
import './lab.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI News Explained lab', robots: { index: false, follow: false } };

/** The AI News Explained lab (planning/Real Case Reels RC-10): local, nothing publishes. */
export default async function Page() {
  if (process.env.NODE_ENV !== 'development' && !(await getSession())) redirect('/');
  return <RealCaseLab />;
}
