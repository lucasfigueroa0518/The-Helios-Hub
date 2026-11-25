import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';
import { ROA_LAB_BATCH, ROA_LAB_PASS, ROA_LAB_VIEW_MS } from '@/lib/stories/roa/types';

import { RoaLab } from './roa-lab';
import './lab.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Real or AI? lab', robots: { index: false, follow: false } };

/**
 * The Real or AI? swipe lab (planning/Real or AI/CONTRACT.md §4 B; RA-4, RA-7): a blind sample of the pool, a
 * 3-second look each, Real or AI. The score grades the engine's selection; nothing here changes the pool.
 */
export default async function Page() {
  if (!(await getSession())) redirect('/');
  return <RoaLab batchSize={ROA_LAB_BATCH} viewMs={ROA_LAB_VIEW_MS} pass={ROA_LAB_PASS} />;
}
