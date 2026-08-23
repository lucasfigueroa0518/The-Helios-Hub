import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';

import './trello.css';

export const metadata: Metadata = {
  title: 'Trello',
  robots: { index: false, follow: false },
};

export default async function TrelloLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/');

  return <div className="trello-root">{children}</div>;
}
