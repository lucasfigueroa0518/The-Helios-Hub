import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';

import { LfdLab } from './lfd-lab';
import '../lab/lab.css';
import './lfd-lab.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Last Few Days lab', robots: { index: false, follow: false } };

/** The Last Few Days lab (LFD lab plan): simulated posts with memes, local only, nothing publishes. */
export default async function Page() {
  if (process.env.NODE_ENV !== 'development' && !(await getSession())) redirect('/');
  return <LfdLab />;
}
