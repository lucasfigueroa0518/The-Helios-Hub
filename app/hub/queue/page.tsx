import { redirect } from 'next/navigation';
import { SendQueueHub } from '@/app/hub/send-queue-hub';
import { getSession } from '@/lib/session';

export default async function HubQueuePage() {
  const session = await getSession();
  if (!session) redirect('/');
  // The board no longer needs the session: sharing a backlog to another
  // identity is gone, so every action applies to the signed-in user's queue.
  return <SendQueueHub />;
}
