import { redirect } from 'next/navigation';

import { readSoul } from '@/lib/personality/lab';
import { getSession } from '@/lib/session';

import { CommentLab } from './comment-lab';
import './lab.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Comment lab', robots: { index: false, follow: false } };

/** The Instagram comment bot, tested by hand. Nothing here posts. */
export default async function Page() {
  if (process.env.NODE_ENV !== 'development' && !(await getSession())) redirect('/');
  return <CommentLab soul={readSoul()} />;
}
