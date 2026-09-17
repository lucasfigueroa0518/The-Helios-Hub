import { redirect } from 'next/navigation';

import { InboxesHub } from '@/app/hub/inboxes-hub';
import { getSession } from '@/lib/session';

export default async function HubInboxesPage() {
  const session = await getSession();
  if (!session) redirect('/');
  return <InboxesHub />;
}
