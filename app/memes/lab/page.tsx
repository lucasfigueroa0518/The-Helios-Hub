import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';
import { REASON_TAGS, WORKED_TAGS } from '@/lib/memes/api';
import { BRIEF_BATCH_CAP_USD } from '@/lib/memes/brief-from-body';
import { MEME_SPEND_CAP_USD } from '@/lib/memes/cost';

import { MemeLab } from './meme-lab';
import './lab.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Meme lab', robots: { index: false, follow: false } };

/** The meme lab (planning/Memes/BUILD_PLAN.md M5): isolated, nothing publishes (ME-21, ME-22). */
export default async function Page() {
  // Local grading while Google sign-in is down. Production still redirects to login.
  if (process.env.NODE_ENV !== 'development' && !(await getSession())) redirect('/');
  return <MemeLab reasonTags={REASON_TAGS} workedTags={WORKED_TAGS} capUsd={MEME_SPEND_CAP_USD} briefCapUsd={BRIEF_BATCH_CAP_USD} />;
}
